import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import {
  AdminListBotsQueryDto,
  AdminCashflowQueryDto,
  AdminListActivityQueryDto,
  AdminOperationsQueryDto,
  AdminSystemHealthQueryDto,
  AdminListUsersQueryDto,
  AdminListWorkspacesQueryDto,
} from './dto/admin.dto';
import { EventsGateway } from '../events/events.gateway';
import {
  ACTION_FORWARDING_QUEUE,
  EMAIL_QUEUE,
  TELEGRAM_QUEUE,
  WHATSAPP_QUEUE,
} from '../queue/queue.module';

type ComponentStatus = 'UP' | 'DEGRADED' | 'DOWN';

type SystemComponent = {
  key: string;
  label: string;
  status: ComponentStatus;
  details: string;
  latencyMs?: number | null;
  meta?: Record<string, unknown>;
};

type BotPrimaryChannel = 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(WHATSAPP_QUEUE) private readonly whatsappQueue: Queue,
    @InjectQueue(ACTION_FORWARDING_QUEUE) private readonly actionForwardingQueue: Queue,
  ) {}

  private clampLimit(value: number | undefined, fallback: number) {
    const rawLimit = Number(value ?? fallback);
    return Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.trunc(rawLimit))) : fallback;
  }

  private normalizeBotSkills(capabilities: unknown) {
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return [] as string[];
    const skills = (capabilities as Record<string, unknown>).skills;
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) return [] as string[];
    const entries = Object.entries(skills as Record<string, unknown>);
    return entries.filter(([, enabled]) => enabled === true).map(([skill]) => skill);
  }

  private resolveBotAlerts(bot: {
    primaryChannel: BotPrimaryChannel;
    isActive: boolean;
    telegramToken: string | null;
    webWidgetEnabled: boolean;
    webWidgetAllowedDomains: string[];
    emailEnabled: boolean;
    emailAddress: string | null;
    whatsappEnabled: boolean;
    whatsappChannelIdentifier: string | null;
  }) {
    const alerts: string[] = [];

    if (!bot.isActive) alerts.push('Bot is inactive');
    if (bot.webWidgetEnabled && (bot.webWidgetAllowedDomains?.length ?? 0) === 0) {
      alerts.push('Widget channel has no allowed domains');
    }
    if (bot.whatsappEnabled && !bot.whatsappChannelIdentifier) {
      alerts.push('WhatsApp channel enabled without identifier');
    }

    if (bot.primaryChannel === 'TELEGRAM' && !bot.telegramToken) {
      alerts.push('Primary channel Telegram is not connected');
    }
    if (bot.primaryChannel === 'WEB_WIDGET' && (!bot.webWidgetEnabled || (bot.webWidgetAllowedDomains?.length ?? 0) === 0)) {
      alerts.push('Primary web widget channel is not ready');
    }
    if (bot.primaryChannel === 'EMAIL' && (!bot.emailEnabled || !bot.emailAddress)) {
      alerts.push('Primary email channel is not ready');
    }
    if (bot.primaryChannel === 'WHATSAPP' && (!bot.whatsappEnabled || !bot.whatsappChannelIdentifier)) {
      alerts.push('Primary WhatsApp channel is not ready');
    }

    return alerts;
  }

  private async probeDatabase(): Promise<SystemComponent> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        key: 'database',
        label: 'Database (PostgreSQL)',
        status: 'UP',
        details: 'Prisma query probe succeeded.',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        key: 'database',
        label: 'Database (PostgreSQL)',
        status: 'DOWN',
        details: error instanceof Error ? error.message : 'Database probe failed.',
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private async probeAiService(): Promise<SystemComponent> {
    const baseUrl = (this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000').trim();
    const paths = ['/health', '/ready', '/'];

    if (!baseUrl) {
      return {
        key: 'ai-service',
        label: 'AI Service',
        status: 'DOWN',
        details: 'AI_SERVICE_URL is not configured.',
      };
    }

    let lastError = 'No successful probe response';
    for (const path of paths) {
      const controller = new AbortController();
      const startedAt = Date.now();
      const timeout = setTimeout(() => controller.abort(), 4000);

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          signal: controller.signal,
        });

        const latencyMs = Date.now() - startedAt;

        if (response.ok) {
          return {
            key: 'ai-service',
            label: 'AI Service',
            status: 'UP',
            details: `Probe succeeded on ${path}.`,
            latencyMs,
            meta: {
              url: baseUrl,
              probePath: path,
              statusCode: response.status,
            },
          };
        }

        lastError = `Probe ${path} returned ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Request failed';
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      key: 'ai-service',
      label: 'AI Service',
      status: 'DOWN',
      details: lastError,
      meta: { url: baseUrl },
    };
  }

  private probeWebsocketGateway(): SystemComponent {
    const server = this.events?.server;
    const connectedClients = Number((server as any)?.engine?.clientsCount ?? 0);
    const ready = Boolean(server);
    const configuredOrigins = (this.config.get<string>('WS_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      key: 'websocket',
      label: 'WebSocket Gateway',
      status: ready ? 'UP' : 'DOWN',
      details: ready ? 'Socket.io gateway is initialized.' : 'Socket.io gateway is not initialized.',
      meta: {
        connectedClients,
        configuredOrigins: configuredOrigins.length,
        path: '/ws',
      },
    };
  }

  private probeMailConfig(): SystemComponent {
    const apiKey = (this.config.get<string>('ZEPTOMAIL_API_KEY') ?? '').trim();
    const fromAddress = (this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? '').trim();

    if (apiKey && fromAddress) {
      return {
        key: 'mail',
        label: 'Mail Delivery',
        status: 'UP',
        details: 'ZeptoMail credentials are configured.',
      };
    }

    return {
      key: 'mail',
      label: 'Mail Delivery',
      status: 'DEGRADED',
      details: 'Missing ZeptoMail API key or from address.',
      meta: {
        hasApiKey: Boolean(apiKey),
        hasFromAddress: Boolean(fromAddress),
      },
    };
  }

  private probeStorageConfig(): SystemComponent {
    const supabaseUrl = (this.config.get<string>('SUPABASE_URL') ?? '').trim();
    const supabaseKey = (this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();

    if (supabaseUrl && supabaseKey) {
      return {
        key: 'storage',
        label: 'Storage (Supabase)',
        status: 'UP',
        details: 'Supabase storage configuration is present.',
      };
    }

    return {
      key: 'storage',
      label: 'Storage (Supabase)',
      status: 'DEGRADED',
      details: 'Supabase storage configuration is incomplete.',
      meta: {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(supabaseKey),
      },
    };
  }

  private probePaymentsConfig(): SystemComponent {
    const paystackSecret = (this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '').trim();

    if (paystackSecret) {
      return {
        key: 'payments',
        label: 'Payments (Paystack)',
        status: 'UP',
        details: 'Paystack credentials are configured.',
      };
    }

    return {
      key: 'payments',
      label: 'Payments (Paystack)',
      status: 'DEGRADED',
      details: 'PAYSTACK_SECRET_KEY is not configured.',
    };
  }

  private async getQueueDiagnostics(queue: Queue, key: string, label: string) {
    try {
      const counts = await queue.getJobCounts();
      const redisStatus = String((queue as any)?.client?.status ?? 'unknown');
      const status: ComponentStatus = redisStatus === 'ready' || redisStatus === 'connect'
        ? 'UP'
        : redisStatus === 'unknown'
          ? 'DEGRADED'
          : 'DOWN';

      return {
        component: {
          key,
          label,
          status,
          details: `Redis status: ${redisStatus}`,
          meta: {
            redisStatus,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            completed: counts.completed ?? 0,
          },
        } as SystemComponent,
        queue: {
          key,
          label,
          redisStatus,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Queue diagnostics failed.';
      return {
        component: {
          key,
          label,
          status: 'DOWN' as ComponentStatus,
          details: message,
        },
        queue: {
          key,
          label,
          redisStatus: 'down',
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        },
      };
    }
  }

  async getOverview() {
    const [roleGroups, totalUsers, totalOrganizations, activeBots, openConversations, commerceStores, billingRevenue, commerceRevenue] = await Promise.all([
      this.prisma.organizationMember.groupBy({
        by: ['role'],
        _count: { _all: true },
      }),
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.bot.count({ where: { isActive: true } }),
      this.prisma.conversation.count({ where: { status: 'OPEN' } }),
      this.prisma.commerceStore.count({ where: { isActive: true } }),
      this.prisma.billingTransaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amountMinor: true },
      }),
      this.prisma.commercePayment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amountMinor: true },
      }),
    ]);

    const byRole = roleGroups.reduce<Record<string, number>>((acc, group) => {
      acc[group.role] = group._count._all;
      return acc;
    }, {});

    return {
      counts: {
        totalUsers,
        totalOrganizations,
        owners: byRole.OWNER ?? 0,
        admins: byRole.ADMIN ?? 0,
        agents: byRole.AGENT ?? 0,
        activeBots,
        openConversations,
        commerceStores,
        totalRevenueMinor: (billingRevenue._sum.amountMinor ?? 0) + (commerceRevenue._sum.amountMinor ?? 0),
        billingRevenueMinor: billingRevenue._sum.amountMinor ?? 0,
        commerceRevenueMinor: commerceRevenue._sum.amountMinor ?? 0,
      },
    };
  }

  async listUsers(query: AdminListUsersQueryDto) {
    const limit = this.clampLimit(query.limit, 100);

    const items = await this.prisma.user.findMany({
      where: query.role
        ? { memberships: { some: { role: query.role } } }
        : undefined,
      include: {
        managerProfile: true,
        memberships: {
          include: {
            organization: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { total: items.length, items };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        managerProfile: true,
        memberships: {
          include: {
            organization: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return { item: user };
  }

  async updateUserRole(
    userId: string,
    update: {
      role: 'USER' | 'MANAGER';
      canCreateWorkspace?: boolean;
      managerVerificationStatus?: 'PENDING' | 'VERIFIED' | 'ARCHIVED';
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id: userId },
        data: {
          role: update.role,
          ...(update.canCreateWorkspace !== undefined
            ? { canCreateWorkspace: update.canCreateWorkspace }
            : {}),
        },
      });

      const requestedStatus = update.managerVerificationStatus;

      if (requestedStatus) {
        await tx.managerProfile.upsert({
          where: { userId },
          create: {
            userId,
            status: requestedStatus,
            displayName: nextUser.name ?? undefined,
          },
          update: {
            status: requestedStatus,
            ...(nextUser.name ? { displayName: nextUser.name } : {}),
          },
        });
      } else if (update.role === 'MANAGER') {
        await tx.managerProfile.upsert({
          where: { userId },
          create: {
            userId,
            status: 'VERIFIED',
            displayName: nextUser.name ?? undefined,
          },
          update: {},
        });
      } else if (update.role === 'USER') {
        await tx.managerProfile.updateMany({
          where: { userId },
          data: { status: 'ARCHIVED' },
        });
      }

      return tx.user.findUnique({
        where: { id: userId },
        include: {
          memberships: {
            include: {
              organization: {
                select: { id: true, name: true, slug: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          managerProfile: true,
        },
      });
    });

    return { item: updated };
  }

  async listWorkspaces(query: AdminListWorkspacesQueryDto) {
    const limit = this.clampLimit(query.limit, 100);

    const items = await this.prisma.organization.findMany({
      include: {
        _count: {
          select: {
            members: true,
            bots: true,
            conversations: true,
            commerceStores: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { total: items.length, items };
  }

  async listBots(query: AdminListBotsQueryDto) {
    const limit = this.clampLimit(query.limit, 200);
    const normalizedQuery = query.q?.trim();

    const where = {
      ...(query.status ? { isActive: query.status === 'ACTIVE' } : {}),
      ...(query.channel ? { primaryChannel: query.channel } : {}),
      ...(normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: 'insensitive' as const } },
              { organization: { name: { contains: normalizedQuery, mode: 'insensitive' as const } } },
              { organization: { slug: { contains: normalizedQuery, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const bots = await this.prisma.bot.findMany({
      where,
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const botIds = bots.map((bot) => bot.id);

    const conversationStatusRowsRaw = botIds.length > 0
      ? await this.prisma.conversation.groupBy({
          by: ['botId', 'status'],
          where: { botId: { in: botIds } },
          _count: { _all: true },
        })
      : [];

    const conversationCountRowsRaw = botIds.length > 0
      ? await this.prisma.conversation.groupBy({
          by: ['botId'],
          where: { botId: { in: botIds } },
          _count: { _all: true },
          _max: { lastMessageAt: true },
        })
      : [];

    const conversationStatusRows = conversationStatusRowsRaw as Array<{
      botId: string;
      status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'ESCALATED';
      _count: { _all: number };
    }>;

    const conversationCountRows = conversationCountRowsRaw as Array<{
      botId: string;
      _count: { _all: number };
      _max: { lastMessageAt: Date | null };
    }>;

    const byBotStatus = new Map<string, Record<string, number>>();
    for (const row of conversationStatusRows) {
      const current = byBotStatus.get(row.botId) ?? { OPEN: 0, PENDING: 0, RESOLVED: 0, ESCALATED: 0 };
      current[row.status] = row._count._all;
      byBotStatus.set(row.botId, current);
    }

    const byBotCounts = new Map<string, { total: number; lastMessageAt: Date | null }>(
      conversationCountRows.map((row) => [row.botId, { total: row._count._all, lastMessageAt: row._max.lastMessageAt }]),
    );

    const items = bots.map((bot) => {
      const statusBreakdown = byBotStatus.get(bot.id) ?? { OPEN: 0, PENDING: 0, RESOLVED: 0, ESCALATED: 0 };
      const counts = byBotCounts.get(bot.id) ?? { total: 0, lastMessageAt: null };
      const skills = this.normalizeBotSkills(bot.capabilities);
      const alerts = this.resolveBotAlerts({
        primaryChannel: bot.primaryChannel as BotPrimaryChannel,
        isActive: bot.isActive,
        telegramToken: bot.telegramToken,
        webWidgetEnabled: bot.webWidgetEnabled,
        webWidgetAllowedDomains: bot.webWidgetAllowedDomains ?? [],
        emailEnabled: bot.emailEnabled,
        emailAddress: bot.emailAddress,
        whatsappEnabled: bot.whatsappEnabled,
        whatsappChannelIdentifier: bot.whatsappChannelIdentifier,
      });

      return {
        id: bot.id,
        name: bot.name,
        organization: bot.organization,
        primaryChannel: bot.primaryChannel,
        template: bot.template,
        isActive: bot.isActive,
        actionForwardingEnabled: bot.actionForwardingEnabled,
        routeToRoles: bot.routeToRoles,
        channels: {
          telegram: {
            connected: Boolean(bot.telegramToken),
            username: bot.telegramUsername,
          },
          widget: {
            enabled: bot.webWidgetEnabled,
            key: bot.webWidgetKey,
            allowedDomainsCount: bot.webWidgetAllowedDomains.length,
          },
          email: {
            enabled: bot.emailEnabled,
            address: bot.emailAddress,
          },
          whatsapp: {
            enabled: bot.whatsappEnabled,
            provider: bot.whatsappProvider,
            identifier: bot.whatsappChannelIdentifier,
            phoneNumber: bot.whatsappPhoneNumber,
          },
        },
        skills,
        workload: {
          totalConversations: counts.total,
          openConversations: statusBreakdown.OPEN,
          pendingConversations: statusBreakdown.PENDING,
          escalatedConversations: statusBreakdown.ESCALATED,
          resolvedConversations: statusBreakdown.RESOLVED,
          lastMessageAt: counts.lastMessageAt,
        },
        alerts,
        alertsCount: alerts.length,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      };
    });

    const summary = {
      totalBots: items.length,
      activeBots: items.filter((item) => item.isActive).length,
      inactiveBots: items.filter((item) => !item.isActive).length,
      botsWithAlerts: items.filter((item) => item.alertsCount > 0).length,
      forwardingEnabled: items.filter((item) => item.actionForwardingEnabled).length,
      primaryChannelCounts: {
        TELEGRAM: items.filter((item) => item.primaryChannel === 'TELEGRAM').length,
        WEB_WIDGET: items.filter((item) => item.primaryChannel === 'WEB_WIDGET').length,
        EMAIL: items.filter((item) => item.primaryChannel === 'EMAIL').length,
        WHATSAPP: items.filter((item) => item.primaryChannel === 'WHATSAPP').length,
      },
      totalOpenConversations: items.reduce((sum, item) => sum + item.workload.openConversations, 0),
      totalEscalatedConversations: items.reduce((sum, item) => sum + item.workload.escalatedConversations, 0),
    };

    return {
      total: items.length,
      summary,
      items,
    };
  }

  async getWorkspace(workspaceId: string) {
    const workspace = await this.prisma.organization.findUnique({
      where: { id: workspaceId },
      include: {
        billing: {
          select: {
            plan: true,
            messageCount: true,
            messageLimit: true,
            creditBalanceUnits: true,
            committedMonthlyCreditsUnits: true,
            commitmentRenewsAt: true,
            renewsAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            members: true,
            bots: true,
            conversations: true,
            commerceStores: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      item: {
        ...workspace,
        billing: workspace.billing
          ? {
              ...workspace.billing,
              creditBalance: Number((workspace.billing.creditBalanceUnits / 100).toFixed(2)),
              committedMonthlyCredits: Number((workspace.billing.committedMonthlyCreditsUnits / 100).toFixed(2)),
            }
          : workspace.billing,
      },
    };
  }

  async getCashflow(query: AdminCashflowQueryDto) {
    const limit = this.clampLimit(query.limit, 50);

    const [billingTransactions, commercePayments, billingSummary, commerceSummary] = await Promise.all([
      this.prisma.billingTransaction.findMany({
        where: { status: 'SUCCESS' },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.commercePayment.findMany({
        where: { status: 'SUCCESS' },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          order: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.billingTransaction.groupBy({
        by: ['currency'],
        where: { status: 'SUCCESS' },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      this.prisma.commercePayment.groupBy({
        by: ['currency'],
        where: { status: 'SUCCESS' },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
    ]);

    return {
      summary: {
        billing: billingSummary,
        commerce: commerceSummary,
      },
      recent: {
        billingTransactions,
        commercePayments,
      },
    };
  }

  async listActivity(query: AdminListActivityQueryDto) {
    const limit = this.clampLimit(query.limit, 50);
    const page = Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1);
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.activityLog.count(),
      this.prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
    ]);

    return { total, page, limit, items };
  }

  async getOperations(query: AdminOperationsQueryDto) {
    const limit = this.clampLimit(query.limit, 25);

    const [actionTasks, pendingInvitations, recentFailures] = await Promise.all([
      this.prisma.actionTask.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      this.prisma.invitation.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
          invitedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.actionDelivery.findMany({
        where: {
          status: {
            in: ['FAILED', 'RETRYING'],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
          actionTask: {
            select: {
              id: true,
              actionType: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const queueCountsRaw = await this.prisma.actionTask.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const queueCounts = queueCountsRaw.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});

    return {
      queue: {
        total: actionTasks.length,
        countsByStatus: queueCounts,
        items: actionTasks,
      },
      invites: {
        pending: pendingInvitations.length,
        items: pendingInvitations,
      },
      deliveries: {
        failedOrRetrying: recentFailures.length,
        items: recentFailures,
      },
    };
  }

  async getSystemHealth(query: AdminSystemHealthQueryDto) {
    const monitoringWindowLimit = this.clampLimit(query.limit, 20);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [deliveryStatusCounts, processing, invitationStats] = await Promise.all([
      this.prisma.actionDelivery.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.actionTask.groupBy({
        by: ['status'],
        where: {
          status: {
            in: ['DETECTED', 'PENDING_CONFIRMATION', 'QUEUED', 'ROUTED', 'SENT', 'DELIVERED', 'ACKNOWLEDGED'],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.invitation.groupBy({
        by: ['status'],
        where: { createdAt: { gte: oneDayAgo } },
        _count: { _all: true },
      }),
    ]);

    const deliveryByStatus = deliveryStatusCounts.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});
    const processingByStatus = processing.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});
    const invitesLast24hByStatus = invitationStats.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});

    const [failedLastHour, failedLastDay] = await Promise.all([
      this.prisma.actionDelivery.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: oneHourAgo },
        },
      }),
      this.prisma.actionDelivery.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: oneDayAgo },
        },
      }),
    ]);

    const [database, aiService] = await Promise.all([
      this.probeDatabase(),
      this.probeAiService(),
    ]);

    const websocket = this.probeWebsocketGateway();
    const mail = this.probeMailConfig();
    const storage = this.probeStorageConfig();
    const payments = this.probePaymentsConfig();

    const queueDiagnostics = await Promise.all([
      this.getQueueDiagnostics(this.telegramQueue, 'queue-telegram', 'Queue: Telegram Messages'),
      this.getQueueDiagnostics(this.emailQueue, 'queue-email', 'Queue: Email Messages'),
      this.getQueueDiagnostics(this.whatsappQueue, 'queue-whatsapp', 'Queue: WhatsApp Messages'),
      this.getQueueDiagnostics(this.actionForwardingQueue, 'queue-action-forwarding', 'Queue: Action Forwarding'),
    ]);

    const queueComponents = queueDiagnostics.map((entry) => entry.component);
    const queueRows = queueDiagnostics.map((entry) => entry.queue);
    const components: SystemComponent[] = [
      database,
      websocket,
      aiService,
      mail,
      storage,
      payments,
      ...queueComponents,
    ];

    const summary = components.reduce(
      (acc, component) => {
        if (component.status === 'UP') acc.up += 1;
        else if (component.status === 'DEGRADED') acc.degraded += 1;
        else acc.down += 1;
        return acc;
      },
      { total: components.length, up: 0, degraded: 0, down: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      monitoringWindowLimit,
      components,
      summary,
      checks: {
        queueInFlight: Object.values(processingByStatus).reduce((sum, count) => sum + count, 0),
        failedDeliveriesLastHour: failedLastHour,
        failedDeliveriesLastDay: failedLastDay,
      },
      deliveries: {
        byStatus: deliveryByStatus,
      },
      processing: {
        byStatus: processingByStatus,
      },
      invitations: {
        last24HoursByStatus: invitesLast24hByStatus,
      },
      queues: {
        items: queueRows,
        totals: {
          waiting: queueRows.reduce((sum, item) => sum + item.waiting, 0),
          active: queueRows.reduce((sum, item) => sum + item.active, 0),
          delayed: queueRows.reduce((sum, item) => sum + item.delayed, 0),
          failed: queueRows.reduce((sum, item) => sum + item.failed, 0),
          completed: queueRows.reduce((sum, item) => sum + item.completed, 0),
        },
      },
    };
  }
}
