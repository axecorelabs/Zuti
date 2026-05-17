import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create an org-wide notification visible to all OWNER/ADMIN of that org */
  async createOrgNotification(
    orgId: string,
    type: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.notification.create({
      data: { orgId, type, title, body, metadata: (metadata ?? {}) as Prisma.InputJsonValue, targetUserId: null },
    });
  }

  /** Create a personal notification for a specific user */
  async createUserNotification(
    orgId: string,
    targetUserId: string,
    type: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.notification.create({
      data: { orgId, targetUserId, type, title, body, metadata: (metadata ?? {}) as Prisma.InputJsonValue },
    });
  }

  async listForUser(orgId: string, userId: string, memberRole: string) {
    const isPrivileged = memberRole === 'OWNER' || memberRole === 'ADMIN';
    return this.prisma.notification.findMany({
      where: {
        orgId,
        isRead: false,
        OR: isPrivileged
          ? [{ targetUserId: userId }, { targetUserId: null }]
          : [{ targetUserId: userId }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllRead(orgId: string, userId: string, memberRole: string) {
    const isPrivileged = memberRole === 'OWNER' || memberRole === 'ADMIN';
    return this.prisma.notification.updateMany({
      where: {
        orgId,
        isRead: false,
        OR: isPrivileged
          ? [{ targetUserId: userId }, { targetUserId: null }]
          : [{ targetUserId: userId }],
      },
      data: { isRead: true },
    });
  }
}
