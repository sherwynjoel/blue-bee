import type { FleetLiveResult, LivePositionEvent, StopEta } from '@blue-bee/shared';

/**
 * Owner fleet-board state machine (PRD §6.1b/§7C C1, §12.3) — framework-agnostic so it's unit-tested
 * headlessly. THE CONTRACT (the same one the customer track-my-truck and the web fleet board honour):
 *  • REST `GET /fleet/live` is the SOURCE OF TRUTH; the `WS /live/fleet` is an OPTIMISATION. We paint
 *    from the REST snapshot first, then live `position` events refine vehicle pins.
 *  • A dropped/failed socket NEVER blanks the board — we degrade to the last REST snapshot and the
 *    hook polls REST to keep it fresh (the socket auto-reconnects underneath).
 *  • TENANCY: the snapshot + the fleet channel are both org-scoped server-side (the owner only ever
 *    sees their own org's vehicles).
 */

export type FleetPhase = 'loading' | 'connecting' | 'live' | 'degraded' | 'error';

/** One vehicle row for the map + list: REST last-known, overlaid by a live position when present. */
export interface FleetVehicle {
  vehicleId: string;
  label: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  recordedAt: string | null;
  nextStopEta: StopEta | null;
  /** True when a live WS position is currently overlaid (renders the marker as "live"). */
  live: boolean;
  /** False for vehicles with no position yet (rendered in the list as idle, never on the map). */
  hasPosition: boolean;
}

export interface FleetState {
  phase: FleetPhase;
  vehicles: FleetVehicle[];
  /** Count of vehicles with no position yet. */
  idleCount: number;
  error: string | null;
}

export interface SocketLike {
  disconnect(): void;
}

export interface FleetSocketHandlers {
  onConnect(): void;
  onPosition(ev: LivePositionEvent): void;
  onConnectError(err: { message?: string }): void;
  onDisconnect(reason: string): void;
}

export interface FleetDeps {
  /** REST source of truth — `GET /v1/fleet/live`. */
  fetchFleet(): Promise<FleetLiveResult>;
  /** Open the live `/live/fleet` socket (access JWT handshake); returns a handle to disconnect. */
  connect(handlers: FleetSocketHandlers): SocketLike;
  /** Emit the new state to the subscriber (the React hook). */
  onState(state: FleetState): void;
}

export const INITIAL_FLEET_STATE: FleetState = { phase: 'loading', vehicles: [], idleCount: 0, error: null };

/** Pure merge: REST snapshot overlaid with any live position (which marks the vehicle `live`). */
export function mergeFleet(snapshot: FleetLiveResult, live: Record<string, LivePositionEvent>): FleetVehicle[] {
  const positioned: FleetVehicle[] = snapshot.vehicles.map((v) => {
    const p = live[v.vehicleId];
    return {
      vehicleId: v.vehicleId,
      label: v.label,
      lat: p?.lat ?? v.lat,
      lng: p?.lng ?? v.lng,
      heading: p?.heading ?? v.heading,
      recordedAt: p?.recordedAt ?? v.recordedAt,
      nextStopEta: v.nextStopEta,
      live: !!p,
      hasPosition: true,
    };
  });
  const idle: FleetVehicle[] = snapshot.withoutPosition.map((v) => ({
    vehicleId: v.vehicleId,
    label: v.label,
    lat: null,
    lng: null,
    heading: null,
    recordedAt: null,
    nextStopEta: null,
    live: false,
    hasPosition: false,
  }));
  return [...positioned, ...idle];
}

export class FleetController {
  private snapshot: FleetLiveResult | null = null;
  private live: Record<string, LivePositionEvent> = {};
  private state: FleetState = { ...INITIAL_FLEET_STATE };
  private socket: SocketLike | null = null;
  private stopped = false;

  constructor(private readonly deps: FleetDeps) {}

  getState(): FleetState {
    return this.state;
  }

  private recompute(): FleetVehicle[] {
    if (!this.snapshot) return this.state.vehicles;
    return mergeFleet(this.snapshot, this.live);
  }

  private patch(p: Partial<FleetState>): void {
    this.state = { ...this.state, ...p };
    if (!this.stopped) this.deps.onState(this.state);
  }

  /** Begin: REST snapshot first (truth), then open the live channel. */
  async start(): Promise<void> {
    const ok = await this.refreshSnapshot();
    if (this.stopped || !ok) return;
    this.openSocket();
  }

  /** Re-pull the REST snapshot WITHOUT touching the socket (the hook's degraded poll). */
  async refreshSnapshot(): Promise<boolean> {
    try {
      this.snapshot = await this.deps.fetchFleet();
      const vehicles = this.recompute();
      this.patch({ vehicles, idleCount: vehicles.filter((v) => !v.hasPosition).length, error: null });
      return true;
    } catch (e) {
      if (this.stopped) return false;
      // Never blank: keep any prior snapshot (degraded); only 'error' when we have nothing to show.
      const hasData = this.state.vehicles.length > 0;
      this.patch({ phase: hasData ? 'degraded' : 'error', error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.disconnectSocket();
  }

  private openSocket(): void {
    this.disconnectSocket();
    this.patch({ phase: 'connecting' });
    this.socket = this.deps.connect({
      onConnect: () => this.patch({ phase: 'live' }),
      onPosition: (ev) => {
        this.live = { ...this.live, [ev.vehicleId]: ev };
        const vehicles = this.recompute();
        this.patch({ phase: 'live', vehicles, idleCount: vehicles.filter((v) => !v.hasPosition).length });
      },
      onConnectError: () => this.handleDrop(),
      onDisconnect: () => this.handleDrop(),
    });
  }

  /** Transport drop/handshake fail — don't kill the socket (it auto-reconnects); show the REST
   *  snapshot as 'degraded' and refresh it (WS is never the source of truth). */
  private handleDrop(): void {
    if (this.stopped) return;
    this.patch({ phase: 'degraded' });
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
