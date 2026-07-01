import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  WS_EVENTS,
  WS_NAMESPACES,
  type ChannelClosedReason,
  type ChatMessageEvent,
  type LiveEtaEvent,
  type LiveGeofenceEvent,
  type LivePositionEvent,
} from '@blue-bee/shared';

/**
 * The single seam between the domain (ingestion, stop/shift lifecycle) and the Socket.IO
 * fan-out (PRD §10.4) — a thin realtime abstraction so a managed provider (Ably/Pusher) can
 * swap in later without touching callers. Holds the live Socket.IO `Server` (bound by the
 * gateway on init) and uses the Redis adapter underneath, so an emit/disconnect issued on any
 * instance fans out cluster-wide.
 *
 * Rooms (all namespaced by org so a tenant can never receive another's traffic):
 *  • vehicle room  `org:{org}:veh:{vehicleId}`  — customers tracking that vehicle (VEHICLE ns)
 *  • stop room     `org:{org}:stop:{stopId}`     — customers tracking a specific stop (for teardown)
 *  • fleet room    `org:{org}:fleet`             — owner/dispatch (FLEET ns)
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);
  private server: Server | null = null;

  bindServer(server: Server): void {
    this.server = server;
  }

  /** True once the gateway has initialised (lets callers/tests assert wiring). */
  isReady(): boolean {
    return this.server !== null;
  }

  vehicleRoom(orgId: string, vehicleId: string): string {
    return `org:${orgId}:veh:${vehicleId}`;
  }
  stopRoom(orgId: string, stopId: string): string {
    return `org:${orgId}:stop:${stopId}`;
  }
  fleetRoom(orgId: string): string {
    return `org:${orgId}:fleet`;
  }
  /**
   * Order chat room (Increment 18) — customers + the assigned driver on the VEHICLE namespace who
   * are conversing about one order. Org-namespaced like every other room so a tenant never receives
   * another's traffic. Sockets JOIN it server-side on connection from the token's verified order_id
   * (authorize-by-construction — no client subscribe), so a client can never request another order.
   */
  orderRoom(orgId: string, orderId: string): string {
    return `org:${orgId}:ord:${orderId}`;
  }

  /**
   * Push a new position to the vehicle's customers AND the org fleet. Call ONLY when the
   * last-known genuinely advanced (Lua-CAS returned moved-forward) — that gate is what keeps
   * the stream monotonic (no regression on out-of-order pings, no duplicate storms).
   */
  publishPosition(orgId: string, vehicleId: string, payload: LivePositionEvent): void {
    if (!this.server) return; // gateway not initialised (e.g. very early boot) — REST stays source of truth
    this.server.of(WS_NAMESPACES.VEHICLE).to(this.vehicleRoom(orgId, vehicleId)).emit(WS_EVENTS.POSITION, payload);
    this.server.of(WS_NAMESPACES.FLEET).to(this.fleetRoom(orgId)).emit(WS_EVENTS.POSITION, payload);
  }

  /**
   * Push a refreshed ETA range (Increment 7) for one stop. Scoped to the customer's STOP room —
   * NOT the shared vehicle room — because an ETA is stop-specific: a different customer co-routed
   * on the SAME vehicle (a different stop) must never see this stop's ETA. The org fleet room
   * gets it too (ops). Call only on a genuine advance, after smoothing.
   */
  publishEta(orgId: string, stopId: string, payload: LiveEtaEvent): void {
    if (!this.server) return; // gateway not initialised — REST eta remains source of truth
    this.server.of(WS_NAMESPACES.VEHICLE).to(this.stopRoom(orgId, stopId)).emit(WS_EVENTS.ETA, payload);
    this.server.of(WS_NAMESPACES.FLEET).to(this.fleetRoom(orgId)).emit(WS_EVENTS.ETA, payload);
  }

  /**
   * Push a geofence crossing (Increment 7) for one stop — `approaching`/`arrived`. Same scoping as
   * the ETA emit (stop-specific customer room + org fleet room). Call ONLY when a durable
   * `GeofenceEvent` row was actually written (once per stop per type), so the wire mirrors the
   * idempotent persistence — no alert spam on jitter/re-entry.
   */
  publishGeofence(orgId: string, stopId: string, payload: LiveGeofenceEvent): void {
    if (!this.server) return;
    this.server.of(WS_NAMESPACES.VEHICLE).to(this.stopRoom(orgId, stopId)).emit(WS_EVENTS.GEOFENCE, payload);
    this.server.of(WS_NAMESPACES.FLEET).to(this.fleetRoom(orgId)).emit(WS_EVENTS.GEOFENCE, payload);
  }

  /**
   * Push a newly-persisted chat message to the order's participants (Increment 18). Scoped to the
   * ORDER room on the VEHICLE namespace — exactly the order's customer + assigned driver, who were
   * server-bound to it at the handshake. NEVER a global/namespace-wide broadcast (no leak of one
   * order's chat to another), and never the fleet room (owner/console chat is out of scope). The
   * emit is an OPTIMIZATION: the REST history is source of truth, so an offline client backfills.
   */
  publishChatMessage(orgId: string, orderId: string, payload: ChatMessageEvent): void {
    if (!this.server) return; // gateway not initialised — REST history remains source of truth
    this.server.of(WS_NAMESPACES.VEHICLE).to(this.orderRoom(orgId, orderId)).emit(WS_EVENTS.CHAT_MESSAGE, payload);
  }

  /**
   * Close every customer socket tracking a specific stop (the stop ended → no tracking after
   * delivery). Emits `channel:closed` then force-disconnects the stop room cluster-wide.
   */
  async closeStopChannel(orgId: string, stopId: string, vehicleId: string, reason: ChannelClosedReason): Promise<void> {
    if (!this.server) return;
    const ns = this.server.of(WS_NAMESPACES.VEHICLE);
    const room = this.stopRoom(orgId, stopId);
    ns.to(room).emit(WS_EVENTS.CHANNEL_CLOSED, { reason, vehicleId, stopId });
    await ns.in(room).disconnectSockets(true);
    this.logger.log(`closed stop channel ${room} (${reason})`);
  }

  /**
   * Close every customer socket tracking a vehicle (the shift ended → vehicle off-duty, no
   * more pings, no leak). Emits `channel:closed` then force-disconnects the vehicle room.
   */
  async closeVehicleChannel(orgId: string, vehicleId: string, reason: ChannelClosedReason): Promise<void> {
    if (!this.server) return;
    const ns = this.server.of(WS_NAMESPACES.VEHICLE);
    const room = this.vehicleRoom(orgId, vehicleId);
    ns.to(room).emit(WS_EVENTS.CHANNEL_CLOSED, { reason, vehicleId });
    await ns.in(room).disconnectSockets(true);
    this.logger.log(`closed vehicle channel ${room} (${reason})`);
  }
}
