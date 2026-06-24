import { Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RoleType, WS_EVENTS, WS_NAMESPACES } from '@blue-bee/shared';
import { TokenService } from '../auth/token.service';
import { ChannelTokenService } from './channel-token.service';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimePublisher } from './realtime-publisher.service';

/** Roles allowed on the org fleet channel (§6.1b / §17.3). */
const FLEET_ROLES: readonly RoleType[] = [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR];
/** setTimeout ceiling (ms) — token TTLs are minutes, but clamp to avoid 32-bit overflow. */
const MAX_TIMER_MS = 2_147_000_000;

interface VehicleSocketData {
  orgId: string;
  vehicleId: string;
  orderId: string;
  stopId: string;
  exp?: number;
}
interface FleetSocketData {
  orgId: string;
  exp?: number;
}

/**
 * The Socket.IO realtime gateway (PRD §6.2, §10.4, §11.1). Mounted on the Nest HTTP server
 * with the Redis adapter (cross-instance fan-out). Two namespaces, each authorized at the
 * handshake AND server-bound to exactly the rooms the principal may see — there is NO
 * client-driven subscribe, so a client can never request another room (authorize-by-construction).
 *
 *  • `/live/vehicle` (customer) — `auth.token` = the signed channel token. Validated for
 *    signature/expiry/kind, then re-checked against LIVE stop state; the socket is bound to
 *    exactly one vehicle room + its stop room. Disconnected at token expiry, and (by the
 *    publisher) on stop end / shift end. Never sees another vehicle or the fleet.
 *  • `/live/fleet` (owner/dispatch/CSR) — `auth.token` = the access JWT. Validated + revocation-
 *    checked + role-gated, then bound to the caller-org fleet room (all org vehicles, org-scoped).
 *
 * The WS is an OPTIMIZATION (§12.3): the REST last-known + status timeline remain the source
 * of truth, so a dropped channel degrades to polling. The gateway streams deltas only.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly channelTokens: ChannelTokenService,
    private readonly access: RealtimeAccessService,
    private readonly tokens: TokenService,
    private readonly publisher: RealtimePublisher,
  ) {}

  afterInit(server: Server): void {
    this.publisher.bindServer(server);

    // Default namespace serves nothing — reject it so there is no unauthenticated surface.
    server.of('/').use((_socket, next) => next(new Error('unauthorized')));

    const vehicleNs = server.of(WS_NAMESPACES.VEHICLE);
    vehicleNs.use((socket, next) => {
      this.authVehicle(socket).then(() => next()).catch((err: Error) => next(this.wsError(err.message)));
    });
    vehicleNs.on('connection', (socket) => this.onVehicleConnection(socket));

    const fleetNs = server.of(WS_NAMESPACES.FLEET);
    fleetNs.use((socket, next) => {
      this.authFleet(socket).then(() => next()).catch((err: Error) => next(this.wsError(err.message)));
    });
    fleetNs.on('connection', (socket) => this.onFleetConnection(socket));

    this.logger.log(`Realtime gateway ready (namespaces ${WS_NAMESPACES.VEHICLE}, ${WS_NAMESPACES.FLEET})`);
  }

  // ── customer vehicle channel ──

  private async authVehicle(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing_channel_token');
    const claims = this.channelTokens.verify(token); // throws on bad signature / expiry / wrong kind
    const trackable = await this.access.isStopTrackable(claims);
    if (!trackable) throw new Error('stop_not_active');
    (socket.data as { channel?: VehicleSocketData }).channel = {
      orgId: claims.org_id,
      vehicleId: claims.vehicle_id,
      orderId: claims.order_id,
      stopId: claims.stop_id,
      exp: claims.exp,
    };
  }

  private onVehicleConnection(socket: Socket): void {
    const c = (socket.data as { channel: VehicleSocketData }).channel;
    // Server-BOUND to exactly this vehicle + stop; no client subscribe exists.
    void socket.join(this.publisher.vehicleRoom(c.orgId, c.vehicleId));
    void socket.join(this.publisher.stopRoom(c.orgId, c.stopId));
    this.scheduleExpiryDisconnect(socket, c.exp, { reason: 'token_expired', vehicleId: c.vehicleId, stopId: c.stopId });
  }

  // ── owner/dispatch fleet channel ──

  private async authFleet(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing_access_token');
    const claims = this.tokens.verifyAccess(token); // throws on bad signature / expiry
    if (await this.tokens.isAccessRevoked(claims.jti)) throw new Error('token_revoked');
    const granted = claims.roles.map((r) => r.role);
    if (!granted.some((r) => FLEET_ROLES.includes(r))) throw new Error('forbidden_role');
    (socket.data as { fleet?: FleetSocketData }).fleet = { orgId: claims.org_id, exp: claims.exp };
  }

  private onFleetConnection(socket: Socket): void {
    const f = (socket.data as { fleet: FleetSocketData }).fleet;
    void socket.join(this.publisher.fleetRoom(f.orgId)); // org-scoped: only this org's positions
    this.scheduleExpiryDisconnect(socket, f.exp, null);
  }

  // ── helpers ──

  private extractToken(socket: Socket): string | null {
    // Handshake auth ONLY — never the URL query string. The vehicle token (and the fleet
    // access JWT) are bearer credentials; accepting them via query would leak them into
    // proxy/LB access logs, browser history, and Referer headers (QC: token confidentiality).
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown };
    if (typeof auth.token === 'string' && auth.token.length > 0) return auth.token;
    return null;
  }

  /** Force-disconnect at the token's `exp` (the connection must not outlive the capability). */
  private scheduleExpiryDisconnect(
    socket: Socket,
    expUnixSeconds: number | undefined,
    closed: { reason: 'token_expired'; vehicleId: string; stopId: string } | null,
  ): void {
    if (!expUnixSeconds) return;
    const ms = expUnixSeconds * 1000 - Date.now();
    if (ms <= 0) {
      socket.disconnect(true);
      return;
    }
    const timer = setTimeout(() => {
      if (closed) socket.emit(WS_EVENTS.CHANNEL_CLOSED, closed);
      socket.disconnect(true);
    }, Math.min(ms, MAX_TIMER_MS));
    socket.on('disconnect', () => clearTimeout(timer));
  }

  private wsError(code: string): Error {
    const err = new Error(code);
    // Socket.IO forwards err.message (and err.data) to the client's connect_error.
    (err as Error & { data?: unknown }).data = { code };
    return err;
  }
}
