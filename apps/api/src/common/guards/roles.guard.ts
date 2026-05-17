import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/** Use @RequireRole('OWNER', 'ADMIN') on controller methods */
export function RequireRole(...roles: string[]) {
  return (target: object, key?: string | symbol, descriptor?: TypedPropertyDescriptor<unknown>) => {
    if (descriptor) {
      Reflect.defineMetadata(ROLES_KEY, roles, descriptor.value as object);
    } else {
      Reflect.defineMetadata(ROLES_KEY, roles, target);
    }
    return descriptor ?? target;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(ROLES_KEY, context.getHandler());
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const role: string | undefined = request.memberRole;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
