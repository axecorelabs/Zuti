import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationProductDto, UpdateRegistrationProductDto, UpdateRegistrationEntryDto, CreateTicketTypeDto, UpdateTicketTypeDto, CheckInDto, ManualCheckInDto } from './dto/registrations.dto';

@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@Controller('organizations/:id/registrations')
export class RegistrationsController {
  constructor(private readonly svc: RegistrationsService) {}

  // ── Products ──────────────────────────────────────────────────────────────

  @Post()
  createProduct(@Param('id') orgId: string, @Body() dto: CreateRegistrationProductDto) {
    return this.svc.createProduct(orgId, dto);
  }

  @Get()
  listProducts(@Param('id') orgId: string, @Query('botId') botId?: string) {
    return this.svc.listProducts(orgId, botId);
  }

  // ── Dead letter queue (failed receipt/ticket deliveries) ──────────────────
  // Must be declared before the ':productId' routes below — otherwise Nest/Express
  // matches 'dead-letter' as a productId value and this route is never reached.

  @RequireRole('OWNER', 'ADMIN')
  @Get('dead-letter')
  listFailedReceipts(@Param('id') orgId: string) {
    return this.svc.listFailedReceiptJobs(orgId);
  }

  @RequireRole('OWNER', 'ADMIN')
  @Post('dead-letter/:jobId/retry')
  retryFailedReceipt(@Param('id') orgId: string, @Param('jobId') jobId: string) {
    return this.svc.retryFailedReceiptJob(orgId, jobId);
  }

  @RequireRole('OWNER', 'ADMIN')
  @Delete('dead-letter/:jobId')
  discardFailedReceipt(@Param('id') orgId: string, @Param('jobId') jobId: string) {
    return this.svc.discardFailedReceiptJob(orgId, jobId);
  }

  @Get(':productId')
  getProduct(@Param('id') orgId: string, @Param('productId') productId: string) {
    return this.svc.getProduct(orgId, productId);
  }

  @Patch(':productId')
  updateProduct(
    @Param('id') orgId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateRegistrationProductDto,
  ) {
    return this.svc.updateProduct(orgId, productId, dto);
  }

  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id') orgId: string, @Param('productId') productId: string) {
    return this.svc.deleteProduct(orgId, productId);
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  @Get(':productId/entries')
  listEntries(@Param('id') orgId: string, @Param('productId') productId: string) {
    return this.svc.listEntries(orgId, productId);
  }

  @Patch('entries/:entryId')
  updateEntry(
    @Param('id') orgId: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateRegistrationEntryDto,
  ) {
    return this.svc.updateEntryStatus(orgId, entryId, dto);
  }

  // ── Entry scanning / admission ───────────────────────────────────────────────

  @Post('checkin')
  @HttpCode(HttpStatus.OK)
  @RequireRole('OWNER', 'ADMIN', 'AGENT')
  checkIn(@Param('id') orgId: string, @Body() dto: CheckInDto) {
    return this.svc.checkInByCode(orgId, dto.code, dto.productId);
  }

  // Manual admit / undo a specific entry from the Check-in list (fallback when a QR won't scan).
  @Post('entries/:entryId/checkin')
  @HttpCode(HttpStatus.OK)
  @RequireRole('OWNER', 'ADMIN', 'AGENT')
  manualCheckIn(@Param('id') orgId: string, @Param('entryId') entryId: string, @Body() dto: ManualCheckInDto) {
    return this.svc.setEntryCheckIn(orgId, entryId, dto.admit !== false);
  }

  // ── Ticket tiers ────────────────────────────────────────────────────────────

  @Get(':productId/ticket-types')
  listTicketTypes(@Param('id') orgId: string, @Param('productId') productId: string) {
    return this.svc.listTicketTypes(orgId, productId);
  }

  @Post(':productId/ticket-types')
  @RequireRole('OWNER', 'ADMIN')
  createTicketType(
    @Param('id') orgId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateTicketTypeDto,
  ) {
    return this.svc.createTicketType(orgId, productId, dto);
  }

  @Patch('ticket-types/:ticketTypeId')
  @RequireRole('OWNER', 'ADMIN')
  updateTicketType(
    @Param('id') orgId: string,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.svc.updateTicketType(orgId, ticketTypeId, dto);
  }

  @Delete('ticket-types/:ticketTypeId')
  @RequireRole('OWNER', 'ADMIN')
  deleteTicketType(@Param('id') orgId: string, @Param('ticketTypeId') ticketTypeId: string) {
    return this.svc.deleteTicketType(orgId, ticketTypeId);
  }
}
