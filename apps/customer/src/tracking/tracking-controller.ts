import type {
  ChannelClosedEvent,
  LiveEtaEvent,
  LiveGeofenceEvent,
  LivePositionEvent,
  OrderTrackingResult,
} from '@blue-bee/shared';

/**
 * Track-my-truck state machine (PRD §6.2/§12.3) — framework-agnostic so it's unit-tested headlessly.
 *
 * THE CONTRACT IT ENFORCES:
 *  • REST is the SOURCE OF TRUTH; the WS is an optimisation. We paint from `GET /orders/:id/tracking`
 *    first, then a live socket only refines it. A dropped socket / dead token / closed channel NEVER
 *    blanks the screen — we degrade to the last REST snapshot + the order's status timeline.
 *  • PRIVACY: we only ever look at THIS order's tracking read (one vehicle, server-scoped). We never
 *    request a fleet or another order — the channel token binds to exactly one vehicle/stop.
 *  • TOKEN EXPIRY / DEAD TOKEN: a `channel:closed{token_expired}` or a handshake `connect_error`
 *    (e.g. the live re-check `stop_not_active` for a completed/reassigned stop) is fixed the SAME
 *    way — re-fetch `/tracking` for a FRESH token and, if a stop is still active, reconnect.
 *  • CHANNEL CLOSED for a finished/reassigned stop (stop_completed/failed/skipped/reassigned/
 *    shift_ended) → re-fetch `/tracking`: if a NEW active stop has a token, reconnect to it; else
 *    fall back to REST + the timeline (tracking is over).
 */

export type TrackingPhase = 'loading' | 'connecting' | 'live' | 'rest' | 'degraded' | 'error';

/** A vehicle position normalized from either the REST last-known or a live `position` event. */
export interface VehiclePosition {
  vehicleId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

export interface EtaRange {
  eta: string | null;
  low: string | null;
  high: string | null;
  computedAt: string | null;
}

export interface TrackingState {
  phase: TrackingPhase;
  /** True while a live socket is connected (vehicle moves in real time). */
  source: 'rest' | 'live';
  vehicle: VehiclePosition | null;
  stop: OrderTrackingResult['stop'];
  eta: EtaRange | null;
  approaching: boolean;
  arrived: boolean;
  /** The last server-sent close reason (for the UI banner), if any. */
  closedReason: string | null;
  error: string | null;
}

export interface SocketLike {
  disconnect(): void;
}

export interface SocketHandlers {
  onConnect(): void;
  onPosition(ev: LivePositionEvent): void;
  onEta(ev: LiveEtaEvent): void;
  onGeofence(ev: LiveGeofenceEvent): void;
  onChannelClosed(ev: ChannelClosedEvent): void;
  onConnectError(err: { message?: string; data?: { code?: string } }): void;
  onDisconnect(reason: string): void;
}

export interface TrackingDeps {
  /** REST source of truth — `GET /v1/orders/:id/tracking`. */
  fetchTracking(): Promise<OrderTrackingResult>;
  /** Open the live `/live/vehicle` socket with the channel token; returns a handle to disconnect. */
  connect(channelToken: string, handlers: SocketHandlers): SocketLike;
  /** Emit the new state to the subscriber (the React hook). */
  onState(state: TrackingState): void;
}

/** Max consecutive handshake failures before we give up the live channel and stay on REST. */
const MAX_CONNECT_ATTEMPTS = 3;

function stopToEta(stop: OrderTrackingResult['stop']): EtaRange | null {
  if (!stop) return null;
  return { eta: stop.eta, low: stop.etaLow, high: stop.etaHigh, computedAt: stop.etaComputedAt };
}

function positionFromEvent(ev: LivePositionEvent): VehiclePosition {
  return { vehicleId: ev.vehicleId, lat: ev.lat, lng: ev.lng, heading: ev.heading, speed: ev.speed, recordedAt: ev.recordedAt };
}

function positionFromRest(v: OrderTrackingResult['vehicle']): VehiclePosition | null {
  if (!v) return null;
  return { vehicleId: v.vehicleId, lat: v.lat, lng: v.lng, heading: v.heading, speed: v.speed, recordedAt: v.recordedAt };
}

export const INITIAL_TRACKING_STATE: TrackingState = {
  phase: 'loading',
  source: 'rest',
  vehicle: null,
  stop: null,
  eta: null,
  approaching: false,
  arrived: false,
  closedReason: null,
  error: null,
};

export class TrackingController {
  private state: TrackingState = { ...INITIAL_TRACKING_STATE };
  private socket: SocketLike | null = null;
  private stopped = false;
  private connectAttempts = 0;

  constructor(private readonly deps: TrackingDeps) {}

  getState(): TrackingState {
    return this.state;
  }

