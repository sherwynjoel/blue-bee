import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AUTH_PROVIDERS,
  emailLoginSchema,
  logoutSchema,
  oauthSignInSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  registerSchema,
  setPasswordSchema,
  verifyEmailSchema,
  type AuthProvider,
  type EmailLoginDto,
  type LogoutDto,
  type OAuthSignInDto,
  type OtpRequestDto,
  type OtpVerifyDto,
  type PasswordResetConfirmDto,
  type PasswordResetRequestDto,
  type RefreshDto,
  type RegisterDto,
  type SetPasswordDto,
  type VerifyEmailDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CredentialAuthService } from './credential-auth.service';
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
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialAuthService,
  ) {}

  private reqCtx(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

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

  // ─────────────────────── [Inc-35] email + password ───────────────────────

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a customer with email + password (mints the account); optional referralCode is captured. Issues the same session as OTP.' })
  async register(@Body(new ZodBody(registerSchema)) body: RegisterDto, @Req() req: Request) {
    return this.credentials.register(body, this.reqCtx(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password (rate-limited; locks out after repeated failures).' })
  async login(@Body(new ZodBody(emailLoginSchema)) body: EmailLoginDto, @Req() req: Request) {
    return this.credentials.loginEmail(body, this.reqCtx(req));
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email with the single-use token sent by email.' })
  async verifyEmail(@Body(new ZodBody(verifyEmailSchema)) body: VerifyEmailDto) {
    return this.credentials.verifyEmail(body);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password-reset email (enumeration-resistant — always 200).' })
  async requestPasswordReset(@Body(new ZodBody(passwordResetRequestSchema)) body: PasswordResetRequestDto) {
    return this.credentials.requestPasswordReset(body);
  }

  @Public()
  @Post('password/reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with the single-use reset token (revokes all sessions).' })
  async confirmPasswordReset(@Body(new ZodBody(passwordResetConfirmSchema)) body: PasswordResetConfirmDto) {
    return this.credentials.confirmPasswordReset(body);
  }

  // ─────────────────────── [Inc-35] OAuth (Apple + Google) ───────────────────────

  @Public()
  @Post('oauth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Apple/Google: verifies the provider ID token SERVER-SIDE, links or creates by verified email; optional referralCode captured on create.' })
  async oauth(@Body(new ZodBody(oauthSignInSchema)) body: OAuthSignInDto, @Req() req: Request) {
    return this.credentials.oauthSignIn(body, this.reqCtx(req));
  }

  // ─────────────────────── [Inc-35] account security (authenticated) ───────────────────────

  @Get('methods')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The signed-in user's linked sign-in methods + verify state (Profile → Login & security)." })
  async getMethods(@CurrentUser() principal: RequestPrincipal) {
    return this.credentials.getSecurity(principal);
  }

  @Post('password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set or change the signed-in user\'s password (links the password method; a change requires the current one).' })
  async setPassword(@CurrentUser() principal: RequestPrincipal, @Body(new ZodBody(setPasswordSchema)) body: SetPasswordDto) {
    return this.credentials.setPassword(principal, body);
  }

  @Delete('methods/:provider')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink a sign-in method (must keep at least one).' })
  async unlinkMethod(@CurrentUser() principal: RequestPrincipal, @Param('provider') provider: string) {
    if (!(AUTH_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException({ error: 'validation_failed', message: `unknown provider '${provider}'` });
    }
    return this.credentials.unlinkMethod(principal, provider as AuthProvider);
  }
}
