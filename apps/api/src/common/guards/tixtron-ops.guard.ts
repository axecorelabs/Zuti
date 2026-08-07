import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Gates the Tixtron marketplace-operator endpoints (organizer management, featured events, ad
 * approval) — deliberately separate from SuperAdminGuard, which is Zuti-wide infra access and
 * shouldn't be required just to run Tixtron's marketplace, or vice versa. Access is role-based via
 * membership in the internal "Tixtron HQ" org (Organization.isInternal), not an env-var allowlist —
 * so onboarding ops staff is just inviting them to that org, same as any other team.
 */
@Injectable()
export class TixtronOpsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id as string | undefined;
    if (!userId) throw new ForbiddenException('Tixtron ops access required');

    const internalOrg = await this.prisma.organization.findFirst({ where: { isInternal: true }, select: { id: true } });
    if (!internalOrg) throw new ForbiddenException('Tixtron ops access required');

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: internalOrg.id, userId } },
      select: { role: true },
    });
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw new ForbiddenException('Tixtron ops access required');
    }

    request.tixtronOpsOrgId = internalOrg.id;
    return true;
  }
}
