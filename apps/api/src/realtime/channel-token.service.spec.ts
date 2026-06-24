import { JwtService } from '@nestjs/jwt';
import type { AuthConfig } from '../config/auth.config';
import { ChannelTokenService } from './channel-token.service';

const SECRET = 'unit-test-channel-secret-aaaaaaaaaaaaaaaaaaaa'; // >= 32 chars
const OTHER_SECRET = 'a-totally-different-secret-bbbbbbbbbbbbbbbbbb';

function svcWith(ttlSeconds = 600): { svc: ChannelTokenService; jwt: JwtService } {
  const jwt = new JwtService({});
  const config = { channelToken: { secret: SECRET, ttlSeconds } } as unknown as AuthConfig;
  return { svc: new ChannelTokenService(jwt, config), jwt };
}

const MINT = { orgId: 'org-1', vehicleId: 'veh-1', orderId: 'order-1', stopId: 'stop-1', sub: 'user-1' };

describe('ChannelTokenService — signed per-vehicle capability', () => {
  it('mints a token that verifies back to its exact bound scope', () => {
    const { svc } = svcWith();
    const claims = svc.verify(svc.mint(MINT));
    expect(claims).toMatchObject({
      kind: 'vehicle-tracking',
      org_id: 'org-1',
      vehicle_id: 'veh-1',
      order_id: 'order-1',
      stop_id: 'stop-1',
      sub: 'user-1',
    });
    expect(claims.exp).toBeGreaterThan(claims.iat ?? 0);
  });

  it('rejects a token signed with a different secret (forged)', () => {
    const { svc } = svcWith();
    const forged = new JwtService({}).sign(
      { kind: 'vehicle-tracking', org_id: 'o', vehicle_id: 'v', order_id: 'r', stop_id: 's', sub: 'u' },
      { secret: OTHER_SECRET, expiresIn: 600, algorithm: 'HS256' },
    );
    expect(() => svc.verify(forged)).toThrow();
  });

  it('rejects a tampered token (payload mutated → signature mismatch)', () => {
    const { svc } = svcWith();
    const token = svc.mint(MINT);
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.vehicle_id = 'veh-ATTACKER'; // try to point the token at another vehicle
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    expect(() => svc.verify(tampered)).toThrow();
  });

  it('rejects an expired token even with a valid signature', () => {
    const { svc, jwt } = svcWith();
    const expired = jwt.sign(
      { kind: 'vehicle-tracking', org_id: 'o', vehicle_id: 'v', order_id: 'r', stop_id: 's', sub: 'u' },
      { secret: SECRET, expiresIn: -5, algorithm: 'HS256' },
    );
    expect(() => svc.verify(expired)).toThrow();
  });

  it('rejects a token of the wrong kind (cannot be confused with an auth/session token)', () => {
    const { svc, jwt } = svcWith();
    const accessLike = jwt.sign(
      { kind: 'access', org_id: 'o', vehicle_id: 'v', order_id: 'r', stop_id: 's', sub: 'u' },
      { secret: SECRET, expiresIn: 600, algorithm: 'HS256' },
    );
    expect(() => svc.verify(accessLike)).toThrow('wrong token kind');
  });

  it('rejects a token missing a bound id', () => {
    const { svc, jwt } = svcWith();
    const incomplete = jwt.sign(
      { kind: 'vehicle-tracking', org_id: 'o', vehicle_id: 'v' }, // no order_id/stop_id/sub
      { secret: SECRET, expiresIn: 600, algorithm: 'HS256' },
    );
    expect(() => svc.verify(incomplete)).toThrow(/missing/);
  });
});
