import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/invitation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Post()
  @ApiOperation({ summary: 'Send an invitation' })
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateInvitationDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get pending invitations for the current user' })
  listMine(@CurrentUser() user: { id: string; email: string }) {
    return this.service.findMine(user.email);
  }

  @Get('mine/debug')
  @ApiOperation({ summary: 'Debug pending invitation lookup for the current user' })
  debugMine(@CurrentUser() user: { id: string; email: string }) {
    return this.service.findMineDebug(user.email);
  }

  @Get('org/:orgId')
  @ApiOperation({ summary: 'Get pending invitations sent by an org (OWNER/ADMIN only)' })
  listByOrg(
    @Param('orgId') orgId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.findByOrg(orgId, user.id);
  }

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Get invitation details by token (public)' })
  findByToken(@Param('token') token: string) {
    return this.service.findByToken(token);
  }

  @Post(':token/accept')
  @ApiOperation({ summary: 'Accept an invitation' })
  accept(
    @Param('token') token: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.accept(token, user.id);
  }

  @Post(':token/decline')
  @ApiOperation({ summary: 'Decline an invitation (invitee only)' })
  decline(
    @Param('token') token: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.decline(token, user.id);
  }

  @Post(':token/revoke')
  @ApiOperation({ summary: 'Revoke a pending invitation (OWNER/ADMIN only)' })
  revoke(
    @Param('token') token: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.revoke(token, user.id);
  }
}
