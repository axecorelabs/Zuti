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

  @Post()
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Register a new Telegram bot' })
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
}
