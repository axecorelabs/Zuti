import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params?.orgId ?? request.params?.id;

    if (!orgId) return true;

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      include: { organization: true },
    });

    if (!member) throw new ForbiddenException('Not a member of this organization');
    if (!member.organization) throw new NotFoundException('Organization not found');

    // Attach org + role to request for use in controllers/services
    request.organization = member.organization;
    request.memberRole = member.role;

    return true;
  }
}
