import { Injectable, NotFoundException } from '@nestjs/common';
import { DEVICE_TOKEN_ERRORS, type DeviceTokenResult, type RegisterDeviceTokenDto } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Device-token registration (Increment 8, §8.5/§11.2) — the real surface the customer/driver app
 * POSTs a push token to. Idempotent by token (globally unique): re-registering re-activates the row
 * and (re)assigns it to the CURRENT authenticated user — one physical device = one token, ownership
 * follows whoever is signed in (standard Expo/FCM behavior). Unregister deactivates, strictly scoped
 * to the owning user. Server-side writes carry an explicit org_id + user_id (tx-scoping lesson).
 */
@Injectable()
export class DeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async register(principal: RequestPrincipal, dto: RegisterDeviceTokenDto): Promise<DeviceTokenResult> {
    const row = await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        orgId: principal.orgId,
        userId: principal.userId,
        platform: dto.platform,
        token: dto.token,
        active: true,
        lastSeenAt: new Date(),
        createdBy: principal.userId,
      },
      update: {
        orgId: principal.orgId,
        userId: principal.userId,
        platform: dto.platform,
        active: true,
        lastSeenAt: new Date(),
      },
    });
    return {
      id: row.id,
      platform: dto.platform,
      token: row.token,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Deactivate a token owned by the principal. 404 if it isn't theirs (no cross-user reveal). */
  async unregister(principal: RequestPrincipal, token: string): Promise<void> {
    const res = await this.prisma.deviceToken.updateMany({
      where: { token, orgId: principal.orgId, userId: principal.userId },
      data: { active: false },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        error: DEVICE_TOKEN_ERRORS.TOKEN_NOT_FOUND,
        message: 'Device token not found for this user',
      });
    }
  }
}
