import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params?.orgId ?? request.params?.id;

    if (!orgId) return true;

    let member: Prisma.OrganizationMemberGetPayload<{ include: { organization: true } }> | null = null;
    try {
      member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
        include: { organization: true },
      });
    } catch (error) {
      const prismaCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
      const isConnectivityError =
        (error instanceof Prisma.PrismaClientKnownRequestError && (prismaCode === 'P1001' || prismaCode === 'P1002')) ||
        error instanceof Prisma.PrismaClientInitializationError;

      if (isConnectivityError) {
        throw new ServiceUnavailableException(
          'Database is temporarily unavailable. Please try again shortly.',
        );
      }

      throw error;
    }

    if (!member) throw new ForbiddenException('Not a member of this organization');
    if (!member.organization) throw new NotFoundException('Organization not found');

    // Attach org + role to request for use in controllers/services
    request.organization = member.organization;
    request.memberRole = member.role;

    return true;
  }
}
