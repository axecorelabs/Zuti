import { Controller, Get, Param, Query, Body, Patch, Post, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsIn, IsEmail, IsBoolean } from 'class-validator';
import { ApiProperty, ApiBearerAuth, ApiOperation, ApiQuery, ApiTags, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  declare content: string;
}

class UpdateConversationDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'PENDING', 'RESOLVED', 'ESCALATED'] })
  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'PENDING', 'RESOLVED', 'ESCALATED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['AI', 'HUMAN'] })
  @IsOptional()
  @IsString()
  @IsIn(['AI', 'HUMAN'])
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedAgentId?: string;

  @ApiPropertyOptional({ description: 'Topic hint for smart agent routing on escalation (e.g. "billing", "technical")' })
  @IsOptional()
  @IsString()
  escalationTopic?: string;
}

class StartInternalConversationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  botId!: string;

  @ApiProperty()
  @IsEmail()
  customerEmail!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRecordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceActionTaskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceConversationId?: string;

  @ApiPropertyOptional({ description: 'Allow external email delivery for this internal follow-up' })
  @IsOptional()
  @IsBoolean()
  allowExternalDelivery?: boolean;
}

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('organizations/:id/conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Post('start-internal')
  @ApiOperation({ summary: 'Start an internal-only inbox conversation (no external send)' })
  startInternal(
    @Param('id') orgId: string,
    @Body() dto: StartInternalConversationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.startInternalConversation(orgId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List conversations' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'mode', required: false })
  @ApiQuery({ name: 'botId', required: false })
  @ApiQuery({ name: 'assignedAgentId', required: false, description: 'Agent user id or "unassigned"' })
  @ApiQuery({ name: 'q', required: false, description: 'Search by customer name/username or message content' })
  @ApiQuery({ name: 'searchScope', required: false, description: 'conversation (default) or all (includes message content)' })
  @ApiQuery({ name: 'messageSearchDays', required: false, description: 'When searchScope=all, limit message search to last N days (default 30)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size for cursor pagination (max 100)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor from previous response for next page' })
  findAll(
    @Param('id') orgId: string,
    @Req() req: any,
    @Query('status') status?: string,
    @Query('mode') mode?: string,
    @Query('botId') botId?: string,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('q') q?: string,
    @Query('searchScope') searchScope?: string,
    @Query('messageSearchDays') messageSearchDays?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedMessageSearchDays = messageSearchDays ? Number.parseInt(messageSearchDays, 10) : undefined;
    return this.service.findAll(orgId, {
      status,
      mode,
      botId,
      assignedAgentId,
      q,
      searchScope: searchScope === 'all' ? 'all' : 'conversation',
      messageSearchDays: Number.isFinite(parsedMessageSearchDays) ? parsedMessageSearchDays : undefined,
      agentId,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      cursor,
    });
  }

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Get analytics summary for the organisation' })
  @ApiQuery({ name: 'days', required: false, description: 'Lookback window in days (default 30)' })
  @ApiQuery({ name: 'botId', required: false, description: 'Filter to a specific bot' })
  getAnalytics(
    @Param('id') orgId: string,
    @Query('days') days?: string,
    @Query('botId') botId?: string,
  ) {
    const d = days ? Math.min(Math.max(parseInt(days, 10) || 30, 1), 365) : 30;
    return this.service.getAnalytics(orgId, d, botId || undefined);
  }

  @Get('analytics/overview')
  @ApiOperation({ summary: 'Get lightweight dashboard overview for the organisation' })
  getOverview(
    @Param('id') orgId: string,
    @Req() req: any,
  ) {
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    return this.service.getOverview(orgId, agentId);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get conversation with messages' })
  @ApiQuery({ name: 'messageLimit', required: false, description: 'Maximum messages to return (max 100, default 50)' })
  @ApiQuery({ name: 'before', required: false, description: 'Load messages older than this ISO timestamp' })
  @ApiQuery({ name: 'includeContext', required: false, description: 'Include previous conversations and escalation history' })
  findOne(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: any,
    @Query('messageLimit') messageLimit?: string,
    @Query('before') before?: string,
    @Query('includeContext') includeContext?: string,
  ) {
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    const parsedMessageLimit = messageLimit ? Number.parseInt(messageLimit, 10) : undefined;
    return this.service.findOne(orgId, conversationId, agentId, {
      messageLimit: Number.isFinite(parsedMessageLimit) ? parsedMessageLimit : undefined,
      before,
      includeContext: includeContext === 'true' || includeContext === '1',
    });
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: 'Update conversation status/mode/assignment' })
  update(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() user: { id: string },
    @Req() req: any,
  ) {
    return this.service.update(orgId, conversationId, dto, user.id, req.memberRole);
  }

  @Post(':conversationId/messages')
  @ApiOperation({ summary: 'Send a message as agent (HUMAN mode only)' })
  sendMessage(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ) {
    const agentId = req.user.id;
    const isAgent = req.memberRole === 'AGENT';
    return this.service.sendMessage(orgId, conversationId, dto.content, agentId, isAgent);
  }

  @Post(':conversationId/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an internal agent note to a conversation' })
  addNote(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @Req() req: any,
  ) {
    return this.service.addNote(orgId, conversationId, dto.content, req.user.id);
  }

  @Post(':conversationId/retry-email-delivery')
  @ApiOperation({ summary: 'Retry delivery of the latest agent email message' })
  retryEmailDelivery(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: any,
  ) {
    const agentId = req.user.id;
    const isAgent = req.memberRole === 'AGENT';
    return this.service.retryEmailDelivery(orgId, conversationId, agentId, isAgent);
  }
}
