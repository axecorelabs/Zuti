import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TixtronOpsService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext() {
    const org = await this.prisma.organization.findFirst({
      where: { isInternal: true },
      select: { id: true, name: true, slug: true },
    });
    if (!org) throw new NotFoundException('Internal Tixtron organization not provisioned yet');
    return { organizationId: org.id, organizationName: org.name, organizationSlug: org.slug };
  }

  /** Every real organizer using the ticketing product, with just enough activity signal to be
   * useful at a glance — excludes Tixtron HQ itself (isInternal). */
  async listOrganizers() {
    const orgs = await this.prisma.organization.findMany({
      where: { isInternal: false },
      select: {
        id: true, name: true, slug: true, createdAt: true,
        _count: { select: { registrationProducts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (orgs.length === 0) return { items: [] };

    const orgIds = orgs.map((o) => o.id);
    const [ticketSums, activeBotOrgs, communityOrgs] = await Promise.all([
      this.prisma.registrationEntry.groupBy({
        by: ['orgId'],
        where: { orgId: { in: orgIds }, status: { not: 'CANCELLED' } },
        _sum: { quantity: true },
      }),
      this.prisma.bot.findMany({
        where: { organizationId: { in: orgIds }, isActive: true, botType: 'COMMAND' },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
      this.prisma.community.findMany({ where: { orgId: { in: orgIds } }, select: { orgId: true } }),
    ]);
    const ticketsByOrg = new Map(ticketSums.map((t) => [t.orgId, t._sum.quantity ?? 0]));
    const activeBotOrgSet = new Set(activeBotOrgs.map((b) => b.organizationId));
    const communityOrgSet = new Set(communityOrgs.map((c) => c.orgId as string));

    return {
      items: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt,
        eventCount: o._count.registrationProducts,
        ticketsSold: ticketsByOrg.get(o.id) ?? 0,
        hasActiveBot: activeBotOrgSet.has(o.id),
        hasCommunity: communityOrgSet.has(o.id),
      })),
    };
  }

  /** Events across every organizer (plus Tixtron's own), for curation — not org-scoped, this is
   * the whole point of the Featured Events tool. */
  async listEventsForCuration(q?: string) {
    const items = await this.prisma.registrationProduct.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      select: {
        id: true, name: true, eventDate: true, isPublic: true, isActive: true,
        isFeatured: true, featuredOrder: true,
        organization: { select: { name: true } },
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return { items: items.map((i) => ({ ...i, organizationName: i.organization.name, organization: undefined })) };
  }

  async setEventFeatured(productId: string, isFeatured: boolean, featuredOrder?: number) {
    const product = await this.prisma.registrationProduct.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Event not found');
    return this.prisma.registrationProduct.update({
      where: { id: productId },
      data: { isFeatured, featuredOrder: isFeatured ? (featuredOrder ?? 0) : null },
    });
  }

  /** Tixtron's own email list — Customer rows scoped to the internal org (isInternal), consented via
   * the ticket-page opt-in. Same consent/opt-out fields every org already has, just Tixtron's own. */
  async listEmailSubscribers() {
    const internalOrg = await this.prisma.organization.findFirst({ where: { isInternal: true }, select: { id: true } });
    if (!internalOrg) throw new NotFoundException('Internal Tixtron organization not provisioned yet');

    const items = await this.prisma.customer.findMany({
      where: { orgId: internalOrg.id, marketingConsentAt: { not: null }, emailOptOut: false, primaryEmail: { not: null } },
      select: { id: true, displayName: true, primaryEmail: true, marketingConsentAt: true, firstSeenAt: true },
      orderBy: { marketingConsentAt: 'desc' },
    });
    return { items };
  }
}
