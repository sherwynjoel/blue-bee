import { Logger, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { AUTH_CRED_ERRORS, type OAuthProvider } from '@blue-bee/shared';
import type { AuthConfig } from '../../config/auth.config';

/** DI token for the OAuth verifier (swapped for a deterministic double in e2e, like GEOCODER_PROVIDER). */
export const OAUTH_VERIFIER = Symbol('OAUTH_VERIFIER');

/** The verified, SERVER-TRUSTED identity extracted from a provider ID token — never client-supplied. */
export interface OAuthClaims {
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export interface OAuthVerifier {
  /** Verify a provider ID token server-side; throws UnauthorizedException on any failure. */
  verify(provider: OAuthProvider, idToken: string): Promise<OAuthClaims>;
}

/** Provider OIDC endpoints (issuer + JWKS). Public, stable metadata — not secrets. */
const PROVIDER_META: Record<OAuthProvider, { issuers: string[]; jwks: string }> = {
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuers: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys' },
};

interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
}

/**
 * [Inc-35] The REAL verifier — verifies the provider's **RS256** ID-token signature against the provider's
 * published JWKS (fetched + cached) and checks issuer + audience (the founder-supplied client id) + expiry.
 * Implemented on Node's built-in `crypto` (no dependency). Client claims are NEVER trusted:
 * `email`/`sub`/`email_verified` are read only from the cryptographically-verified payload, and the
 * algorithm is pinned to RS256 (an `alg: none`/HS256 token is rejected — the alg-confusion guard).
 * Fail-closed: a provider with no configured client id rejects every token.
 */
export class JwksOAuthVerifier implements OAuthVerifier {
  private readonly logger = new Logger('JwksOAuthVerifier');
  private readonly jwksCache = new Map<OAuthProvider, { keys: Jwk[]; fetchedAt: number }>();
  private static readonly JWKS_TTL_MS = 60 * 60 * 1000; // 1h

  constructor(private readonly config: AuthConfig) {}

  async verify(provider: OAuthProvider, idToken: string): Promise<OAuthClaims> {
    const audiences = this.config.oauth[provider].clientIds;
    if (audiences.length === 0) {
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.PROVIDER_TOKEN_INVALID, message: `${provider} sign-in is not configured` });
    }
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) throw new Error('malformed JWT');
      const [headerB64, payloadB64, sigB64] = parts;
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
      if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`); // pin RS256 (alg-confusion guard)

      const keys = await this.getJwks(provider);
      const jwk = keys.find((k) => k.kid === header.kid);
      if (!jwk) throw new Error('signing key not found in JWKS');

      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const signatureValid = cryptoVerify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, Buffer.from(sigB64, 'base64url'));
      if (!signatureValid) throw new Error('signature verification failed');

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('token expired');
      if (typeof payload.iss !== 'string' || !PROVIDER_META[provider].issuers.includes(payload.iss)) throw new Error('bad issuer');
      const auds = Array.isArray(payload.aud) ? (payload.aud as string[]) : [payload.aud as string];
      if (!auds.some((a) => audiences.includes(a))) throw new Error('audience mismatch');

      const rawEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
      return { subject: String(payload.sub), email: rawEmail || null, emailVerified };
    } catch (e) {
      this.logger.warn(`${provider} token verification failed: ${(e as Error).message}`);
      throw new UnauthorizedException({ error: AUTH_CRED_ERRORS.PROVIDER_TOKEN_INVALID, message: 'invalid provider token' });
    }
  }

  private async getJwks(provider: OAuthProvider): Promise<Jwk[]> {
    const cached = this.jwksCache.get(provider);
    if (cached && Date.now() - cached.fetchedAt < JwksOAuthVerifier.JWKS_TTL_MS) return cached.keys;
    const res = await fetch(PROVIDER_META[provider].jwks);
    if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
    const body = (await res.json()) as { keys: Jwk[] };
    this.jwksCache.set(provider, { keys: body.keys, fetchedAt: Date.now() });
    return body.keys;
  }
}
