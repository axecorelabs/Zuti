import { Controller, Get, Param, Query, Body, Patch, Post, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
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

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('organizations/:id/conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'mode', required: false })
  @ApiQuery({ name: 'botId', required: false })
  findAll(
    @Param('id') orgId: string,
    @Req() req: any,
    @Query('status') status?: string,
    @Query('mode') mode?: string,
    @Query('botId') botId?: string,
  ) {
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    return this.service.findAll(orgId, { status, mode, botId, agentId });
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get conversation with messages' })
  findOne(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Req() req: any,
  ) {
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    return this.service.findOne(orgId, conversationId, agentId);
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
    const agentId = req.memberRole === 'AGENT' ? req.user.id : undefined;
    return this.service.sendMessage(orgId, conversationId, dto.content, agentId);
  }
}
