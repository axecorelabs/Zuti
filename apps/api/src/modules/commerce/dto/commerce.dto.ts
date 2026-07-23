import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCommerceStoreDto {
  @ApiProperty({ example: 'Main Store' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;

  @ApiPropertyOptional({ enum: ['NGN', 'USD'], example: 'NGN' })
  @IsOptional()
  @IsString()
  @IsIn(['NGN', 'USD'])
  currency?: 'NGN' | 'USD';

  @ApiPropertyOptional({ description: 'Optional store metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateCommerceOrderItemDto {
  @ApiProperty({ example: 'ck_variant_123' })
  @IsString()
  @IsNotEmpty()
  declare variantId: string;

  @ApiPropertyOptional({ example: 'ck_location_123' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  declare quantity: number;
}

export class CreateCommerceOrderDraftDto {
  @ApiProperty({ description: 'Store ID the order belongs to', example: 'ck_store_123' })
  @IsString()
  @IsNotEmpty()
  declare storeId: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  @ApiPropertyOptional({ example: '12 Admiralty Way, Lekki, Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @ApiPropertyOptional({ example: 'Please call on arrival.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [CreateCommerceOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCommerceOrderItemDto)
  declare items: CreateCommerceOrderItemDto[];

  @ApiPropertyOptional({ description: 'Optional order metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCommerceStoreDto {
  @ApiPropertyOptional({ example: 'My Store Renamed' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'ACCT_xxxxxxxxxx', description: 'Paystack subaccount code for split payments. Send empty string to remove.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paystackSubaccountCode?: string;
}

export class InitializeCommerceOrderPaymentDto {
  @ApiPropertyOptional({ example: 'john@example.com', description: 'Fallback email if not already set on order.' })
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ description: 'Optional callback URL after Paystack checkout' })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ApiPropertyOptional({ description: 'Optional idempotency key for client retries' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class VerifyCommerceOrderPaymentDto {
  @ApiPropertyOptional({ example: 'zuti_commerce_1717080000000_ab12cd34ef56' })
  @IsOptional()
  @IsString()
  reference?: string;
}

export const ORDER_FULFILLMENT_STATUSES = ['UNFULFILLED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number];

export class UpdateCommerceOrderFulfillmentDto {
  @ApiProperty({ enum: ORDER_FULFILLMENT_STATUSES, example: 'SHIPPED' })
  @IsIn(ORDER_FULFILLMENT_STATUSES)
  declare status: OrderFulfillmentStatus;
}

export class CreateCommerceLocationDto {
  @ApiProperty({ description: 'Target store ID', example: 'ck_store_123' })
  @IsString()
  @IsNotEmpty()
  declare storeId: string;

  @ApiProperty({ example: 'Lagos Warehouse' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;

  @ApiProperty({ example: 'LOS_WH_1' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  declare code: string;

  @ApiPropertyOptional({ description: 'Structured address fields' })
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 100, description: 'Lower values are preferred in routing' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({ description: 'Optional location metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateCommerceProductDto {
  @ApiProperty({ description: 'Target store ID', example: 'ck_store_123' })
  @IsString()
  @IsNotEmpty()
  declare storeId: string;

  @ApiProperty({ example: 'Air Runner Sneakers' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  declare title: string;

  @ApiPropertyOptional({ example: 'air-runner-sneakers' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  slug?: string;

  @ApiPropertyOptional({ example: 'Breathable everyday sneakers with cushioned sole.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional({ example: 'Footwear' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/product.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ isArray: true, example: ['sneakers', 'men', 'running'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Optional product metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateCommerceVariantDto {
  @ApiProperty({ description: 'Target product ID', example: 'ck_product_123' })
  @IsString()
  @IsNotEmpty()
  declare productId: string;

  @ApiProperty({ example: 'AIR-RUNNER-BLK-42' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare sku: string;

  @ApiPropertyOptional({ example: 'Black / Size 42' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/variant.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Variant attributes such as size/color' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiProperty({ example: 35000, description: 'Minor unit price. 35000 => NGN 350.00 if 2 decimals are used' })
  @IsInt()
  @Min(0)
  declare priceMinor: number;

  @ApiProperty({ enum: ['NGN', 'USD'], example: 'NGN' })
  @IsString()
  @IsIn(['NGN', 'USD'])
  declare currency: 'NGN' | 'USD';

  @ApiPropertyOptional({ description: 'Optional variant metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCommerceVariantDto {
  @ApiPropertyOptional({ example: 'AIR-RUNNER-BLK-42' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  sku?: string;

  @ApiPropertyOptional({ example: 'Black / Size 42' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/variant.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Variant attributes such as size/color' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 35000, description: 'Minor unit price. 35000 => NGN 350.00 if 2 decimals are used' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @ApiPropertyOptional({ enum: ['NGN', 'USD'], example: 'NGN' })
  @IsOptional()
  @IsString()
  @IsIn(['NGN', 'USD'])
  currency?: 'NGN' | 'USD';

  @ApiPropertyOptional({ description: 'Optional variant metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCommerceProductDto {
  @ApiPropertyOptional({ example: 'Updated product title' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class GenerateCommerceProductDescriptionDto {
  @ApiProperty({ example: 'Classic white t-shirt' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ example: 'Apparel' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @ApiPropertyOptional({ isArray: true, example: ['cotton', 'unisex'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: 'array',
    description: 'Product specifications as key/value pairs',
  })
  @IsOptional()
  @IsArray()
  specs?: Array<{ key: string; value: string }>;

  @ApiPropertyOptional({ description: 'Existing description to improve' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  currentDescription?: string;

  @ApiPropertyOptional({ enum: ['generate', 'improve'], example: 'generate' })
  @IsOptional()
  @IsString()
  mode?: 'generate' | 'improve';
}

export class SetupCommerceStoreSubaccountDto {
  @ApiProperty({ example: 'Sunshine Stores Ltd' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare businessName: string;

  @ApiProperty({ example: '044', description: 'Paystack bank code from GET /commerce/banks' })
  @IsString()
  @IsNotEmpty()
  declare settlementBank: string;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  declare accountNumber: string;

  @ApiPropertyOptional({ example: 0, description: 'Percentage of transaction to send to subaccount (0–100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentageCharge?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  primaryContactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  primaryContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  primaryContactPhone?: string;
}

export class UpsertCommerceInventoryDto {
  @ApiProperty({ description: 'Variant ID', example: 'ck_variant_123' })
  @IsString()
  @IsNotEmpty()
  declare variantId: string;

  @ApiProperty({ description: 'Location ID', example: 'ck_location_123' })
  @IsString()
  @IsNotEmpty()
  declare locationId: string;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  @Min(0)
  onHand?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  reserved?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderPoint?: number;

  @ApiPropertyOptional({ description: 'Optional inventory metadata payload' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
