import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  logoutSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  type LogoutDto,
  type OtpRequestDto,
  type OtpVerifyDto,
  type RefreshDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './rbac/decorators';
import { Public } from './rbac/decorators';
import type { RequestPrincipal } from './rbac/types';

// NOTE: idempotency is intentionally NOT applied to these credential-issuing routes —
// caching a verify/refresh response would risk replaying another caller's tokens, and
// the key would derive from unvalidated/attacker-known input. The IdempotencyInterceptor
// is reserved for authenticated domain mutations (Increment 3+), keyed by principal.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a phone-OTP code (rate-limited, enumeration-resistant).' })
  async requestOtp(@Body(new ZodBody(otpRequestSchema)) body: OtpRequestDto, @Req() req: Request) {
    return this.auth.requestOtp(body.phone, req.ip);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP code and issue an access + refresh token pair.' })
  async verify(@Body(new ZodBody(otpVerifySchema)) body: OtpVerifyDto, @Req() req: Request) {
    return this.auth.verify(body.phone, body.code, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token (reuse of an old token revokes the family).' })
  async refresh(@Body(new ZodBody(refreshSchema)) body: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the refresh-token family (logout). Requires a valid access token.' })
  async logout(@CurrentUser() principal: RequestPrincipal, @Body(new ZodBody(logoutSchema)) body: LogoutDto) {
    return this.auth.logout(principal, body.refreshToken);
  }
}
