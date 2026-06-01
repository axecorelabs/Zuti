import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { CommerceService } from './commerce.service';
import {
  CreateCommerceLocationDto,
  CreateCommerceOrderDraftDto,
  CreateCommerceProductDto,
  CreateCommerceStoreDto,
  CreateCommerceVariantDto,
  GenerateCommerceProductDescriptionDto,
  InitializeCommerceOrderPaymentDto,
  SetupCommerceStoreSubaccountDto,
  UpdateCommerceProductDto,
  UpdateCommerceVariantDto,
  UpdateCommerceStoreDto,
  UpsertCommerceInventoryDto,
  VerifyCommerceOrderPaymentDto,
} from './dto/commerce.dto';

@ApiTags('commerce')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard)
@RequireRole('OWNER', 'ADMIN', 'AGENT')
@Controller('organizations/:id/commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Post('upload')
  @RequireRole('OWNER', 'ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a product image' })
  uploadImage(
    @Param('id') orgId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.commerce.uploadProductImage(orgId, file);
  }

  @Get('stores/banks')
  @ApiOperation({ summary: 'List Nigerian banks for Paystack subaccount setup' })
  listBanks() {
    return this.commerce.listBanks();
  }

  @Get('stores/banks/resolve')
  @ApiOperation({ summary: 'Resolve account holder name from bank code + account number' })
  @ApiQuery({ name: 'accountNumber', required: true })
  @ApiQuery({ name: 'bankCode', required: true })
  resolveAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    return this.commerce.resolveAccount(accountNumber, bankCode);
  }

  @Get('stores')
  @ApiOperation({ summary: 'List active commerce stores for this organization' })
  stores(@Param('id') orgId: string) {
    return this.commerce.listStores(orgId);
  }

  @Post('stores')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a commerce store' })
  createStore(@Param('id') orgId: string, @Body() dto: CreateCommerceStoreDto) {
    return this.commerce.createStore(orgId, dto);
  }

  @Patch('stores/:storeId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update store settings (name, Paystack subaccount)' })
  updateStore(
    @Param('id') orgId: string,
    @Param('storeId') storeId: string,
    @Body() dto: UpdateCommerceStoreDto,
  ) {
    return this.commerce.updateStore(orgId, storeId, dto);
  }

  @Delete('stores/:storeId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a commerce store' })
  deactivateStore(@Param('id') orgId: string, @Param('storeId') storeId: string) {
    return this.commerce.deactivateStore(orgId, storeId);
  }

  @Post('stores/:storeId/subaccount')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create Paystack subaccount for a store via API' })
  setupSubaccount(
    @Param('id') orgId: string,
    @Param('storeId') storeId: string,
    @Body() dto: SetupCommerceStoreSubaccountDto,
  ) {
    return this.commerce.setupStoreSubaccount(orgId, storeId, dto);
  }

  @Post('locations')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a commerce location under a store' })
  createLocation(@Param('id') orgId: string, @Body() dto: CreateCommerceLocationDto) {
    return this.commerce.createLocation(orgId, dto);
  }

  @Post('products')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a commerce product' })
  createProduct(@Param('id') orgId: string, @Req() req: any, @Body() dto: CreateCommerceProductDto) {
    return this.commerce.createProduct(orgId, dto, req.user);
  }

  @Post('products/description/generate')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Generate or improve a product description using the AI service' })
  generateProductDescription(@Param('id') orgId: string, @Body() dto: GenerateCommerceProductDescriptionDto) {
    return this.commerce.generateProductDescription(orgId, dto);
  }

  @Patch('products/:productId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update a product\'s details' })
  updateProduct(
    @Param('id') orgId: string,
    @Param('productId') productId: string,
    @Req() req: any,
    @Body() dto: UpdateCommerceProductDto,
  ) {
    return this.commerce.updateProduct(orgId, productId, dto, req.user);
  }

  @Post('variants')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a product variant' })
  createVariant(@Param('id') orgId: string, @Req() req: any, @Body() dto: CreateCommerceVariantDto) {
    return this.commerce.createVariant(orgId, dto, req.user);
  }

  @Patch('variants/:variantId')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Update a product variant' })
  updateVariant(
    @Param('id') orgId: string,
    @Param('variantId') variantId: string,
    @Req() req: any,
    @Body() dto: UpdateCommerceVariantDto,
  ) {
    return this.commerce.updateVariant(orgId, variantId, dto, req.user);
  }

  @Post('inventory/upsert')
  @RequireRole('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Upsert inventory values for a variant at a location' })
  upsertInventory(@Param('id') orgId: string, @Req() req: any, @Body() dto: UpsertCommerceInventoryDto) {
    return this.commerce.upsertInventory(orgId, dto, req.user);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Create a commerce order draft' })
  createOrderDraft(@Param('id') orgId: string, @Body() dto: CreateCommerceOrderDraftDto) {
    return this.commerce.createOrderDraft(orgId, dto);
  }

  @Get('payments')
  @ApiOperation({ summary: 'List all commerce payment records with summary' })
  @ApiQuery({ name: 'limit', required: false })
  listPayments(@Param('id') orgId: string, @Query('limit') limit?: string) {
    return this.commerce.listPayments(orgId, limit ? Number(limit) : undefined);
  }

  @Get('orders')
  @ApiOperation({ summary: 'List commerce orders for this organization' })
  @ApiQuery({ name: 'limit', required: false })
  listOrders(@Param('id') orgId: string, @Query('limit') limit?: string) {
    return this.commerce.listOrders(orgId, limit ? Number(limit) : undefined);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order context with items and payment records' })
  getOrder(@Param('id') orgId: string, @Param('orderId') orderId: string) {
    return this.commerce.getOrder(orgId, orderId);
  }

  @Post('orders/:orderId/payment/initialize')
  @ApiOperation({ summary: 'Initialize Paystack payment for an order' })
  initializeOrderPayment(
    @Param('id') orgId: string,
    @Param('orderId') orderId: string,
    @Body() dto: InitializeCommerceOrderPaymentDto,
  ) {
    return this.commerce.initializeOrderPayment(orgId, orderId, dto);
  }

  @Post('orders/:orderId/payment/verify')
  @ApiOperation({ summary: 'Verify Paystack payment and settle order status' })
  verifyOrderPayment(
    @Param('id') orgId: string,
    @Param('orderId') orderId: string,
    @Body() dto: VerifyCommerceOrderPaymentDto,
  ) {
    return this.commerce.verifyOrderPayment(orgId, orderId, dto.reference);
  }

  @Get('products/search')
  @ApiOperation({ summary: 'Search active commerce products for AI grounding and storefront guidance' })
  @ApiQuery({ name: 'q', required: false, description: 'Free-text product query' })
  @ApiQuery({ name: 'limit', required: false, description: 'Result size, default 20, max 50' })
  searchProducts(
    @Param('id') orgId: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commerce.searchProducts(orgId, q, limit ? Number(limit) : undefined);
  }

  @Get('products/:productId')
  @ApiOperation({ summary: 'Get full product context (variants and per-location stock) for grounded AI responses' })
  getProductContext(
    @Param('id') orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.commerce.getProductContext(orgId, productId);
  }

  @Get('variants/:variantId/availability')
  @ApiOperation({ summary: 'Get variant availability across active locations' })
  getVariantAvailability(
    @Param('id') orgId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.commerce.getVariantAvailability(orgId, variantId);
  }
}
