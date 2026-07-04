import { Process, Processor } from '@nestjs/bull';
import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { firstValueFrom } from 'rxjs';
import { render } from '@react-email/render';
import * as React from 'react';
import { ACTION_FORWARDING_QUEUE } from '../queue/queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionForwardingService } from './action-forwarding.service';
import { ActionForwardingEmail } from '../mail/templates/ActionForwardingEmail';
import { sendWhatsAppText } from '../../common/utils/whatsapp';

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
    id: string;
    actionType: string;
    summary: string;
    payload: unknown;
    priority: string;
  }): string {
    const payload = (action.payload as Record<string, unknown>) ?? {};
    const customerName = typeof payload.customerName === 'string' ? payload.customerName : null;
    const customerEmail = typeof payload.customerEmail === 'string' ? payload.customerEmail : null;
    const customerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone : null;
    const messageText = typeof payload.messageText === 'string' ? payload.messageText : null;
    const issueSummary = typeof payload.issueSummary === 'string' ? payload.issueSummary : null;
    const issueDetails = typeof payload.issueDetails === 'string' ? payload.issueDetails : null;
    const bookingId = typeof payload.bookingId === 'string' ? payload.bookingId : null;
    const preferredDatetime = typeof payload.preferredDatetime === 'string' ? payload.preferredDatetime : null;
    const bookingReason = typeof payload.bookingReason === 'string' ? payload.bookingReason : null;
    const companyName = typeof payload.companyName === 'string' ? payload.companyName : null;
    const consultationPurpose = typeof payload.consultationPurpose === 'string' ? payload.consultationPurpose : null;
    const intentSummary = typeof payload.intentSummary === 'string' ? payload.intentSummary : null;
    const conversationContext = typeof payload.conversationContext === 'string' ? payload.conversationContext : null;

    const parts = [
      `Topic: ${action.actionType}`,
      `Urgency: ${action.priority}`,
      `Request summary: ${action.summary}`,
      intentSummary ? `What the customer needs: ${intentSummary}` : null,
      customerName ? `Customer name: ${customerName}` : null,
      customerEmail ? `Customer email: ${customerEmail}` : null,
      customerPhone ? `Customer phone: ${customerPhone}` : null,
      companyName ? `Company: ${companyName}` : null,
      consultationPurpose ? `Consultation purpose: ${consultationPurpose}` : null,
      bookingReason ? `Reason for booking: ${bookingReason}` : null,
      issueSummary ? `Issue summary: ${issueSummary}` : null,
      issueDetails ? `Issue details: ${issueDetails}` : null,
      preferredDatetime ? `Preferred time: ${preferredDatetime}` : null,
      bookingId ? `Booking reference: ${bookingId}` : null,
      messageText ? `Customer message: ${messageText}` : null,
      conversationContext ? `Conversation summary: ${conversationContext}` : null,
      `Reference id: ${action.id}`,
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

  private async sendEmail(destination: string, subject: string, body: string, htmlBody: string, botName: string) {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    const fromAddress = this.config.get<string>('ZEPTOMAIL_FROM_ADDRESS') ?? 'zuti@bords.app';
    const fromName = `${botName} <Zuti Agent>`;
    if (!apiKey) throw new Error('ZEPTOMAIL_API_KEY is not configured');

    await firstValueFrom(
      this.http.post(
        'https://api.zeptomail.com/v1.1/email',
        {
          from: { address: fromAddress, name: fromName },
          to: [{ email_address: { address: destination } }],
          subject,
          textbody: body,
          htmlbody: htmlBody,
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

  private async sendWhatsApp(destination: string, text: string) {
    const provider = (this.config.get<string>('ACTION_FORWARDING_WHATSAPP_PROVIDER') ?? '').trim().toUpperCase();
    const channelIdentifier = this.config.get<string>('ACTION_FORWARDING_WHATSAPP_CHANNEL') ?? '';
    const connection = provider === 'TWILIO'
      ? {
          provider: 'TWILIO' as const,
          channelIdentifier,
          config: {
            accountSid: this.config.get<string>('ACTION_FORWARDING_WHATSAPP_TWILIO_ACCOUNT_SID') ?? '',
            authToken: this.config.get<string>('ACTION_FORWARDING_WHATSAPP_TWILIO_AUTH_TOKEN') ?? '',
            messagingServiceSid: this.config.get<string>('ACTION_FORWARDING_WHATSAPP_TWILIO_MESSAGING_SERVICE_SID') ?? '',
          },
        }
      : {
          provider: 'META' as const,
          channelIdentifier,
          config: {
            accessToken: this.config.get<string>('ACTION_FORWARDING_WHATSAPP_META_ACCESS_TOKEN') ?? '',
            appSecret: this.config.get<string>('ACTION_FORWARDING_WHATSAPP_META_APP_SECRET') ?? '',
          },
        };

    await sendWhatsAppText(this.http, connection, destination, text);
  }

  @Process()
  async handle(job: Job<ActionForwardingJob>) {
    const { actionTaskId, organizationId } = job.data;
    this.logger.log(`Action forwarding job queued for org=${organizationId}, task=${actionTaskId}`);
    const prismaAny = this.prisma as any;

    const action = await prismaAny.actionTask.findUnique({
      where: { id: actionTaskId },
      include: {
        bot: {
          select: {
            name: true,
          },
        },
      },
    });
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
      if (existingDelivery.status === 'SENT_TO_CHANNEL' || existingDelivery.status === 'SENT' || existingDelivery.status === 'DELIVERED' || existingDelivery.status === 'ACKNOWLEDGED') {
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
    const payload = (action.payload as Record<string, unknown> | null) ?? {};
    const actionHtml = await render(
      React.createElement(ActionForwardingEmail, {
        botName: action.bot?.name ?? 'Bot',
        actionType: action.actionType,
        priority: action.priority,
        summary: action.summary,
        customerName: typeof payload.customerName === 'string' ? payload.customerName : null,
        customerEmail: typeof payload.customerEmail === 'string' ? payload.customerEmail : null,
        customerPhone: typeof payload.customerPhone === 'string' ? payload.customerPhone : null,
        companyName: typeof payload.companyName === 'string' ? payload.companyName : null,
        consultationPurpose: typeof payload.consultationPurpose === 'string' ? payload.consultationPurpose : null,
        bookingReason: typeof payload.bookingReason === 'string' ? payload.bookingReason : null,
        issueSummary: typeof payload.issueSummary === 'string' ? payload.issueSummary : null,
        issueDetails: typeof payload.issueDetails === 'string' ? payload.issueDetails : null,
        preferredDatetime: typeof payload.preferredDatetime === 'string' ? payload.preferredDatetime : null,
        messageText: typeof payload.messageText === 'string' ? payload.messageText : null,
        intentSummary: typeof payload.intentSummary === 'string' ? payload.intentSummary : null,
        conversationContext: typeof payload.conversationContext === 'string' ? payload.conversationContext : null,
        actionTaskId: action.id,
      }),
    );

    try {
      const sendResult = route.endpoint.channel === 'TELEGRAM'
        ? await this.sendTelegram(route.endpoint.destination, deliveryText)
        : route.endpoint.channel === 'WHATSAPP'
          ? await this.sendWhatsApp(route.endpoint.destination, deliveryText)
          : await this.sendEmail(
              route.endpoint.destination,
              `New customer request: ${action.actionType}`,
              deliveryText,
              actionHtml,
              action.bot?.name ?? 'Bot',
            );

      await prismaAny.actionDelivery.update({
        where: { id: deliveryRecord.id },
        data: {
          status: 'SENT_TO_CHANNEL',
          sentAt: new Date(),
          responsePayload: {
            acceptedByChannel: route.endpoint.channel,
            result: 'sent_to_channel',
          },
        },
      });

      await prismaAny.actionTask.update({
        where: { id: actionTaskId },
        data: { status: 'SENT' },
      });

      await this.notifications.createOrgNotification(
        organizationId,
        'action_forwarded',
        `Action sent to channel: ${action.actionType}`,
        `${action.summary} Sent to the configured ${route.endpoint.channel} channel. Human delivery or acknowledgement is not confirmed yet.`,
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
