import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BotsService } from './bots.service';
import { CreateBotDto, UpdateBotDto } from './dto/bot.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompleteMetaEmbeddedSignupDto, CompleteMetaEmbeddedSelectionDto } from './dto/bot.dto';

@ApiTags('bots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Controller('organizations/:id/bots')
export class BotsController {
  constructor(private readonly botsService: BotsService) {}

  @Get('templates')
  @ApiOperation({ summary: 'List bot templates with their preset capabilities and defaults' })
  templates() {
    return this.botsService.getTemplateCatalog();
  }

  @Post()
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a bot and choose its primary channel (Telegram or Website Widget)' })
  create(
    @Param('id') orgId: string,
    @Body() dto: CreateBotDto,
  ) {
    return this.botsService.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all bots for an organization' })
  findAll(@Param('id') orgId: string) {
    return this.botsService.findAll(orgId);
  }

  @Get(':botId')
  @ApiOperation({ summary: 'Get a bot by ID' })
  findOne(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.findOne(orgId, botId);
  }

  @Patch(':botId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update a bot' })
  update(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: UpdateBotDto,
  ) {
    return this.botsService.update(orgId, botId, dto);
  }

  @Delete(':botId')
  @RequireRole('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bot' })
  remove(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.remove(orgId, botId);
  }

  @Post(':botId/webhook')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Register webhook with Telegram' })
  setWebhook(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.setWebhook(orgId, botId);
  }

  @Post(':botId/email/enable')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Enable email channel — generates {localPart}@{orgSlug}.bords.app' })
  enableEmail(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: { localPart: string },
  ) {
    return this.botsService.enableEmail(orgId, botId, dto.localPart);
  }

  @Post(':botId/email/disable')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disable email channel' })
  disableEmail(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.disableEmail(orgId, botId);
  }

  @Post('email/sync-parse-rule')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'One-time sync of SendGrid parse URL/token for this organization hostname' })
  syncEmailParseRule(@Param('id') orgId: string) {
    return this.botsService.syncSendGridParseRuleForOrganization(orgId);
  }

  @Post(':botId/telegram/connect')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Connect a Telegram bot token to this bot' })
  connectTelegram(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: { token: string },
  ) {
    return this.botsService.connectTelegram(orgId, botId, dto.token);
  }

  @Post(':botId/telegram/disconnect')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disconnect Telegram from this bot' })
  disconnectTelegram(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.disconnectTelegram(orgId, botId);
  }

  @Post(':botId/whatsapp/connect')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Connect WhatsApp Cloud API credentials to this bot' })
  connectWhatsApp(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: {
      provider: 'META' | 'TWILIO';
      integrationMode: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';
      channelIdentifier: string;
      phoneNumber?: string;
      displayName?: string;
      verifyToken?: string;
      config?: Record<string, unknown>;
    },
  ) {
    return this.botsService.connectWhatsApp(orgId, botId, dto);
  }

  @Post(':botId/whatsapp/disconnect')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Disconnect WhatsApp from this bot' })
  disconnectWhatsApp(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.disconnectWhatsApp(orgId, botId);
  }

  @Get(':botId/whatsapp/meta/embedded/start')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Start Meta embedded-signup OAuth flow for WhatsApp' })
  startMetaEmbeddedSignup(@Param('id') orgId: string, @Param('botId') botId: string) {
    return this.botsService.startMetaEmbeddedSignup(orgId, botId);
  }

  @Post(':botId/whatsapp/meta/embedded/complete')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Complete Meta embedded-signup OAuth flow for WhatsApp' })
  completeMetaEmbeddedSignup(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: CompleteMetaEmbeddedSignupDto,
  ) {
    return this.botsService.completeMetaEmbeddedSignup(
      orgId,
      botId,
      dto.code,
      dto.state,
      dto.selectedBusinessAccountId,
      dto.selectedPhoneNumberId,
    );
  }

  @Post(':botId/whatsapp/meta/embedded/complete-selection')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Finalize Meta embedded-signup by choosing a specific WhatsApp number' })
  completeMetaEmbeddedSelection(
    @Param('id') orgId: string,
    @Param('botId') botId: string,
    @Body() dto: CompleteMetaEmbeddedSelectionDto,
  ) {
    return this.botsService.completeMetaEmbeddedSelection(
      orgId,
      botId,
      dto.sessionId,
      dto.selectedPhoneNumberId,
      dto.selectedBusinessAccountId,
    );
  }
}