  private patch(p: Partial<TrackingState>): void {
    this.state = { ...this.state, ...p };
    if (!this.stopped) this.deps.onState(this.state);
  }

  private hasData(): boolean {
    return !!this.state.vehicle || !!this.state.stop;
  }

  /** Begin tracking: REST snapshot first (truth), then a live channel if one is available. */
  async start(): Promise<void> {
    await this.acquire({ initial: true });
  }

  /** Manual retry (e.g. the UI "try again" after an error). */
  async retry(): Promise<void> {
    this.connectAttempts = 0;
    await this.acquire({ initial: false });
  }

  /** Re-pull the REST snapshot WITHOUT touching the socket — the hook's degraded-poll keeps
   *  last-known fresh while the transport reconnects on its own. */
  async refreshSnapshot(): Promise<void> {
    const t = await this.safeFetch();
    if (t) this.applyRest(t);
  }

  stop(): void {
    this.stopped = true;
    this.disconnectSocket();
  }

  // ── internals ──

  private async safeFetch(): Promise<OrderTrackingResult | null> {
    try {
      return await this.deps.fetchTracking();
    } catch (e) {
      if (this.stopped) return null;
      // Never blank: keep any prior snapshot (degraded); only 'error' when we have nothing to show.
      this.patch({ phase: this.hasData() ? 'degraded' : 'error', error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  private applyRest(t: OrderTrackingResult): void {
    // REST is the source of truth for the vehicle/stop/eta snapshot.
    this.patch({ vehicle: positionFromRest(t.vehicle), stop: t.stop, eta: stopToEta(t.stop), source: 'rest', error: null });
  }

  /** REST truth → (re)connect the live channel if a token + active stop exist, else REST-only. */
  private async acquire({ initial }: { initial: boolean }): Promise<void> {
    const t = await this.safeFetch();
    if (!t || this.stopped) return;
    this.applyRest(t);
    if (t.channelToken && t.stop) {
      this.openSocket(t.channelToken);
    } else {
      // No active stop / no vehicle assigned → there is nothing live to show. REST + timeline only.
      this.disconnectSocket();
      this.patch({ phase: 'rest', closedReason: initial ? null : this.state.closedReason });
    }
  }

  private openSocket(channelToken: string): void {
    this.disconnectSocket();
    this.patch({ phase: 'connecting' });
    this.socket = this.deps.connect(channelToken, {
      onConnect: () => {
        this.connectAttempts = 0;
        this.patch({ phase: 'live' });
      },
      onPosition: (ev) => this.patch({ vehicle: positionFromEvent(ev), source: 'live', phase: 'live' }),
      onEta: (ev) =>
        this.patch({ eta: { eta: ev.eta, low: ev.low, high: ev.high, computedAt: ev.computedAt }, source: 'live' }),
      onGeofence: (ev) =>
        this.patch(ev.type === 'ARRIVED' ? { arrived: true, approaching: true } : { approaching: true }),
      onChannelClosed: (ev) => void this.handleChannelClosed(ev),
      onConnectError: (err) => void this.handleConnectError(err),
      onDisconnect: (reason) => this.handleDisconnect(reason),
    });
  }

  /** Server closed the channel. token_expired → fresh token + reconnect; stop finished/reassigned →
   *  re-fetch (maybe a new stop), else REST + timeline. Both paths go through `acquire`. */
  private async handleChannelClosed(ev: ChannelClosedEvent): Promise<void> {
    if (this.stopped) return;
    this.patch({ closedReason: ev.reason });
    this.disconnectSocket();
    this.connectAttempts = 0; // a clean server close is not a handshake failure
    await this.acquire({ initial: false });
  }

  /** Handshake rejected — dead/expired token or the live re-check ('stop_not_active'). Re-fetch a
   *  fresh token + reconnect, bounded; after too many failures stay on REST (never loop forever). */
  private async handleConnectError(err: { message?: string; data?: { code?: string } }): Promise<void> {
    if (this.stopped) return;
    this.disconnectSocket();
    this.connectAttempts += 1;
    this.patch({ closedReason: err.data?.code ?? err.message ?? 'connect_error' });
    if (this.connectAttempts > MAX_CONNECT_ATTEMPTS) {
      this.patch({ phase: this.hasData() ? 'degraded' : 'rest' });
      return;
    }
    await this.acquire({ initial: false });
  }

  /** Transport drop (NOT a server close). Don't kill the socket — let it auto-reconnect; show the
   *  REST last-known as 'degraded' meanwhile (WS is never the source of truth). */
  private handleDisconnect(_reason: string): void {
    if (this.stopped) return;
    this.patch({ phase: 'degraded', source: 'rest' });
    void this.refreshSnapshot();
  }

  private disconnectSocket(): void {
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}
