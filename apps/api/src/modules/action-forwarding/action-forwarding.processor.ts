import { Process, Processor } from '@nestjs/bull';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { firstValueFrom } from 'rxjs';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionForwardingService } from './action-forwarding.service';

export interface ActionForwardingJob {
  actionTaskId: string;
  organizationId: string;
}

@Processor(ACTION_FORWARDING_QUEUE)
export class ActionForwardingProcessor {
  private readonly logger = new Logger(ActionForwardingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly forwarding: ActionForwardingService,
  ) {}

  private formatActionText(action: {
    actionType: string;
    summary: string;
    payload: unknown;
    priority: string;
  }): string {
    const payload = (action.payload as Record<string, unknown>) ?? {};
    const customerName = typeof payload.customerName === 'string' ? payload.customerName : null;
    const customerEmail = typeof payload.customerEmail === 'string' ? payload.customerEmail : null;
    const messageText = typeof payload.messageText === 'string' ? payload.messageText : null;

    const parts = [
      `Action type: ${action.actionType}`,
      `Priority: ${action.priority}`,
      `Summary: ${action.summary}`,
      customerName ? `Customer: ${customerName}` : null,
      customerEmail ? `Email: ${customerEmail}` : null,
      messageText ? `Customer message: ${messageText}` : null,
      `Action task id: ${(payload as Record<string, unknown>).actionTaskId ?? 'n/a'}`,
    ].filter(Boolean);

    return parts.join('\n');
  }

  private async sendTelegram(destination: string, text: string) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

    await firstValueFrom(
      this.http.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: destination,
        text,
      }),
    );
  }

  private async sendEmail(destination: string, subject: string, body: string) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const fromAddress = this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app';
    const fromName = this.config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'Zuti';
    if (!apiKey) throw new Error('ZEPTOMAIL_API_KEY is not configured');

    await firstValueFrom(
      this.http.post(
        'https://api.zeptomail.com/v1.1/email',
        {
          from: { address: fromAddress, name: fromName },
          to: [{ email_address: { address: destination } }],
          subject,
          textbody: body,
        },
        {
          headers: {
            Authorization: `Zoho-enczapikey ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
  }

  @Process()
  async handle(job: Job<ActionForwardingJob>) {
    const { actionTaskId, organizationId } = job.data;
    this.logger.log(`Action forwarding job queued for org=${organizationId}, task=${actionTaskId}`);
    const prismaAny = this.prisma as any;

    const action = await prismaAny.actionTask.findUnique({ where: { id: actionTaskId } });
    if (!action || action.orgId !== organizationId) return { ok: false, reason: 'NOT_FOUND' };

    const [botPolicies, orgPolicies, endpoints] = await Promise.all([
      prismaAny.contactPolicy.findMany({ where: { orgId: organizationId, botId: action.botId } }),
      prismaAny.contactPolicy.findMany({ where: { orgId: organizationId, botId: null } }),
      prismaAny.contactEndpoint.findMany({ where: { orgId: organizationId, isActive: true } }),
    ]);

    const route = this.forwarding.resolveRoute({
      actionType: action.actionType,
      botPolicies,
      orgPolicies,
      endpoints,
    });

    if (!route.endpoint || !route.policy) {
      await prismaAny.actionTask.update({
        where: { id: actionTaskId },
        data: { status: 'CONFIGURATION_NEEDED' },
      });
      await this.notifications.createOrgNotification(
        organizationId,
        'action_forwarding_configuration_needed',
        'Action forwarding needs configuration',
        `No active contact route was found for action ${action.actionType}. Configure contact policies to enable team outreach.`,
        { actionTaskId, actionType: action.actionType },
      );
      return { ok: false, reason: 'NO_ROUTE' };
    }

    await prismaAny.actionTask.update({
      where: { id: actionTaskId },
      data: {
        status: 'ROUTED',
        routedPolicyId: route.policy.id,
        assignedEndpointId: route.endpoint.id,
      },
    });

    const maxAttempts = Math.max(1, Number(job.opts.attempts ?? 1));
    const currentAttempt = Math.max(1, Number(job.attemptsMade ?? 0) + 1);
    const deliveryAttempt = Math.min(currentAttempt, maxAttempts);
    const existingDelivery = await prismaAny.actionDelivery.findFirst({
      where: {
        actionTaskId,
        endpointId: route.endpoint.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    const deliveryRecord = existingDelivery ?? await prismaAny.actionDelivery.create({
      data: {
        actionTaskId,
        orgId: organizationId,
        endpointId: route.endpoint.id,
        channel: route.endpoint.channel,
        status: 'QUEUED',
        attempt: deliveryAttempt,
        requestPayload: {
          routeReason: route.reason,
          destination: route.endpoint.destination,
        },
      },
    });

    if (existingDelivery) {
      if (existingDelivery.status === 'SENT' || existingDelivery.status === 'DELIVERED' || existingDelivery.status === 'ACKNOWLEDGED') {
        return { ok: true, reason: 'ALREADY_SENT' };
      }
      await prismaAny.actionDelivery.update({
        where: { id: existingDelivery.id },
        data: {
          attempt: deliveryAttempt,
          status: job.attemptsMade > 0 ? 'RETRYING' : 'QUEUED',
          nextRetryAt: job.attemptsMade + 1 < maxAttempts ? new Date(Date.now() + 15000) : null,
        },
      });
    }

    const deliveryText = this.formatActionText(action);

    try {
      const sendResult = route.endpoint.channel === 'TELEGRAM'
        ? await this.sendTelegram(route.endpoint.destination, deliveryText)
        : await this.sendEmail(
            route.endpoint.destination,
            `Action forwarding: ${action.actionType}`,
            deliveryText,
          );

      await prismaAny.actionDelivery.update({
        where: { id: deliveryRecord.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          responsePayload: {
            deliveredBy: route.endpoint.channel,
            result: 'accepted',
          },
        },
      });

      await prismaAny.actionTask.update({
        where: { id: actionTaskId },
        data: { status: 'DELIVERED' },
      });

      await this.notifications.createOrgNotification(
        organizationId,
        'action_forwarded',
        `Action sent: ${action.actionType}`,
        `${action.summary} Delivered to ${route.endpoint.channel} destination ${route.endpoint.destination}.`,
        {
          actionTaskId,
          channel: route.endpoint.channel,
          destination: route.endpoint.destination,
          delivery: sendResult,
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (deliveryAttempt < maxAttempts) {
        await prismaAny.actionDelivery.update({
          where: { id: deliveryRecord.id },
          data: {
            status: 'RETRYING',
            attempt: deliveryAttempt,
            nextRetryAt: new Date(Date.now() + 15000),
            errorMessage: message,
            responsePayload: { error: message },
          },
        });
        throw new Error(message);
      }

      await prismaAny.actionDelivery.update({
        where: { id: deliveryRecord.id },
        data: {
          status: 'FAILED',
          attempt: deliveryAttempt,
          errorMessage: message,
          responsePayload: { error: message },
        },
      });
      await prismaAny.actionTask.update({
        where: { id: actionTaskId },
        data: { status: 'FAILED' },
      });
      await this.notifications.createOrgNotification(
        organizationId,
        'action_forwarding_failed',
        `Action delivery failed: ${action.actionType}`,
        `${action.summary} Could not be delivered to ${route.endpoint.channel}. ${message}`,
        {
          actionTaskId,
          channel: route.endpoint.channel,
          destination: route.endpoint.destination,
          error: message,
        },
      );
      this.logger.warn(`Action delivery failed for task ${actionTaskId}: ${message}`);
      throw new Error(message);
    }

    return { ok: true };
  }
}
