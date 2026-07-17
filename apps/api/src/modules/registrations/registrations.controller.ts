import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { RegistrationsService } from './registrations.service';
import { CreateRegistrationProductDto, UpdateRegistrationProductDto, UpdateRegistrationEntryDto } from './dto/registrations.dto';

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
}
