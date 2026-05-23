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
}
