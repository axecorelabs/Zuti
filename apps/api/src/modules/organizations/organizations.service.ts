import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CreditLedgerType,
  Prisma,
  WorkspaceSetupRequestStatus,
} from '@prisma/client';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/organization.dto';
import { ActivityService, ActivityAction } from '../activity/activity.service';
import { CREDIT_UNITS_PER_CREDIT } from '../billing/credit-model';
import { MailService } from '../mail/mail.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);
  private static readonly setupWorkspaceNamePrefix = 'Workspace name:';

  // Short-lived per-user cache for the cross-workspace overview. It's latency-bound (many DB round
  // trips), changes rarely, and is read on every global-overview visit — so a brief cache absorbs
  // repeat loads. Busted explicitly when a user's org list changes (see invalidateOverview).
  private readonly overviewCache = new Map<string, { data: unknown; expires: number }>();
  private static readonly OVERVIEW_TTL_MS = 15_000;

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private mail: MailService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Drop a user's cached overview so their next visit reflects an org-list change immediately. */
  invalidateOverview(userId: string) {
    this.overviewCache.delete(userId);
  }

  // ── Payout account (org-level Paystack subaccount) ────────────────────────────
  // Where the org's ticket & product sales settle. Set up once per org; events and commerce route
  // their split here, so Zuti never takes custody of the org's money. Connecting is OWNER-only.

  private async assertOrgRole(orgId: string, userId: string, roles: Array<'OWNER' | 'ADMIN' | 'AGENT'>) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: { role: true },
    });
    if (!member) throw new ForbiddenException('You are not a member of this organization');
    if (!roles.includes(member.role as 'OWNER' | 'ADMIN' | 'AGENT')) {
      throw new ForbiddenException('You do not have permission to do this');
    }
  }

  /** Paystack NGN banks for the payout-account setup dropdown. */
  async listPayoutBanks() {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    const res = await firstValueFrom(
      this.http.get<{ status: boolean; data: Array<{ name: string; code: string; active: boolean }> }>(
        'https://api.paystack.co/bank',
        { params: { currency: 'NGN', use_cursor: false, perPage: 100 }, headers: { Authorization: `Bearer ${secret}` } },
      ),
    );
    return (res.data?.data ?? []).filter((b) => b.active).map((b) => ({ name: b.name, code: b.code }));
  }

  /** Resolve an account number → account name (for confirm-before-connect). */
  async resolvePayoutAccount(accountNumber: string, bankCode: string) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    type ResolveResponse = { status: boolean; message: string; data?: { account_name: string } };
    const res = await firstValueFrom(
      this.http.get<ResolveResponse>('https://api.paystack.co/bank/resolve', {
        params: { account_number: accountNumber, bank_code: bankCode },
        headers: { Authorization: `Bearer ${secret}` },
      }),
    );
    if (!res.data?.status || !res.data?.data?.account_name) {
      throw new BadRequestException(res.data?.message ?? 'Could not resolve account');
    }
    return { accountName: res.data.data.account_name };
  }

  /** The org's current payout status (read-only for any member; used by the UI + sell-gate). */
  async getPayoutStatus(orgId: string, userId: string) {
    await this.assertOrgRole(orgId, userId, ['OWNER', 'ADMIN', 'AGENT']);
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { paystackSubaccountCode: true, payoutBusinessName: true, payoutBankName: true, payoutAccountLast4: true, payoutAccountName: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return {
      connected: !!org.paystackSubaccountCode,
      businessName: org.payoutBusinessName,
      bankName: org.payoutBankName,
      accountLast4: org.payoutAccountLast4,
      accountName: org.payoutAccountName,
      platformFeePercent: 5,
    };
  }

  /** OWNER-only: create/replace the org's Paystack subaccount and store it. Sales settle here after. */
  async setupPayoutAccount(orgId: string, userId: string, dto: { businessName: string; settlementBank: string; bankName?: string; accountNumber: string; primaryContactEmail?: string }) {
    await this.assertOrgRole(orgId, userId, ['OWNER']);
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');

    // Confirm the account resolves to a real name before creating the subaccount.
    const { accountName } = await this.resolvePayoutAccount(dto.accountNumber, dto.settlementBank);

    type SubaccountResponse = { status: boolean; message: string; data?: { subaccount_code: string } };
    const response = await firstValueFrom(
      this.http.post<SubaccountResponse>(
        'https://api.paystack.co/subaccount',
        {
          business_name: dto.businessName,
          settlement_bank: dto.settlementBank,
          account_number: dto.accountNumber,
          // Paystack's percentage_charge is the PLATFORM's share, not the subaccount's (verified
          // against Paystack's docs — "20% going to main account and the rest going to subaccount").
          // 5 means Zuti takes 5% and the merchant keeps 95% by default. Registration payments always
          // override this per-transaction via transaction_charge (see payment-split.ts), so this
          // stored value only matters as the fallback for any charge that doesn't send an override.
          percentage_charge: 5,
          ...(dto.primaryContactEmail ? { primary_contact_email: dto.primaryContactEmail } : {}),
        },
        { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } },
      ),
    );
    if (!response.data?.status || !response.data?.data?.subaccount_code) {
      throw new BadRequestException(`Paystack subaccount creation failed: ${response.data?.message ?? 'Unknown error'}`);
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        paystackSubaccountCode: response.data.data.subaccount_code,
        payoutBusinessName: dto.businessName,
        payoutBankName: dto.bankName ?? null,
        payoutAccountLast4: dto.accountNumber.slice(-4),
        payoutAccountName: accountName,
      },
    });
    return this.getPayoutStatus(orgId, userId);
  }

  private parseWorkspaceNameFromNote(note: string | null | undefined) {
    if (!note) return null;
    const line = note
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.toLowerCase().startsWith(OrganizationsService.setupWorkspaceNamePrefix.toLowerCase()));

    if (!line) return null;
    const name = line.slice(OrganizationsService.setupWorkspaceNamePrefix.length).trim();
    return name.length > 0 ? name : null;
  }

  private toSlugBase(input: string) {
    const normalized = input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized.slice(0, 45) || `workspace-${Date.now().toString(36)}`;
  }

  private async getUniqueSlug(tx: Prisma.TransactionClient, base: string) {
    const safeBase = base.slice(0, 45);
    let candidate = safeBase;
    let counter = 1;

    for (;;) {
      const exists = await tx.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;

      counter += 1;
      const suffix = `-${counter}`;
      candidate = `${safeBase.slice(0, Math.max(2, 50 - suffix.length))}${suffix}`;
    }
  }

  async create(userId: string, dto: CreateOrganizationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, canCreateWorkspace: true },
    });
    if (!user) {
      throw new UnauthorizedException('Session is no longer valid. Please sign in again.');
    }

    if (!user.canCreateWorkspace) {
      throw new ForbiddenException('You are not allowed to create workspaces at this time');
    }

    const slugTaken = await this.prisma.organization.findUnique({ where: { slug: dto.slug } });
    if (slugTaken) throw new ConflictException('Slug already taken');

    // Policy: users can create unlimited organizations. Only their first org gets free starter credits.
    const existingMembershipCount = await this.prisma.organizationMember.count({
      where: { userId },
    });
    const starterCreditGrant = existingMembershipCount === 0 ? 100 : 0;
    const starterCreditUnits = starterCreditGrant * CREDIT_UNITS_PER_CREDIT;

    const org = await this.prisma.$transaction(async (tx) => {
      const createdOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          members: {
            create: { userId, role: 'OWNER' },
          },
          billing: {
            create: {
              plan: 'STARTER',
              messageCount: 0,
              // Reusing existing billing capacity fields for startup wallet allocation.
              messageLimit: starterCreditGrant,
              creditBalanceUnits: starterCreditUnits,
              committedMonthlyCreditsUnits: 0,
            },
          },
        },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
          billing: true,
        },
      });

      if (starterCreditGrant > 0 && createdOrg.billing) {
        await tx.creditLedger.create({
          data: {
            organizationId: createdOrg.id,
            billingId: createdOrg.billing.id,
            type: CreditLedgerType.GRANT,
            creditsDeltaUnits: starterCreditUnits,
            balanceAfterUnits: starterCreditUnits,
            description: `Starter credit grant on organization creation (${starterCreditGrant} credits)`,
            idempotencyKey: `org:${createdOrg.id}:starter-credit-grant`,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
            },
          },
        });

        await tx.activityLog.create({
          data: {
            orgId: createdOrg.id,
            actorId: userId,
            actorName: createdOrg.members[0]?.user?.name ?? createdOrg.members[0]?.user?.email ?? 'Organization Owner',
            action: 'BILLING_CREDIT_GRANTED',
            targetType: 'billing',
            targetId: createdOrg.billing.id,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
              balanceAfterCredits: starterCreditGrant,
              balanceAfterUnits: starterCreditUnits,
            },
          },
        });

        await tx.notification.create({
          data: {
            orgId: createdOrg.id,
            type: 'billing_credit_granted',
            title: 'Starter credits granted',
            body: `${starterCreditGrant} starter credits were allocated to this organization.`,
            metadata: {
              source: 'organization_create',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
            },
            targetUserId: null,
          },
        });
      }

      return createdOrg;
    });

    this.invalidateOverview(userId); // new org → the creator's overview changed
    return org;
  }

  async listVerifiedManagers() {
    const managers = await this.prisma.managerProfile.findMany({
      where: {
        status: 'VERIFIED',
        user: { role: 'MANAGER' },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        displayName: true,
        bio: true,
        specialties: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return managers.map((manager) => ({
      id: manager.user.id,
      displayName: manager.displayName ?? manager.user.name ?? manager.user.email,
      bio: manager.bio,
      specialties: manager.specialties,
      contactEmail: manager.user.email,
    }));
  }

  async autoAssignVerifiedManager(requesterId: string) {
    const managers = await this.prisma.managerProfile.findMany({
      where: {
        status: 'VERIFIED',
        user: { role: 'MANAGER' },
      },
      select: {
        id: true,
        displayName: true,
        bio: true,
        specialties: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (managers.length === 0) {
      throw new NotFoundException('No verified managers are currently available');
    }

    const managerUserIds = managers.map((manager) => manager.user.id);

    const activeStatuses: WorkspaceSetupRequestStatus[] = ['PENDING', 'CONTACTED'];
    const activeRequests = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        managerId: { in: managerUserIds },
        status: { in: activeStatuses },
      },
      select: {
        managerId: true,
      },
    });

    const activeCountByManager = new Map<string, number>();
    for (const item of activeRequests) {
      activeCountByManager.set(item.managerId, (activeCountByManager.get(item.managerId) ?? 0) + 1);
    }

    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAssignments = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        managerId: { in: managerUserIds },
        createdAt: { gte: last24Hours },
      },
      select: {
        managerId: true,
      },
    });

    const recentCountByManager = new Map<string, number>();
    for (const item of recentAssignments) {
      recentCountByManager.set(item.managerId, (recentCountByManager.get(item.managerId) ?? 0) + 1);
    }

    const requesterActive = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        requesterId,
        managerId: { in: managerUserIds },
        status: { in: activeStatuses },
      },
      select: {
        managerId: true,
      },
    });

    const blockedManagers = new Set(requesterActive.map((item) => item.managerId));
    const candidates = managers.filter((manager) => !blockedManagers.has(manager.user.id));

    if (candidates.length === 0) {
      throw new ConflictException('You already have active setup requests with available managers');
    }

    const scoreForManager = (managerId: string) => {
      const openRequests = activeCountByManager.get(managerId) ?? 0;
      const assignedLast24h = recentCountByManager.get(managerId) ?? 0;
      return openRequests * 5 + assignedLast24h * 2;
    };

    const hashTieBreaker = (managerId: string) =>
      createHash('sha256').update(`${requesterId}:${managerId}`).digest('hex');

    const selected = candidates
      .map((manager) => ({
        manager,
        score: scoreForManager(manager.user.id),
        tie: hashTieBreaker(manager.user.id),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.tie.localeCompare(b.tie);
      })[0]?.manager;

    if (!selected) {
      throw new NotFoundException('No verified managers are currently available');
    }

    return {
      item: {
        id: selected.user.id,
        displayName: selected.displayName ?? selected.user.name ?? selected.user.email,
        bio: selected.bio,
        specialties: selected.specialties,
        contactEmail: selected.user.email,
      },
    };
  }

  async requestWorkspaceSetup(
    requesterId: string,
    dto: {
      managerId: string;
      preferredContactMode: 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'TELEGRAM';
      contactDetail: string;
      workspaceName: string;
      note: string;
    },
  ) {
    if (requesterId === dto.managerId) {
      throw new ConflictException('You cannot request setup assistance from your own account');
    }

    const manager = await this.prisma.user.findUnique({
      where: { id: dto.managerId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        managerProfile: { select: { status: true, displayName: true } },
      },
    });

    if (!manager || manager.role !== 'MANAGER' || manager.managerProfile?.status !== 'VERIFIED') {
      throw new NotFoundException('Verified manager not found');
    }

    const businessNature = dto.note?.trim();
    if (!businessNature) {
      throw new BadRequestException('Please specify the nature of your business');
    }
    if (businessNature.length < 20) {
      throw new BadRequestException('Nature of business must be at least 20 characters');
    }

    const workspaceName = dto.workspaceName?.trim();
    const contactDetail = dto.contactDetail?.trim();
    if (!workspaceName) {
      throw new BadRequestException('Please provide the organization/workspace name');
    }
    if (!contactDetail) {
      throw new BadRequestException('Please provide your contact details');
    }

    const preferredContactMode = dto.preferredContactMode;
    const requestNote = [
      `Workspace name: ${workspaceName}`,
      `Preferred contact mode: ${preferredContactMode}`,
      `Contact detail: ${contactDetail}`,
      `Business description: ${businessNature}`,
    ].join('\n');

    try {
      const created = await this.prisma.workspaceSetupRequest.create({
        data: {
          requesterId,
          managerId: dto.managerId,
          status: 'PENDING',
          note: requestNote,
        },
      });

      const requester = await this.prisma.user.findUnique({
        where: { id: requesterId },
        select: { id: true, name: true, email: true },
      });

      const requesterNameOrEmail = requester?.name ?? requester?.email ?? 'Requester';
      const managerNameOrEmail = manager.managerProfile?.displayName ?? manager.name ?? manager.email;

      if (manager.email) {
        this.mail.sendWorkspaceSetupRequestCreatedEmail({
          to: manager.email,
          recipientRole: 'MANAGER',
          recipientName: manager.name ?? undefined,
          requesterNameOrEmail,
          managerNameOrEmail,
          requestNote: created.note,
        }).catch((err) => {
          this.logger.warn(`Failed to send manager setup request email: ${String(err)}`);
        });
      }

      if (requester?.email) {
        this.mail.sendWorkspaceSetupRequestCreatedEmail({
          to: requester.email,
          recipientRole: 'REQUESTER',
          recipientName: requester.name ?? undefined,
          requesterNameOrEmail,
          managerNameOrEmail,
          requestNote: created.note,
        }).catch((err) => {
          this.logger.warn(`Failed to send requester setup request email: ${String(err)}`);
        });
      }

      return { item: created };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError
        && err.code === 'P2002'
      ) {
        throw new ConflictException('A pending setup request to this manager already exists');
      }
      throw err;
    }
  }

  async listSetupRequestsForRequester(
    requesterId: string,
    status?: WorkspaceSetupRequestStatus,
  ) {
    const items = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        requesterId,
        ...(status ? { status } : {}),
      },
      include: {
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            managerProfile: {
              select: {
                status: true,
                displayName: true,
              },
            },
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { total: items.length, items };
  }

  async listSetupRequestsAssignedToManager(
    managerId: string,
    status?: WorkspaceSetupRequestStatus,
  ) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: {
        id: true,
        role: true,
        managerProfile: { select: { status: true } },
      },
    });

    if (!manager || manager.role !== 'MANAGER' || manager.managerProfile?.status !== 'VERIFIED') {
      throw new ForbiddenException('Only verified managers can view assigned setup requests');
    }

    const items = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        managerId,
        ...(status ? { status } : {}),
      },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { total: items.length, items };
  }

  async updateSetupRequestStatus(
    actorId: string,
    requestId: string,
    status: WorkspaceSetupRequestStatus,
  ) {
    const request = await this.prisma.workspaceSetupRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Setup request not found');
    }

    const isManager = request.managerId === actorId;
    const isRequester = request.requesterId === actorId;

    if (!isManager && !isRequester) {
      throw new ForbiddenException('You cannot update this setup request');
    }

    if (
      request.status === 'COMPLETED'
      || request.status === 'REQUESTER_ADDED'
      || request.status === 'DECLINED'
      || request.status === 'CANCELED'
    ) {
      throw new ConflictException('This setup request is already closed');
    }

    if (isManager && status === 'CANCELED') {
      throw new ForbiddenException('Managers cannot cancel setup requests');
    }

    if (isRequester && status !== 'CANCELED') {
      throw new ForbiddenException('Requesters can only cancel setup requests');
    }

    if (isRequester && status === 'CANCELED' && !['PENDING', 'CONTACTED'].includes(request.status)) {
      throw new ConflictException('You can only cancel setup requests while they are pending or contacted');
    }

    if (isManager && (status === 'COMPLETED' || status === 'ORG_CREATED' || status === 'REQUESTER_ADDED') && !request.organizationId) {
      throw new ConflictException('Use create organization action to complete setup requests');
    }

    if (request.status === status) {
      return { item: request };
    }

    const updated = await this.prisma.workspaceSetupRequest.update({
      where: { id: requestId },
      data: { status },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    const requesterNameOrEmail = updated.requester.name ?? updated.requester.email;
    const managerNameOrEmail = updated.manager.name ?? updated.manager.email;

    if (updated.manager.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.manager.email,
        recipientRole: 'MANAGER',
        recipientName: updated.manager.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status,
      }).catch((err) => {
        this.logger.warn(`Failed to send manager setup status email: ${String(err)}`);
      });
    }

    if (updated.requester.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.requester.email,
        recipientRole: 'REQUESTER',
        recipientName: updated.requester.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status,
      }).catch((err) => {
        this.logger.warn(`Failed to send requester setup status email: ${String(err)}`);
      });
    }

    return { item: updated };
  }

  async createOrganizationFromSetupRequest(managerId: string, requestId: string) {
    const request = await this.prisma.workspaceSetupRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            managerProfile: { select: { status: true } },
          },
        },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Setup request not found');
    }

    if (request.managerId !== managerId) {
      throw new ForbiddenException('You cannot create organizations for this setup request');
    }

    if (request.manager.role !== 'MANAGER' || request.manager.managerProfile?.status !== 'VERIFIED') {
      throw new ForbiddenException('Only verified managers can create organizations from setup requests');
    }

    if (request.organizationId && request.organization) {
      return { item: request, organization: request.organization };
    }

    if (!['PENDING', 'CONTACTED'].includes(request.status)) {
      throw new ConflictException('Only pending or contacted setup requests can create organizations');
    }

    const requestedWorkspaceName = this.parseWorkspaceNameFromNote(request.note)
      ?? request.requester.name
      ?? request.requester.email.split('@')[0]
      ?? 'Workspace';

    const existingMembershipCount = await this.prisma.organizationMember.count({
      where: { userId: request.requesterId },
    });
    const starterCreditGrant = existingMembershipCount === 0 ? 100 : 0;
    const starterCreditUnits = starterCreditGrant * CREDIT_UNITS_PER_CREDIT;

    const result = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.workspaceSetupRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          organizationId: true,
          managerId: true,
          requesterId: true,
        },
      });

      if (!latest) {
        throw new NotFoundException('Setup request not found');
      }

      if (latest.managerId !== managerId) {
        throw new ForbiddenException('You cannot create organizations for this setup request');
      }

      if (latest.organizationId) {
        const existingOrg = await tx.organization.findUnique({
          where: { id: latest.organizationId },
          select: { id: true, name: true, slug: true },
        });
        return {
          createdOrg: existingOrg,
          organizationAlreadyLinked: true,
        };
      }

      if (!['PENDING', 'CONTACTED'].includes(latest.status)) {
        throw new ConflictException('Only pending or contacted setup requests can create organizations');
      }

      const slugBase = this.toSlugBase(requestedWorkspaceName);
      const slug = await this.getUniqueSlug(tx, slugBase);

      const createdOrg = await tx.organization.create({
        data: {
          name: requestedWorkspaceName,
          slug,
          members: {
            create: [
              { userId: managerId, role: 'OWNER' },
              { userId: request.requesterId, role: 'ADMIN' },
            ],
          },
          billing: {
            create: {
              plan: 'STARTER',
              messageCount: 0,
              messageLimit: starterCreditGrant,
              creditBalanceUnits: starterCreditUnits,
              committedMonthlyCreditsUnits: 0,
            },
          },
        },
        include: {
          billing: { select: { id: true } },
        },
      });

      if (starterCreditGrant > 0 && createdOrg.billing) {
        await tx.creditLedger.create({
          data: {
            organizationId: createdOrg.id,
            billingId: createdOrg.billing.id,
            type: CreditLedgerType.GRANT,
            creditsDeltaUnits: starterCreditUnits,
            balanceAfterUnits: starterCreditUnits,
            description: `Starter credit grant on organization creation (${starterCreditGrant} credits)`,
            idempotencyKey: `org:${createdOrg.id}:starter-credit-grant`,
            metadata: {
              source: 'workspace_setup_request_create_org',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
              setupRequestId: requestId,
            },
          },
        });

        await tx.activityLog.create({
          data: {
            orgId: createdOrg.id,
            actorId: managerId,
            actorName: request.manager.name ?? request.manager.email ?? 'Manager',
            action: 'BILLING_CREDIT_GRANTED',
            targetType: 'billing',
            targetId: createdOrg.billing.id,
            metadata: {
              source: 'workspace_setup_request_create_org',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
              balanceAfterCredits: starterCreditGrant,
              balanceAfterUnits: starterCreditUnits,
              setupRequestId: requestId,
            },
          },
        });

        await tx.notification.create({
          data: {
            orgId: createdOrg.id,
            type: 'billing_credit_granted',
            title: 'Starter credits granted',
            body: `${starterCreditGrant} starter credits were allocated to this organization.`,
            metadata: {
              source: 'workspace_setup_request_create_org',
              creditsGranted: starterCreditGrant,
              creditsGrantedUnits: starterCreditUnits,
              setupRequestId: requestId,
            },
            targetUserId: null,
          },
        });
      }

      await tx.workspaceSetupRequest.update({
        where: { id: requestId },
        data: {
          status: 'REQUESTER_ADDED',
          organizationId: createdOrg.id,
        },
      });

      return {
        createdOrg: {
          id: createdOrg.id,
          name: createdOrg.name,
          slug: createdOrg.slug,
        },
        organizationAlreadyLinked: false,
      };
    }, {
      timeout: 20_000,
    });

    const updatedRequest = await this.prisma.workspaceSetupRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!updatedRequest) {
      throw new NotFoundException('Setup request not found after creating organization');
    }

    if (result.organizationAlreadyLinked) {
      return {
        item: updatedRequest,
        organization: result.createdOrg,
      };
    }

    const requesterNameOrEmail = updatedRequest.requester.name ?? updatedRequest.requester.email;
    const managerNameOrEmail = updatedRequest.manager.name ?? updatedRequest.manager.email;

    if (updatedRequest.manager.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updatedRequest.manager.email,
        recipientRole: 'MANAGER',
        recipientName: updatedRequest.manager.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'REQUESTER_ADDED',
      }).catch((err) => {
        this.logger.warn(`Failed to send manager setup status email: ${String(err)}`);
      });
    }

    if (updatedRequest.requester.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updatedRequest.requester.email,
        recipientRole: 'REQUESTER',
        recipientName: updatedRequest.requester.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'REQUESTER_ADDED',
      }).catch((err) => {
        this.logger.warn(`Failed to send requester setup status email: ${String(err)}`);
      });
    }

    return {
      item: updatedRequest,
      organization: result.createdOrg,
    };
  }

  async retryRequesterAddFromSetupRequest(managerId: string, requestId: string) {
    const request = await this.prisma.workspaceSetupRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            managerProfile: { select: { status: true } },
          },
        },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Setup request not found');
    }

    if (request.managerId !== managerId) {
      throw new ForbiddenException('You cannot retry requester add for this setup request');
    }

    if (request.manager.role !== 'MANAGER' || request.manager.managerProfile?.status !== 'VERIFIED') {
      throw new ForbiddenException('Only verified managers can retry requester membership for setup requests');
    }

    if (!request.organizationId || !request.organization) {
      throw new ConflictException('No organization is linked to this setup request yet');
    }

    if (request.status === 'REQUESTER_ADDED' || request.status === 'COMPLETED') {
      return { item: request, organization: request.organization };
    }

    if (request.status !== 'ORG_CREATED') {
      throw new ConflictException('Retry requester add is only available when request status is ORG_CREATED');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: request.organizationId!,
            userId: request.requesterId,
          },
        },
        update: {},
        create: {
          organizationId: request.organizationId!,
          userId: request.requesterId,
          role: 'ADMIN',
        },
      });

      return tx.workspaceSetupRequest.update({
        where: { id: requestId },
        data: { status: 'REQUESTER_ADDED' },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          manager: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true, slug: true } },
        },
      });
    });

    const requesterNameOrEmail = updated.requester.name ?? updated.requester.email;
    const managerNameOrEmail = updated.manager.name ?? updated.manager.email;

    if (updated.manager.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.manager.email,
        recipientRole: 'MANAGER',
        recipientName: updated.manager.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'REQUESTER_ADDED',
      }).catch((err) => {
        this.logger.warn(`Failed to send manager setup status email: ${String(err)}`);
      });
    }

    if (updated.requester.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.requester.email,
        recipientRole: 'REQUESTER',
        recipientName: updated.requester.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'REQUESTER_ADDED',
      }).catch((err) => {
        this.logger.warn(`Failed to send requester setup status email: ${String(err)}`);
      });
    }

    return {
      item: updated,
      organization: updated.organization,
    };
  }

  async finalizeSetupHandover(managerId: string, requestId: string) {
    const request = await this.prisma.workspaceSetupRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            managerProfile: { select: { status: true } },
          },
        },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Setup request not found');
    }

    if (request.managerId !== managerId) {
      throw new ForbiddenException('You cannot finalize handover for this setup request');
    }

    if (request.manager.role !== 'MANAGER' || request.manager.managerProfile?.status !== 'VERIFIED') {
      throw new ForbiddenException('Only verified managers can finalize setup handover');
    }

    if (!request.organizationId || !request.organization) {
      throw new ConflictException('No organization is linked to this setup request yet');
    }

    if (request.status === 'COMPLETED') {
      return { item: request, organization: request.organization };
    }

    if (request.status !== 'REQUESTER_ADDED') {
      throw new ConflictException('Handover can only be finalized after requester has been added');
    }

    const [managerMembership, requesterMembership] = await Promise.all([
      this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: request.organizationId,
            userId: request.managerId,
          },
        },
        select: { role: true },
      }),
      this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: request.organizationId,
            userId: request.requesterId,
          },
        },
        select: { role: true },
      }),
    ]);

    if (!managerMembership || !requesterMembership) {
      throw new ConflictException('Manager and requester must both be organization members before handover');
    }

    if (!(managerMembership.role !== 'OWNER' && requesterMembership.role === 'OWNER')) {
      await this.transferOwnership(request.organizationId, request.managerId, request.requesterId);
    }

    const updated = await this.prisma.workspaceSetupRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED' },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    const requesterNameOrEmail = updated.requester.name ?? updated.requester.email;
    const managerNameOrEmail = updated.manager.name ?? updated.manager.email;

    if (updated.manager.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.manager.email,
        recipientRole: 'MANAGER',
        recipientName: updated.manager.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'COMPLETED',
      }).catch((err) => {
        this.logger.warn(`Failed to send manager setup status email: ${String(err)}`);
      });
    }

    if (updated.requester.email) {
      this.mail.sendWorkspaceSetupRequestStatusEmail({
        to: updated.requester.email,
        recipientRole: 'REQUESTER',
        recipientName: updated.requester.name ?? undefined,
        requesterNameOrEmail,
        managerNameOrEmail,
        status: 'COMPLETED',
      }).catch((err) => {
        this.logger.warn(`Failed to send requester setup status email: ${String(err)}`);
      });
    }

    return {
      item: updated,
      organization: updated.organization,
    };
  }

  async findAllForUser(userId: string) {
    const orgs = await this.prisma.organization.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        billing: {
          select: {
            plan: true,
            messageCount: true,
            messageLimit: true,
            creditBalanceUnits: true,
            committedMonthlyCreditsUnits: true,
            commitmentRenewsAt: true,
            renewsAt: true,
          },
        },
        _count: { select: { bots: true, conversations: true } },
      },
    });

    return orgs.map((org) => {
      // Never expose the payout account (subaccount code + bank details) in the general org list —
      // it's read by every member (incl. AGENTs); those fields belong only to the OWNER-gated
      // Payouts endpoint.
      const { paystackSubaccountCode, payoutBusinessName, payoutBankName, payoutAccountLast4, payoutAccountName, ...safe } = org;
      void paystackSubaccountCode; void payoutBusinessName; void payoutBankName; void payoutAccountLast4; void payoutAccountName;
      return {
        ...safe,
        billing: org.billing
          ? {
              ...org.billing,
              creditBalance: Number((org.billing.creditBalanceUnits / 100).toFixed(2)),
              committedMonthlyCredits: Number((org.billing.committedMonthlyCreditsUnits / 100).toFixed(2)),
            }
          : org.billing,
      };
    });
  }

  async findSummaryForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      select: {
        role: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            _count: {
              select: {
                members: true,
                bots: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const orgIds = memberships.map((membership) => membership.organization.id);
    const activeSetupRequests = await this.prisma.workspaceSetupRequest.findMany({
      where: {
        managerId: userId,
        status: { in: ['PENDING', 'CONTACTED'] },
      },
      select: { requesterId: true },
    });

    const requesterIds = Array.from(new Set(activeSetupRequests.map((item) => item.requesterId)));
    const setupMemberLinks = requesterIds.length === 0 || orgIds.length === 0
      ? []
      : await this.prisma.organizationMember.findMany({
          where: {
            organizationId: { in: orgIds },
            userId: { in: requesterIds },
          },
          select: {
            organizationId: true,
            userId: true,
          },
        });

    const setupCountByOrg = new Map<string, number>();
    for (const link of setupMemberLinks) {
      setupCountByOrg.set(link.organizationId, (setupCountByOrg.get(link.organizationId) ?? 0) + 1);
    }

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
      memberCount: membership.organization._count.members,
      botCount: membership.organization._count.bots,
      managerSetupActiveCount: setupCountByOrg.get(membership.organization.id) ?? 0,
      managerSetupInProgress: (setupCountByOrg.get(membership.organization.id) ?? 0) > 0,
    }));
  }

  async findOverviewForUser(userId: string) {
    const cached = this.overviewCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.data;

    // ONE round-trip for the whole org list: memberships + per-org member/bot counts + per-org
    // conversation status counts (agent visibility applied in the JOIN), fetched in parallel with the
    // user's role. Replaces the old memberships → 2× groupBy → user-role chain (was ~4 sequential DB
    // waves; this is 1). The overview is latency-bound, so cutting round-trips is the real win.
    type OverviewRow = {
      role: string; id: string; name: string; slug: string;
      member_count: number; bot_count: number;
      conv_total: number; conv_open: number; conv_resolved: number; conv_escalated: number; conv_pending: number;
    };
    const [rows, user] = await Promise.all([
      this.prisma.$queryRawUnsafe<OverviewRow[]>(
        `SELECT om.role::text AS role, o.id, o.name, o.slug,
           (SELECT COUNT(*)::int FROM "OrganizationMember" m WHERE m."organizationId" = o.id) AS member_count,
           (SELECT COUNT(*)::int FROM "Bot" b WHERE b."organizationId" = o.id) AS bot_count,
           COUNT(c.id)::int AS conv_total,
           (COUNT(c.id) FILTER (WHERE c.status = 'OPEN'))::int AS conv_open,
           (COUNT(c.id) FILTER (WHERE c.status = 'RESOLVED'))::int AS conv_resolved,
           (COUNT(c.id) FILTER (WHERE c.status = 'ESCALATED'))::int AS conv_escalated,
           (COUNT(c.id) FILTER (WHERE c.status = 'PENDING'))::int AS conv_pending
         FROM "OrganizationMember" om
         JOIN "Organization" o ON o.id = om."organizationId"
         LEFT JOIN "Conversation" c ON c."organizationId" = o.id
           AND (om.role <> 'AGENT' OR c."assignedAgentId" = $1 OR c."assignedAgentId" IS NULL)
         WHERE om."userId" = $1
         GROUP BY om.role, o.id, o.name, o.slug, om."createdAt"
         ORDER BY om."createdAt" ASC`,
        userId,
      ),
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    ]);

    const organizations = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      role: r.role,
      memberCount: r.role === 'AGENT' ? null : Number(r.member_count),
      botCount: r.role === 'AGENT' ? null : Number(r.bot_count),
      conversationTotals: {
        total: Number(r.conv_total),
        open: Number(r.conv_open),
        resolved: Number(r.conv_resolved),
        escalated: Number(r.conv_escalated),
        pending: Number(r.conv_pending),
      },
    }));

    const totals = organizations.reduce((acc, org) => {
      acc.organizationCount += 1;
      acc.conversations.total += org.conversationTotals.total;
      acc.conversations.open += org.conversationTotals.open;
      acc.conversations.resolved += org.conversationTotals.resolved;
      acc.conversations.escalated += org.conversationTotals.escalated;
      acc.conversations.pending += org.conversationTotals.pending;
      if (typeof org.memberCount === 'number') acc.visibleMemberCount += org.memberCount;
      if (typeof org.botCount === 'number') acc.visibleBotCount += org.botCount;
      return acc;
    }, {
      organizationCount: 0,
      visibleMemberCount: 0,
      visibleBotCount: 0,
      conversations: {
        total: 0,
        open: 0,
        resolved: 0,
        escalated: 0,
        pending: 0,
      },
    });

    // `user` (role) was already fetched in parallel with the org query above.

    let setupRequests: {
      totals: {
        total: number;
        pending: number;
        contacted: number;
        orgCreated: number;
        requesterAdded: number;
        completed: number;
        declined: number;
        canceled: number;
      };
      recent: Array<{
        id: string;
        status: WorkspaceSetupRequestStatus;
        createdAt: Date;
        updatedAt: Date;
        organization: {
          id: string;
          name: string;
          slug: string;
        } | null;
        requester: {
          id: string;
          name: string | null;
          email: string;
        };
        note: string | null;
      }>;
    } | null = null;

    if (user?.role === 'MANAGER') {
      const [groupedByStatus, recent] = await Promise.all([
        this.prisma.workspaceSetupRequest.groupBy({
          by: ['status'],
          where: { managerId: userId },
          _count: { status: true },
        }),
        this.prisma.workspaceSetupRequest.findMany({
          where: { managerId: userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            note: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            requester: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        }),
      ]);

      const setupCountsByStatus = groupedByStatus.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {});

      setupRequests = {
        totals: {
          total: groupedByStatus.reduce((sum, row) => sum + row._count.status, 0),
          pending: setupCountsByStatus.PENDING ?? 0,
          contacted: setupCountsByStatus.CONTACTED ?? 0,
          orgCreated: setupCountsByStatus.ORG_CREATED ?? 0,
          requesterAdded: setupCountsByStatus.REQUESTER_ADDED ?? 0,
          completed: setupCountsByStatus.COMPLETED ?? 0,
          declined: setupCountsByStatus.DECLINED ?? 0,
          canceled: setupCountsByStatus.CANCELED ?? 0,
        },
        recent,
      };
    }

    const result = {
      totals,
      organizations,
      setupRequests,
      generatedAt: new Date().toISOString(),
    };
    this.overviewCache.set(userId, { data: result, expires: Date.now() + OrganizationsService.OVERVIEW_TTL_MS });
    return result;
  }

  async findOne(slug: string, userId: string) {
    // One fetch, not two: this used to fetch a light {id,name,slug} row first just to resolve the
    // id for the membership check, then fetch the SAME organization again in full for the common
    // (non-AGENT) case — doubling Organization-table reads on every org-detail page load, which is
    // an OWNER/ADMIN-heavy endpoint (member management, payout status). The AGENT branch below now
    // trims this same result instead of never having fetched it, rather than the other way round.
    const full = await this.prisma.organization.findUnique({
      where: { slug },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { bots: true, conversations: true, knowledgeFiles: true } },
      },
    });
    if (!full) throw new NotFoundException('Organization not found');

    const membership = await this.getMembershipOrThrow(full.id, userId);

    if (membership.role === 'AGENT') {
      return { id: full.id, name: full.name, slug: full.slug };
    }

    // Keep the raw payout account (subaccount code + bank details) out of the general org payload;
    // it's served only by the OWNER-gated Payouts endpoint.
    const { paystackSubaccountCode, payoutBusinessName, payoutBankName, payoutAccountLast4, payoutAccountName, ...safe } = full;
    void paystackSubaccountCode; void payoutBusinessName; void payoutBankName; void payoutAccountLast4; void payoutAccountName;
    return safe;
  }

  async removeMember(orgId: string, requestingUserId: string, targetUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot remove yourself');

    const target = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') throw new ForbiddenException('Cannot remove an owner');

    const requester = await this.prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { name: true, email: true },
    });

    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    });
    this.invalidateOverview(targetUserId); // removed member: their overview lost this org

    await this.activity.log(
      orgId,
      requestingUserId,
      requester?.name ?? requester?.email ?? 'Unknown',
      ActivityAction.MEMBER_REMOVED,
      'member',
      targetUserId,
      { removedUserName: target.user.name ?? target.user.email },
    );
  }

  async listMembers(orgId: string, requestingUserId: string) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    return this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMemberRole(orgId: string, requestingUserId: string, targetUserId: string, role: string) {
    const requester = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: requestingUserId } },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!requester || requester.role !== 'OWNER') {
      throw new ForbiddenException('Only OWNER can change roles');
    }
    if (requestingUserId === targetUserId) throw new ForbiddenException('Cannot change your own role');

    const updated = await this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      data: { role: role as any },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await this.activity.log(
      orgId,
      requestingUserId,
      requester.user?.name ?? requester.user?.email ?? 'Unknown',
      ActivityAction.MEMBER_ROLE_CHANGED,
      'member',
      targetUserId,
      { newRole: role, targetName: updated.user.name ?? updated.user.email },
    );

    return updated;
  }

  async transferOwnership(orgId: string, requestingUserId: string, targetUserId: string) {
    if (requestingUserId === targetUserId) {
      throw new ForbiddenException('You already own this workspace');
    }

    try {
      const transferResult = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.findUnique({
          where: { id: orgId },
          select: { name: true },
        });
        if (!organization) {
          throw new NotFoundException('Organization not found');
        }

        const requester = await tx.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: requestingUserId } },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!requester || requester.role !== 'OWNER') {
          throw new ForbiddenException('Only OWNER can transfer ownership');
        }

        const target = await tx.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!target) {
          throw new NotFoundException('Target member not found');
        }
        if (target.role === 'OWNER') {
          throw new ConflictException('Target member is already the owner');
        }

        const downgradeResult = await tx.organizationMember.updateMany({
          where: {
            organizationId: orgId,
            userId: requestingUserId,
            role: 'OWNER',
          },
          data: { role: 'ADMIN' },
        });

        if (downgradeResult.count !== 1) {
          throw new ConflictException('Ownership changed before the transfer completed. Refresh and try again.');
        }

        const downgradedRequester = await tx.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: requestingUserId } },
          include: { user: { select: { id: true, name: true, email: true } } },
        });

        const promotedTarget = await tx.organizationMember.update({
          where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
          data: { role: 'OWNER' },
          include: { user: { select: { id: true, name: true, email: true } } },
        });

        return {
          previousOwner: downgradedRequester,
          newOwner: promotedTarget,
          workspaceName: organization.name,
          actorName: requester.user?.name ?? requester.user?.email ?? 'Unknown',
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      await this.activity.log(
        orgId,
        requestingUserId,
        transferResult.actorName,
        ActivityAction.MEMBER_ROLE_CHANGED,
        'member',
        targetUserId,
        {
          type: 'ownership_transfer',
          previousOwnerId: requestingUserId,
          previousOwnerName: transferResult.previousOwner?.user.name ?? transferResult.previousOwner?.user.email,
          newOwnerId: targetUserId,
          newOwnerName: transferResult.newOwner.user.name ?? transferResult.newOwner.user.email,
        },
      );

      const previousOwnerDisplay = transferResult.previousOwner?.user.name ?? transferResult.previousOwner?.user.email ?? 'Previous owner';
      const newOwnerDisplay = transferResult.newOwner.user.name ?? transferResult.newOwner.user.email;

      await Promise.allSettled([
        this.mail.sendOwnershipTransferEmail({
          to: transferResult.newOwner.user.email,
          recipientName: transferResult.newOwner.user.name ?? undefined,
          workspaceName: transferResult.workspaceName,
          previousOwnerName: previousOwnerDisplay,
          newOwnerName: newOwnerDisplay,
        }),
        transferResult.previousOwner?.user.email
          ? this.mail.sendOwnershipTransferEmail({
              to: transferResult.previousOwner.user.email,
              recipientName: transferResult.previousOwner.user.name ?? undefined,
              workspaceName: transferResult.workspaceName,
              previousOwnerName: previousOwnerDisplay,
              newOwnerName: newOwnerDisplay,
            })
          : Promise.resolve(),
      ]);

      return {
        previousOwner: transferResult.previousOwner,
        newOwner: transferResult.newOwner,
      };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError
        && (err.code === 'P2002' || err.code === 'P2034')
      ) {
        throw new ConflictException('Ownership transfer conflicted with another update. Refresh and try again.');
      }
      throw err;
    }
  }

  private async getMembershipOrThrow(orgId: string, userId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this organization');
    return member;
  }

  private async assertRole(orgId: string, userId: string, roles: string[]) {
    const member = await this.getMembershipOrThrow(orgId, userId);
    if (!member || !roles.includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Smart agent routing: find the best available agent for a given org + optional topic.
   * Scoring: specialization match → least loaded → first available.
   * Returns null if no agents are available (all offline or all at capacity).
   */
  async findBestAgent(
    orgId: string,
    topic?: string,
    allowedRoles: string[] = ['AGENT'],
  ): Promise<{ userId: string; name: string } | null> {
    const safeRoles = allowedRoles.filter((r) => ['AGENT', 'ADMIN', 'OWNER'].includes(r));
    if (!safeRoles.length) return null;
    const agents = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId, role: { in: safeRoles as any[] }, isAvailable: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!agents.length) return null;

    // Count only actively handled human workloads.
    // PENDING often represents post-resolution states (e.g. awaiting CSAT) and should not consume live capacity.
    const withLoad = await Promise.all(
      agents.map(async (a) => {
        const load = await this.prisma.conversation.count({
          where: {
            organizationId: orgId,
            assignedAgentId: a.userId,
            mode: 'HUMAN',
            status: { in: ['OPEN', 'ESCALATED'] as any[] },
          },
        });
        return { ...a, load };
      }),
    );

    // Filter out agents who are at capacity
    const available = withLoad.filter((a) => a.load < a.maxConcurrentConversations);
    if (!available.length) return null;

    // If a topic is given, prefer agents who list it as a specialization
    let pool = available;
    if (topic) {
      const topicLower = topic.toLowerCase();
      const specialists = available.filter((a) =>
        a.specializations.some(
          (s) => topicLower.includes(s.toLowerCase()) || s.toLowerCase().includes(topicLower),
        ),
      );
      if (specialists.length) pool = specialists;
    }

    // Among the pool, pick the least loaded (tie-break: first in list = longest-tenured)
    const best = pool.sort((a, b) => a.load - b.load)[0];
    return { userId: best.userId, name: best.user.name ?? best.user.email };
  }

  /** Update agent profile fields (specializations, availability, capacity) */
  async updateAgentProfile(
    orgId: string,
    requestingUserId: string,
    targetUserId: string,
    dto: { specializations?: string[]; isAvailable?: boolean; maxConcurrentConversations?: number },
  ) {
    // Agents can update their own profile; OWNER/ADMIN can update any agent
    if (requestingUserId !== targetUserId) {
      await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    }
    // Sanitize specializations: lowercase, max 30 chars each, max 20 tags
    const specializations = dto.specializations
      ?.map((s) => s.trim().toLowerCase().slice(0, 30))
      .filter(Boolean)
      .slice(0, 20);
    return this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
      data: {
        ...(specializations !== undefined && { specializations }),
        ...(dto.isAvailable !== undefined && { isAvailable: dto.isAvailable }),
        ...(dto.maxConcurrentConversations !== undefined && {
          maxConcurrentConversations: dto.maxConcurrentConversations,
        }),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async listContactEndpoints(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.contactEndpoint.findMany({
      where: { orgId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createContactEndpoint(
    orgId: string,
    requestingUserId: string,
    data: {
      label: string;
      channel: 'TELEGRAM' | 'EMAIL' | 'WHATSAPP';
      destination: string;
      userId?: string | null;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (data.userId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: data.userId } },
      });
      if (!member) throw new NotFoundException('Member not found');
    }

    return this.prisma.contactEndpoint.create({
      data: {
        orgId,
        label: data.label.trim(),
        channel: data.channel,
        destination: data.destination.trim(),
        userId: data.userId ?? null,
        isPrimary: data.isPrimary ?? false,
        metadata: (data.metadata ?? {}) as any,
      },
    });
  }

  async updateContactEndpoint(
    orgId: string,
    requestingUserId: string,
    endpointId: string,
    data: {
      label?: string;
      channel?: 'TELEGRAM' | 'EMAIL' | 'WHATSAPP';
      destination?: string;
      userId?: string | null;
      isActive?: boolean;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    if (data.userId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: data.userId } },
      });
      if (!member) throw new NotFoundException('Member not found');
    }

    return this.prisma.contactEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(data.label !== undefined && { label: data.label.trim() }),
        ...(data.channel !== undefined && { channel: data.channel }),
        ...(data.destination !== undefined && { destination: data.destination.trim() }),
        ...(data.userId !== undefined && { userId: data.userId }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
        ...(data.metadata !== undefined && { metadata: data.metadata as any }),
      },
    });
  }

  async deleteContactEndpoint(orgId: string, requestingUserId: string, endpointId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    return this.prisma.contactEndpoint.delete({ where: { id: endpointId } });
  }

  async listContactPolicies(orgId: string, requestingUserId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    return this.prisma.contactPolicy.findMany({
      where: { orgId },
      orderBy: [{ scope: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        endpoint: true,
        bot: { select: { id: true, name: true } },
      },
    });
  }

  async createContactPolicy(
    orgId: string,
    requestingUserId: string,
    data: {
      name: string;
      scope: 'ORGANIZATION' | 'BOT';
      endpointId?: string | null;
      botId?: string | null;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    if (data.endpointId) {
      const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: data.endpointId } });
      if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    }
    if (data.botId) {
      const bot = await this.prisma.bot.findUnique({ where: { id: data.botId } });
      if (!bot || bot.organizationId !== orgId) throw new NotFoundException('Bot not found');
    }

    return this.prisma.contactPolicy.create({
      data: {
        orgId,
        name: data.name.trim(),
        scope: data.scope,
        endpointId: data.endpointId ?? null,
        botId: data.scope === 'BOT' ? (data.botId ?? null) : null,
        isDefault: data.isDefault ?? false,
        rules: (data.rules ?? {}) as any,
      },
      include: { endpoint: true, bot: { select: { id: true, name: true } } },
    });
  }

  async updateContactPolicy(
    orgId: string,
    requestingUserId: string,
    policyId: string,
    data: {
      name?: string;
      endpointId?: string | null;
      botId?: string | null;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const policy = await this.prisma.contactPolicy.findUnique({ where: { id: policyId } });
    if (!policy || policy.orgId !== orgId) throw new NotFoundException('Contact policy not found');
    if (data.endpointId) {
      const endpoint = await this.prisma.contactEndpoint.findUnique({ where: { id: data.endpointId } });
      if (!endpoint || endpoint.orgId !== orgId) throw new NotFoundException('Contact endpoint not found');
    }
    if (data.botId) {
      const bot = await this.prisma.bot.findUnique({ where: { id: data.botId } });
      if (!bot || bot.organizationId !== orgId) throw new NotFoundException('Bot not found');
    }

    return this.prisma.contactPolicy.update({
      where: { id: policyId },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.endpointId !== undefined && { endpointId: data.endpointId }),
        ...(data.botId !== undefined && { botId: data.botId }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.rules !== undefined && { rules: data.rules as any }),
      },
      include: { endpoint: true, bot: { select: { id: true, name: true } } },
    });
  }

  async deleteContactPolicy(orgId: string, requestingUserId: string, policyId: string) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN']);
    const policy = await this.prisma.contactPolicy.findUnique({ where: { id: policyId } });
    if (!policy || policy.orgId !== orgId) throw new NotFoundException('Contact policy not found');
    return this.prisma.contactPolicy.delete({ where: { id: policyId } });
  }

  private parseLimit(limit?: string, fallback = 50): number {
    if (!limit) return fallback;
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, 200);
  }

  private parsePage(page?: string): number {
    if (!page) return 1;
    const parsed = Number.parseInt(page, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
  }

  async listActionTasks(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.actionType ? { actionType: query.actionType } : {}),
      ...(query.q
        ? {
            OR: [
              { summary: { contains: query.q, mode: 'insensitive' } },
              { dedupeKey: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.actionTask.count({ where: where as any });

    const items = await this.prisma.actionTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        conversation: { select: { id: true, customerName: true, customerEmail: true, channel: true } },
        assignedEndpoint: { select: { id: true, label: true, channel: true, destination: true, isActive: true } },
        routedPolicy: { select: { id: true, name: true, scope: true, isDefault: true } },
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            channel: true,
            status: true,
            providerMessageId: true,
            sentAt: true,
            deliveredAt: true,
            acknowledgedAt: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async updateActionTaskStatus(
    orgId: string,
    requestingUserId: string,
    taskId: string,
    nextStatus: 'ACKNOWLEDGED' | 'COMPLETED',
  ) {
    await this.assertRole(orgId, requestingUserId, ['OWNER', 'ADMIN', 'AGENT']);

    const prismaAny = this.prisma as any;
    const task = await prismaAny.actionTask.findFirst({
      where: { id: taskId, orgId },
      select: {
        id: true,
        status: true,
        acknowledgedAt: true,
        completedAt: true,
      },
    });
    if (!task) throw new NotFoundException('Action task not found');

    const now = new Date();
    const isCompleted = task.status === 'COMPLETED' || Boolean(task.completedAt);
    const latestDelivery = await prismaAny.actionDelivery.findFirst({
      where: { actionTaskId: task.id, orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, acknowledgedAt: true },
    });

    if (task.status === 'FAILED' || task.status === 'CONFIGURATION_NEEDED') {
      throw new ConflictException('Cannot acknowledge or complete an action task in failed/configuration-needed state');
    }

    const hasDeliveryEvidence = Boolean(latestDelivery)
      && ['SENT_TO_CHANNEL', 'SENT', 'DELIVERED', 'ACKNOWLEDGED'].includes(String(latestDelivery.status));
    if (nextStatus === 'COMPLETED' && !isCompleted && !task.acknowledgedAt && !hasDeliveryEvidence) {
      throw new ConflictException('Cannot complete action task without delivery/acknowledgement evidence');
    }

    const shouldComplete = nextStatus === 'COMPLETED' || isCompleted;

    const updatedTask = await prismaAny.actionTask.update({
      where: { id: task.id },
      data: {
        status: shouldComplete ? 'COMPLETED' : 'ACKNOWLEDGED',
        acknowledgedAt: task.acknowledgedAt ?? now,
        completedAt: shouldComplete ? (task.completedAt ?? now) : task.completedAt,
      },
      include: {
        bot: { select: { id: true, name: true } },
        conversation: { select: { id: true, customerName: true, customerEmail: true, channel: true } },
        assignedEndpoint: { select: { id: true, label: true, channel: true, destination: true, isActive: true } },
        routedPolicy: { select: { id: true, name: true, scope: true, isDefault: true } },
      },
    });

    if (latestDelivery) {
      await prismaAny.actionDelivery.update({
        where: { id: latestDelivery.id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: latestDelivery.acknowledgedAt ?? now,
        },
      });
    }

    return updatedTask;
  }

  async listLeads(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { interest: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.lead.count({ where: where as any });

    const items = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: {
          select: {
            id: true,
            conversationId: true,
            actionType: true,
            status: true,
            summary: true,
            createdAt: true,
            deliveries: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                channel: true,
                status: true,
                providerMessageId: true,
                sentAt: true,
                deliveredAt: true,
                acknowledgedAt: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listBookings(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { customerName: { contains: query.q, mode: 'insensitive' } },
              { customerEmail: { contains: query.q, mode: 'insensitive' } },
              { preferredDatetime: { contains: query.q, mode: 'insensitive' } },
              { notes: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const prismaAny = this.prisma as any;
    const total = await prismaAny.booking.count({ where: where as any });

    const items = await prismaAny.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: {
          select: {
            id: true,
            conversationId: true,
            actionType: true,
            status: true,
            summary: true,
            createdAt: true,
            deliveries: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                channel: true,
                status: true,
                providerMessageId: true,
                sentAt: true,
                deliveredAt: true,
                acknowledgedAt: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listSalesOrders(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { customerName: { contains: query.q, mode: 'insensitive' } },
              { customerEmail: { contains: query.q, mode: 'insensitive' } },
              { product: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.salesOrder.count({ where: where as any });

    const items = await this.prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: {
          select: {
            id: true,
            conversationId: true,
            actionType: true,
            status: true,
            summary: true,
            createdAt: true,
            deliveries: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                channel: true,
                status: true,
                providerMessageId: true,
                sentAt: true,
                deliveredAt: true,
                acknowledgedAt: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async listTechnicalIssues(
    orgId: string,
    requestingUserId: string,
    query: { botId?: string; status?: string; actionType?: string; q?: string; limit?: string; page?: string },
  ) {
    await this.getMembershipOrThrow(orgId, requestingUserId);
    const take = this.parseLimit(query.limit, 75);
    const page = this.parsePage(query.page);
    const skip = (page - 1) * take;
    const where: Record<string, unknown> = {
      orgId,
      ...(query.botId ? { botId: query.botId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { reporterName: { contains: query.q, mode: 'insensitive' } },
              { reporterEmail: { contains: query.q, mode: 'insensitive' } },
              { summary: { contains: query.q, mode: 'insensitive' } },
              { issueCategory: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.technicalIssue.count({ where: where as any });

    const items = await this.prisma.technicalIssue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        bot: { select: { id: true, name: true } },
        actionTask: {
          select: {
            id: true,
            conversationId: true,
            actionType: true,
            status: true,
            summary: true,
            createdAt: true,
            deliveries: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                channel: true,
                status: true,
                providerMessageId: true,
                sentAt: true,
                deliveredAt: true,
                acknowledgedAt: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }
}
