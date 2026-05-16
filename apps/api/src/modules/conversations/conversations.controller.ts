import { Controller, Get, Param, Query, Body, Patch, Post, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  declare content: string;
}
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
    @Query('status') status?: string,
    @Query('mode') mode?: string,
    @Query('botId') botId?: string,
  ) {
    return this.service.findAll(orgId, { status, mode, botId });
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get conversation with messages' })
  findOne(@Param('id') orgId: string, @Param('conversationId') conversationId: string) {
    return this.service.findOne(orgId, conversationId);
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: 'Update conversation status/mode/assignment' })
  update(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.update(orgId, conversationId, dto, user.id);
  }

  @Post(':conversationId/messages')
  @ApiOperation({ summary: 'Send a message as agent (HUMAN mode only)' })
  sendMessage(
    @Param('id') orgId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.service.sendMessage(orgId, conversationId, dto.content);
  }
}
