import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_ERRORS } from '@blue-bee/shared';
import { TokenService } from '../token.service';
import { IS_PUBLIC } from './decorators';
import type { RequestPrincipal } from './types';

/**
 * Global authentication guard. Routes are protected by default; `@Public()` opts out.
 * Verifies the Bearer access token and attaches the derived principal to the request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { principal?: RequestPrincipal }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ error: AUTH_ERRORS.TOKEN_INVALID, message: 'Missing bearer token' });
    }
    const token = header.slice('Bearer '.length).trim();

    let claims;
    try {
      claims = this.tokens.verifyAccess(token);
    } catch (err) {
      const expired = err instanceof Error && err.name === 'TokenExpiredError';
      throw new UnauthorizedException({
        error: expired ? AUTH_ERRORS.TOKEN_EXPIRED : AUTH_ERRORS.TOKEN_INVALID,
        message: expired ? 'Access token expired' : 'Invalid access token',
      });
    }

    // Revocation check: a logged-out/theft-revoked access token is rejected before TTL.
    if (await this.tokens.isAccessRevoked(claims.jti)) {
      throw new UnauthorizedException({ error: AUTH_ERRORS.TOKEN_INVALID, message: 'Access token revoked' });
    }

    req.principal = {
      userId: claims.sub,
      orgId: claims.org_id,
      roles: claims.roles,
      accountIds: claims.scope.accountIds,
      siteIds: claims.scope.siteIds,
      jti: claims.jti,
      accessExp: claims.exp ?? Math.floor(Date.now() / 1000),
    };
    return true;
  }
}
