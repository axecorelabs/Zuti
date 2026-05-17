import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('organizations/:id/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List unread notifications for the current user' })
  list(@Param('id') orgId: string, @CurrentUser() user: { id: string }, @Req() req: any) {
    return this.service.listForUser(orgId, user.id, req.memberRole);
  }

  @Post(':notifId/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Param('notifId') notifId: string) {
    return this.service.markRead(notifId);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(
    @Param('id') orgId: string,
    @CurrentUser() user: { id: string },
    @Req() req: any,
  ) {
    return this.service.markAllRead(orgId, user.id, req.memberRole);
  }
}
