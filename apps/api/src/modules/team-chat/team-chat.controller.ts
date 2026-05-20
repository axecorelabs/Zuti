import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { TeamChatService } from './team-chat.service';

class SendTeamChatMessageDto {
  @IsString()
  @IsNotEmpty()
  declare content: string;
}

@ApiTags('team-chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('organizations/:id/team-chat')
export class TeamChatController {
  constructor(private readonly service: TeamChatService) {}

  @Get('messages')
  @ApiOperation({ summary: 'List team chat messages' })
  @ApiQuery({ name: 'limit', required: false, description: '1-200, default 60' })
  @ApiQuery({ name: 'before', required: false, description: 'ISO date cursor for pagination' })
  listMessages(
    @Param('id') orgId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.service.listMessages(orgId, parsedLimit, before);
  }

  @Post('messages')
  @ApiOperation({ summary: 'Send a team chat message' })
  sendMessage(
    @Param('id') orgId: string,
    @Body() dto: SendTeamChatMessageDto,
    @Req() req: any,
  ) {
    return this.service.sendMessage(orgId, req.user.id, dto.content);
  }
}
