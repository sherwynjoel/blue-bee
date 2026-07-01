import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ChannelTokenClaims } from '@blue-bee/shared';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';

/**
 * Mints + verifies the short-lived, server-signed customer tracking token (PRD §6.2, §11.1).
 *
 * Signed with a DEDICATED secret (`AUTH_CONFIG.channelToken.secret`) — never the auth JWT
 * secret — and pinned to `kind: 'vehicle-tracking'`, so a tracking token can never be
 * verified as (or escalate to) a session token, and vice-versa. The token is a *capability*
 * naming exactly one vehicle for one order's active stop; its real authorization (is the stop
 * still active? does the route still point at this vehicle?) is re-checked against live state
 * at the WS handshake, so the `exp` here is only a coarse upper bound.
 */
@Injectable()
export class ChannelTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * Mint a token binding one vehicle/order/stop to the minting principal. Pass `chat: true` ONLY from
   * the participant-gated chat channel endpoint — it authorizes joining the order's chat room (Inc-18);
   * the tracking read omits it, so a tracking token can observe the vehicle but never receives chat.
   */
  mint(input: { orgId: string; vehicleId: string; orderId: string; stopId: string; sub: string; chat?: boolean }): string {
    const claims: Omit<ChannelTokenClaims, 'iat' | 'exp'> = {
      kind: 'vehicle-tracking',
      org_id: input.orgId,
      vehicle_id: input.vehicleId,
      order_id: input.orderId,
      stop_id: input.stopId,
      sub: input.sub,
      // Only stamped when chat-authorized, so plain tracking tokens are byte-identical to before.
      ...(input.chat ? { chat: true } : {}),
    };
    return this.jwt.sign(claims, {
      secret: this.config.channelToken.secret,
      expiresIn: this.config.channelToken.ttlSeconds,
      algorithm: 'HS256',
    });
  }

  /**
   * Verify signature (dedicated secret, HS256 pinned) + expiry + `kind`, and that every bound
   * id is present. Throws on a bad signature / expiry / wrong kind / malformed claims — the
   * WS handshake treats any throw as a rejected connection.
   */
  verify(token: string): ChannelTokenClaims {
    const payload = this.jwt.verify(token, {
      secret: this.config.channelToken.secret,
      algorithms: ['HS256'],
    }) as Record<string, unknown>;
    if (payload.kind !== 'vehicle-tracking') {
      throw new Error('wrong token kind');
    }
    for (const field of ['org_id', 'vehicle_id', 'order_id', 'stop_id', 'sub'] as const) {
      if (typeof payload[field] !== 'string' || (payload[field] as string).length === 0) {
        throw new Error(`channel token missing ${field}`);
      }
    }
    return payload as unknown as ChannelTokenClaims;
  }
}
