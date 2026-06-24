import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RoleType } from '@blue-bee/shared';
import type { RequestPrincipal } from './types';

/** Marks a route as not requiring authentication (the global JwtAuthGuard skips it). */
export const IS_PUBLIC = 'auth:isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Requires the principal to hold at least one of these roles (RolesGuard, §17.3). */
export const REQUIRED_ROLES = 'auth:requiredRoles';
export const Roles = (...roles: RoleType[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

/** Injects the authenticated principal attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestPrincipal => {
  const req = ctx.switchToHttp().getRequest<{ principal: RequestPrincipal }>();
  return req.principal;
});
