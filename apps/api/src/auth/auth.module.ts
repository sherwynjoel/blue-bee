import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { UsersController } from '../users/users.controller';
import { ReferralModule } from '../referral/referral.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CredentialAuthService } from './credential-auth.service';
import { PasswordService } from './password.service';
import { OtpService } from './otp.service';
import { PrincipalService } from './principal.service';
import { TokenService } from './token.service';
import { EmailModule } from './email/email.module';
import { OAuthModule } from './oauth/oauth.module';
import { JwtAuthGuard } from './rbac/jwt-auth.guard';
import { RolesGuard } from './rbac/roles.guard';

/**
 * Auth + RBAC (Increment 2, item 4). Registers the global authn/authz guards in
 * order: JwtAuthGuard (authenticate) → RolesGuard (authorize). SmsModule (global)
 * provides AUTH_CONFIG + the SMS transport.
 */
@Module({
  imports: [JwtModule.register({}), EmailModule, OAuthModule, ReferralModule],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    CredentialAuthService,
    PasswordService,
    OtpService,
    TokenService,
    PrincipalService,
    IdempotencyInterceptor,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [PrincipalService, TokenService, CredentialAuthService],
})
export class AuthModule {}
