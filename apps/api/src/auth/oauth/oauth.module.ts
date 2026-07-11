import { Module } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from '../../config/auth.config';
import { OAUTH_VERIFIER, JwksOAuthVerifier } from './oauth-verifier';

/**
 * [Inc-35] Provides the real, JWKS-backed OAuth verifier (Apple + Google). Exported so AuthModule injects
 * it; e2e swaps `OAUTH_VERIFIER` for a deterministic double (same pattern as GEOCODER_PROVIDER) so account
 * link/dedupe is testable offline while the real signature verification stays the production path.
 * AUTH_CONFIG comes from the global SmsModule.
 */
@Module({
  providers: [
    { provide: OAUTH_VERIFIER, inject: [AUTH_CONFIG], useFactory: (c: AuthConfig) => new JwksOAuthVerifier(c) },
  ],
  exports: [OAUTH_VERIFIER],
})
export class OAuthModule {}
