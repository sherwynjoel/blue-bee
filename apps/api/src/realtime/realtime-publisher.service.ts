import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  WS_EVENTS,
  WS_NAMESPACES,
  type ChannelClosedReason,
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
