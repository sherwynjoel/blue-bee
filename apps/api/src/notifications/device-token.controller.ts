import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  type RegisterDeviceTokenDto,
  type UnregisterDeviceTokenDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { DeviceTokenService } from './device-token.service';

/**
 * Device-token registration (PRD §8.5/§11.2, Increment 8). Any authenticated user registers/
 * unregisters their OWN push-delivery token (no `@Roles` ⇒ any authenticated principal; the write is
 * scoped to the principal). The real registration surface the customer/driver app uses; the Expo push
 * transport reads ACTIVE tokens for a recipient.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('device-tokens')
@UseInterceptors(IdempotencyInterceptor)
export class DeviceTokenController {
  constructor(private readonly service: DeviceTokenService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register (or re-activate) a push device token for the authenticated user.' })
  register(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(registerDeviceTokenSchema)) dto: RegisterDeviceTokenDto) {
    return this.service.register(p, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unregister (deactivate) one of the authenticated user's push device tokens." })
  unregister(
    @CurrentUser() p: RequestPrincipal,
    @Body(new ZodBody(unregisterDeviceTokenSchema)) dto: UnregisterDeviceTokenDto,
  ) {
    return this.service.unregister(p, dto.token);
  }
}
