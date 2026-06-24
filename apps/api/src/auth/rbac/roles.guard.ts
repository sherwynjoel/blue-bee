import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ERRORS, type RoleType } from '@blue-bee/shared';
import { REQUIRED_ROLES } from './decorators';
import type { RequestPrincipal } from './types';

/**
 * Global authorization guard (runs after JwtAuthGuard). If a route declares
 * `@Roles(...)`, the principal must hold at least one — else 403 (PRD §17.3).
 * No `@Roles` ⇒ any authenticated principal passes.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleType[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ principal?: RequestPrincipal }>();
    const principal = req.principal;
    const granted = principal?.roles.map((r) => r.role) ?? [];
    if (!principal || !granted.some((role) => required.includes(role))) {
      throw new ForbiddenException({
        error: AUTH_ERRORS.FORBIDDEN_ROLE,
        message: `Requires one of roles: ${required.join(', ')}`,
      });
    }
    return true;
  }
}
