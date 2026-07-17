import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { RECEIPTS_QUEUE } from '../queue/queue.module';
import { RECEIPT_JOB, RECEIPT_JOB_OPTIONS } from '../queue/receipts.processor';
import {
  CommerceOrderStatus,
  CommercePaymentStatus,
  Prisma,
} from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityAction, ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
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
} from './dto/commerce.dto';
import { resolveSupabaseStorageConfig, uploadBufferToSupabaseStorage } from '../../common/utils/supabase-storage';

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data?: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paid_at?: string;
  };
};

function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(raw as number)));
}

function computeAvailable(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class CommerceService {
  private readonly logger = new Logger(CommerceService.name);
  private readonly paystackReferencePattern = /^zuti_commerce_[0-9]{13}_[a-f0-9]{12}$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    @InjectQueue(RECEIPTS_QUEUE) private readonly receiptsQueue: Queue,
  ) {}

  private async enqueueEcommerceReceipt(orderId: string, orgId: string) {
    try {
      await this.receiptsQueue.add(
        RECEIPT_JOB.ECOMMERCE,
        { orderId, orgId },
        RECEIPT_JOB_OPTIONS,
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue ecommerce receipt job for order ${orderId}: ${String(err)}`);
    }
  }

  private async recordMutation(
    orgId: string,
    actor: { id?: string; name?: string | null; email?: string | null } | undefined,
    action: ActivityAction,
    targetType: string,
    targetId: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
  ) {
    const actorId = actor?.id ?? null;
    const actorName = actor?.name?.trim() || actor?.email?.trim() || 'System';
    await Promise.all([
      this.activity.log(orgId, actorId, actorName, action, targetType, targetId, metadata),
      this.notifications.createOrgNotification(orgId, 'commerce_change', title, body, {
        ...metadata,
        action,
        targetType,
        targetId,
        actorId,
        actorName,
      }),
    ]);
  }

  async listStores(orgId: string) {
    return this.prisma.commerceStore.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      include: {
        locations: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            code: true,
            priority: true,
            isActive: true,
          },
          orderBy: { priority: 'asc' },
        },
        _count: {
          select: {
            locations: true,
            products: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivateStore(orgId: string, storeId: string) {
    const store = await this.prisma.commerceStore.findFirst({
      where: { id: storeId, organizationId: orgId, isActive: true },
    });
    if (!store) throw new NotFoundException('Commerce store not found');
    return this.prisma.commerceStore.update({
      where: { id: storeId },
      data: { isActive: false },
    });
  }

  async listPayments(orgId: string, limit = 50) {
    const effectiveLimit = Math.max(1, Math.min(200, limit));
    const payments = await this.prisma.commercePayment.findMany({
      where: { organizationId: orgId },
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            customerEmail: true,
            store: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: effectiveLimit,
    });

    // Build per-currency summary
    const summary: Record<string, { receivedMinor: number; pendingMinor: number; count: number }> = {};
    for (const p of payments) {
      if (!summary[p.currency]) summary[p.currency] = { receivedMinor: 0, pendingMinor: 0, count: 0 };
      summary[p.currency].count++;
      if (p.status === 'SUCCESS') summary[p.currency].receivedMinor += p.amountMinor;
      if (p.status === 'PENDING') summary[p.currency].pendingMinor += p.amountMinor;
    }

    return { summary, payments };
  }

  async listBanks() {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    const res = await firstValueFrom(
      this.httpService.get<{ status: boolean; data: Array<{ name: string; code: string; active: boolean }> }>(
        'https://api.paystack.co/bank',
        {
          params: { currency: 'NGN', use_cursor: false, perPage: 100 },
          headers: { Authorization: `Bearer ${secret}` },
        },
      ),
    );
    return (res.data?.data ?? []).filter((b) => b.active).map((b) => ({ name: b.name, code: b.code }));
  }

  async resolveAccount(accountNumber: string, bankCode: string) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    type ResolveResponse = { status: boolean; message: string; data?: { account_number: string; account_name: string } };
    const res = await firstValueFrom(
      this.httpService.get<ResolveResponse>(
        'https://api.paystack.co/bank/resolve',
        {
          params: { account_number: accountNumber, bank_code: bankCode },
          headers: { Authorization: `Bearer ${secret}` },
        },
      ),
    );
    if (!res.data?.status || !res.data?.data?.account_name) {
      throw new BadRequestException(res.data?.message ?? 'Could not resolve account');
    }
    return { accountName: res.data.data.account_name };
  }

  async generateProductDescription(orgId: string, dto: GenerateCommerceProductDescriptionDto) {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000';
    const response = await firstValueFrom(
      this.httpService.post<{ description: string }>(
        `${aiServiceUrl.replace(/\/$/, '')}/api/v1/commerce/product-description`,
        {
          title: dto.title,
          category: dto.category,
          tags: dto.tags ?? [],
          specs: dto.specs ?? [],
          current_description: dto.currentDescription,
          mode: dto.mode ?? 'generate',
          organization_id: orgId,
        },
        { timeout: 30000 },
      ),
    );

    if (!response.data?.description) {
      throw new BadRequestException('Could not generate product description');
    }

    return { description: response.data.description };
  }

  async setupStoreSubaccount(orgId: string, storeId: string, dto: SetupCommerceStoreSubaccountDto) {
    const store = await this.prisma.commerceStore.findFirst({
      where: { id: storeId, organizationId: orgId, isActive: true },
    });
    if (!store) throw new NotFoundException('Commerce store not found');

    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');

    type SubaccountResponse = { status: boolean; message: string; data?: { subaccount_code: string } };
    const response = await firstValueFrom(
      this.httpService.post<SubaccountResponse>(
        'https://api.paystack.co/subaccount',
        {
          business_name: dto.businessName,
          settlement_bank: dto.settlementBank,
          account_number: dto.accountNumber,
          percentage_charge: 95, // Zuti platform fee: 5%; merchant receives 95%
          primary_contact_email: dto.primaryContactEmail,
          primary_contact_name: dto.primaryContactName,
          primary_contact_phone: dto.primaryContactPhone,
        },
        { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } },
      ),
    );

    if (!response.data?.status || !response.data?.data?.subaccount_code) {
      throw new BadRequestException(
        `Paystack subaccount creation failed: ${response.data?.message ?? 'Unknown error'}`,
      );
    }

    const subaccountCode = response.data.data.subaccount_code;
    const existingMeta = store.metadata && typeof store.metadata === 'object'
      ? (store.metadata as Record<string, unknown>)
      : {};

    return this.prisma.commerceStore.update({
      where: { id: storeId },
      data: {
        metadata: {
          ...existingMeta,
          paystackSubaccountCode: subaccountCode,
          paystackBusinessName: dto.businessName,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async updateProduct(
    orgId: string,
    productId: string,
    dto: UpdateCommerceProductDto,
    actor?: { id?: string; name?: string | null; email?: string | null },
  ) {
    const product = await this.prisma.commerceProduct.findFirst({
      where: { id: productId, store: { organizationId: orgId, isActive: true } },
    });
    if (!product) throw new NotFoundException('Commerce product not found');

    const updateData: Prisma.CommerceProductUpdateInput = {};
    if (dto.title !== undefined) {
      updateData.title = dto.title.trim();
      updateData.slug = normalizeSlug(dto.title.trim());
    }
    if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
    if (dto.category !== undefined) updateData.category = dto.category?.trim() || null;
    if (dto.imageUrl !== undefined) updateData.imageUrl = dto.imageUrl?.trim() || null;
    if (dto.tags !== undefined) updateData.tags = dto.tags.map((t) => t.trim()).filter(Boolean);
    if (dto.metadata !== undefined) {
      const currentMeta = product.metadata && typeof product.metadata === 'object'
        ? (product.metadata as Record<string, unknown>)
        : {};
      updateData.metadata = { ...currentMeta, ...dto.metadata } as Prisma.InputJsonValue;
    }

    try {
      const updated = await this.prisma.commerceProduct.update({ where: { id: productId }, data: updateData });
      await this.recordMutation(
        orgId,
        actor,
        ActivityAction.COMMERCE_PRODUCT_UPDATED,
        'commerce_product',
        updated.id,
        `Product updated: ${updated.title}`,
        `The product ${updated.title} was updated.`,
        { productId: updated.id, title: updated.title },
      );
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('A product with this slug already exists for the store');
      }
      throw error;
    }
  }

  async updateStore(orgId: string, storeId: string, dto: UpdateCommerceStoreDto) {
    const store = await this.prisma.commerceStore.findFirst({
      where: { id: storeId, organizationId: orgId, isActive: true },
    });
    if (!store) throw new NotFoundException('Commerce store not found');

    const existingMeta = store.metadata && typeof store.metadata === 'object'
      ? (store.metadata as Record<string, unknown>)
      : {};

    const updatedMeta: Record<string, unknown> = { ...existingMeta };
    if (dto.paystackSubaccountCode !== undefined) {
      if (dto.paystackSubaccountCode) {
        updatedMeta.paystackSubaccountCode = dto.paystackSubaccountCode.trim();
      } else {
        delete updatedMeta.paystackSubaccountCode;
      }
    }

    return this.prisma.commerceStore.update({
      where: { id: storeId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        metadata: updatedMeta as Prisma.InputJsonValue,
      },
    });
  }

  async createStore(orgId: string, dto: CreateCommerceStoreDto) {
    try {
      return await this.prisma.commerceStore.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          currency: dto.currency ?? 'NGN',
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      throw new BadRequestException(`Failed to create commerce store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createLocation(orgId: string, dto: CreateCommerceLocationDto) {
    const store = await this.prisma.commerceStore.findFirst({
      where: {
        id: dto.storeId,
        organizationId: orgId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Commerce store not found for this organization');

    try {
      return await this.prisma.commerceLocation.create({
        data: {
          storeId: store.id,
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          address: (dto.address ?? {}) as Prisma.InputJsonValue,
          priority: dto.priority ?? 100,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('A location with this code already exists for the store');
      }
      throw new BadRequestException(`Failed to create commerce location: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createProduct(
    orgId: string,
    dto: CreateCommerceProductDto,
    actor?: { id?: string; name?: string | null; email?: string | null },
  ) {
    const store = await this.prisma.commerceStore.findFirst({
      where: {
        id: dto.storeId,
        organizationId: orgId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!store) throw new NotFoundException('Commerce store not found for this organization');

    const normalizedSlug = normalizeSlug(dto.slug?.length ? dto.slug : dto.title);
    if (!normalizedSlug) {
      throw new BadRequestException('Unable to derive a valid product slug from the input');
    }

    try {
      const created = await this.prisma.commerceProduct.create({
        data: {
          storeId: store.id,
          title: dto.title.trim(),
          slug: normalizedSlug,
          description: dto.description?.trim() || null,
          category: dto.category?.trim() || null,
          imageUrl: dto.imageUrl?.trim() || null,
          tags: (dto.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0),
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      await this.recordMutation(
        orgId,
        actor,
        ActivityAction.COMMERCE_PRODUCT_CREATED,
        'commerce_product',
        created.id,
        `Product created: ${created.title}`,
        `A new product named ${created.title} was created.`,
        { productId: created.id, title: created.title, slug: created.slug },
      );
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('A product with this slug already exists for the store');
      }
      throw new BadRequestException(`Failed to create commerce product: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createVariant(
    orgId: string,
    dto: CreateCommerceVariantDto,
    actor?: { id?: string; name?: string | null; email?: string | null },
  ) {
    const product = await this.prisma.commerceProduct.findFirst({
      where: {
        id: dto.productId,
        isActive: true,
        store: {
          organizationId: orgId,
          isActive: true,
        },
      },
      include: {
        store: {
          select: { currency: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Commerce product not found for this organization');

    if (dto.currency !== product.store.currency) {
      throw new BadRequestException('Variant currency must match the store currency');
    }

    try {
      const metadata = {
        ...(dto.metadata ?? {}),
        ...(dto.imageUrl ? { imageUrl: dto.imageUrl.trim() } : {}),
      } as Prisma.InputJsonValue;
      const created = await this.prisma.commerceVariant.create({
        data: {
          productId: product.id,
          sku: dto.sku.trim().toUpperCase(),
          title: dto.title?.trim() || null,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
          priceMinor: dto.priceMinor,
          currency: dto.currency,
          metadata,
        },
      });
      await this.recordMutation(
        orgId,
        actor,
        ActivityAction.COMMERCE_VARIANT_CREATED,
        'commerce_variant',
        created.id,
        `Variant created for ${product.title}`,
        `A new variant was created for ${product.title}.`,
        { productId: product.id, variantId: created.id, sku: created.sku },
      );
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('A variant with this SKU already exists for the product');
      }
      throw new BadRequestException(`Failed to create commerce variant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateVariant(
    orgId: string,
    variantId: string,
    dto: UpdateCommerceVariantDto,
    actor?: { id?: string; name?: string | null; email?: string | null },
  ) {
    const variant = await this.prisma.commerceVariant.findFirst({
      where: {
        id: variantId,
        isActive: true,
        product: {
          store: {
            organizationId: orgId,
            isActive: true,
          },
        },
      },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            store: { select: { currency: true } },
          },
        },
      },
    });

    if (!variant) throw new NotFoundException('Commerce variant not found for this organization');

    if (dto.currency !== undefined && dto.currency !== variant.product.store.currency) {
      throw new BadRequestException('Variant currency must match the store currency');
    }

    const currentMetadata = variant.metadata && typeof variant.metadata === 'object'
      ? (variant.metadata as Record<string, unknown>)
      : {};
    const nextMetadata: Record<string, unknown> = { ...currentMetadata };

    if (dto.imageUrl !== undefined) {
      const trimmedImageUrl = dto.imageUrl.trim();
      if (trimmedImageUrl) nextMetadata.imageUrl = trimmedImageUrl;
      else delete nextMetadata.imageUrl;
    }
    if (dto.metadata) {
      Object.assign(nextMetadata, dto.metadata);
    }

    try {
      const updated = await this.prisma.commerceVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku.trim().toUpperCase() } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() || null } : {}),
          ...(dto.priceMinor !== undefined ? { priceMinor: dto.priceMinor } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.attributes !== undefined ? { attributes: dto.attributes as Prisma.InputJsonValue } : {}),
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });

      await this.recordMutation(
        orgId,
        actor,
        ActivityAction.COMMERCE_VARIANT_UPDATED,
        'commerce_variant',
        updated.id,
        `Variant updated for ${variant.product.title}`,
        `A variant was updated for ${variant.product.title}.`,
        { productId: variant.product.id, variantId: updated.id, sku: updated.sku },
      );

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('A variant with this SKU already exists for the product');
      }
      throw new BadRequestException(`Failed to update commerce variant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async upsertInventory(
    orgId: string,
    dto: UpsertCommerceInventoryDto,
    actor?: { id?: string; name?: string | null; email?: string | null },
  ) {
    if (dto.onHand === undefined && dto.reserved === undefined && dto.reorderPoint === undefined && dto.metadata === undefined) {
      throw new BadRequestException('Provide at least one field to update in inventory upsert');
    }

    const [variant, location] = await Promise.all([
      this.prisma.commerceVariant.findFirst({
        where: {
          id: dto.variantId,
          isActive: true,
          product: {
            store: {
              organizationId: orgId,
              isActive: true,
            },
          },
        },
        select: {
          id: true,
          product: {
            select: { storeId: true },
          },
        },
      }),
      this.prisma.commerceLocation.findFirst({
        where: {
          id: dto.locationId,
          isActive: true,
          store: {
            organizationId: orgId,
            isActive: true,
          },
        },
        select: {
          id: true,
          storeId: true,
        },
      }),
    ]);

    if (!variant) throw new NotFoundException('Commerce variant not found for this organization');
    if (!location) throw new NotFoundException('Commerce location not found for this organization');
    if (variant.product.storeId !== location.storeId) {
      throw new BadRequestException('Variant and location must belong to the same store');
    }

    const existing = await this.prisma.commerceInventoryLevel.findUnique({
      where: {
        variantId_locationId: {
          variantId: variant.id,
          locationId: location.id,
        },
      },
    });

    const updated = await this.prisma.commerceInventoryLevel.upsert({
      where: {
        variantId_locationId: {
          variantId: variant.id,
          locationId: location.id,
        },
      },
      create: {
        variantId: variant.id,
        locationId: location.id,
        onHand: dto.onHand ?? 0,
        reserved: dto.reserved ?? 0,
        reorderPoint: dto.reorderPoint ?? 0,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        ...(dto.onHand !== undefined && { onHand: dto.onHand }),
        ...(dto.reserved !== undefined && { reserved: dto.reserved }),
        ...(dto.reorderPoint !== undefined && { reorderPoint: dto.reorderPoint }),
        ...(dto.metadata !== undefined && { metadata: dto.metadata as Prisma.InputJsonValue }),
      },
    });

    const result = {
      ...updated,
      available: computeAvailable(updated.onHand, updated.reserved),
      previous: existing
        ? {
            onHand: existing.onHand,
            reserved: existing.reserved,
            reorderPoint: existing.reorderPoint,
            available: computeAvailable(existing.onHand, existing.reserved),
          }
        : null,
    };

    await this.recordMutation(
      orgId,
      actor,
      ActivityAction.COMMERCE_INVENTORY_UPDATED,
      'commerce_inventory_level',
      updated.id,
      'Inventory updated',
      'An inventory level was updated.',
      {
        variantId: updated.variantId,
        locationId: updated.locationId,
        onHand: updated.onHand,
        reserved: updated.reserved,
        reorderPoint: updated.reorderPoint,
      },
    );

    return result;
  }

  async searchProducts(orgId: string, q?: string, limit?: number) {
    const search = (q ?? '').trim();
    const take = clampLimit(limit, 20, 50);

    const products = await this.prisma.commerceProduct.findMany({
      where: {
        isActive: true,
        store: {
          organizationId: orgId,
          isActive: true,
        },
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { category: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
                {
                  variants: {
                    some: {
                      OR: [
                        { sku: { contains: search, mode: 'insensitive' } },
                        { title: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            currency: true,
          },
        },
        variants: {
          where: { isActive: true },
          include: {
            inventoryLevels: {
              include: {
                location: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    isActive: true,
                    priority: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    });

    return {
      total: products.length,
      items: products.map((product) => ({
        id: product.id,
        storeId: product.storeId,
        storeName: product.store.name,
        currency: product.store.currency,
        title: product.title,
        slug: product.slug,
        description: product.description,
        category: product.category,
        imageUrl: product.imageUrl,
        tags: product.tags,
        variantCount: product.variants.length,
        variants: product.variants.map((variant) => {
          const variantMetadata = variant.metadata && typeof variant.metadata === 'object'
            ? (variant.metadata as Record<string, unknown>)
            : {};
          const byLocation = variant.inventoryLevels
            .filter((level) => level.location.isActive)
            .map((level) => ({
              locationId: level.location.id,
              locationName: level.location.name,
              locationCode: level.location.code,
              priority: level.location.priority,
              onHand: level.onHand,
              reserved: level.reserved,
              available: computeAvailable(level.onHand, level.reserved),
            }));

          const totalAvailable = byLocation.reduce((sum, level) => sum + level.available, 0);
          return {
            id: variant.id,
            sku: variant.sku,
            title: variant.title,
            attributes: variant.attributes,
            imageUrl: typeof variantMetadata.imageUrl === 'string' ? variantMetadata.imageUrl : null,
            priceMinor: variant.priceMinor,
            currency: variant.currency,
            totalAvailable,
            inventoryByLocation: byLocation,
          };
        }),
      })),
    };
  }

  async getProductContext(orgId: string, productId: string) {
    const product = await this.prisma.commerceProduct.findFirst({
      where: {
        id: productId,
        store: {
          organizationId: orgId,
          isActive: true,
        },
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            currency: true,
          },
        },
        variants: {
          where: { isActive: true },
          include: {
            inventoryLevels: {
              include: {
                location: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    isActive: true,
                    priority: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Commerce product not found');
    }

    const variants = product.variants.map((variant) => {
      const variantMetadata = variant.metadata && typeof variant.metadata === 'object'
        ? (variant.metadata as Record<string, unknown>)
        : {};
      const byLocation = variant.inventoryLevels
        .filter((level) => level.location.isActive)
        .sort((a, b) => a.location.priority - b.location.priority)
        .map((level) => ({
          locationId: level.location.id,
          locationName: level.location.name,
          locationCode: level.location.code,
          priority: level.location.priority,
          onHand: level.onHand,
          reserved: level.reserved,
          available: computeAvailable(level.onHand, level.reserved),
          reorderPoint: level.reorderPoint,
        }));

      return {
        id: variant.id,
        sku: variant.sku,
        title: variant.title,
        attributes: variant.attributes,
        imageUrl: typeof variantMetadata.imageUrl === 'string' ? variantMetadata.imageUrl : null,
        priceMinor: variant.priceMinor,
        currency: variant.currency,
        totalAvailable: byLocation.reduce((sum, location) => sum + location.available, 0),
        inventoryByLocation: byLocation,
      };
    });

    return {
      id: product.id,
      store: {
        id: product.store.id,
        name: product.store.name,
        currency: product.store.currency,
      },
      title: product.title,
      slug: product.slug,
      description: product.description,
      category: product.category,
      imageUrl: product.imageUrl,
      tags: product.tags,
      isActive: product.isActive,
      metadata: product.metadata,
      variants,
    };
  }

  async getVariantAvailability(orgId: string, variantId: string) {
    const variant = await this.prisma.commerceVariant.findFirst({
      where: {
        id: variantId,
        isActive: true,
        product: {
          store: {
            organizationId: orgId,
            isActive: true,
          },
        },
      },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            slug: true,
            store: {
              select: {
                id: true,
                name: true,
                currency: true,
              },
            },
          },
        },
        inventoryLevels: {
          include: {
            location: {
              select: {
                id: true,
                name: true,
                code: true,
                isActive: true,
                priority: true,
              },
            },
          },
        },
      },
    });

    if (!variant) {
      throw new NotFoundException('Commerce variant not found');
    }

    const inventoryByLocation = variant.inventoryLevels
      .filter((level) => level.location.isActive)
      .sort((a, b) => a.location.priority - b.location.priority)
      .map((level) => ({
        locationId: level.location.id,
        locationName: level.location.name,
        locationCode: level.location.code,
        priority: level.location.priority,
        onHand: level.onHand,
        reserved: level.reserved,
        available: computeAvailable(level.onHand, level.reserved),
        reorderPoint: level.reorderPoint,
      }));

    return {
      variantId: variant.id,
      sku: variant.sku,
      title: variant.title,
      attributes: variant.attributes,
      priceMinor: variant.priceMinor,
      currency: variant.currency,
      product: {
        id: variant.product.id,
        title: variant.product.title,
        slug: variant.product.slug,
      },
      store: variant.product.store,
      totalAvailable: inventoryByLocation.reduce((sum, level) => sum + level.available, 0),
      inventoryByLocation,
    };
  }

  async createOrderDraft(orgId: string, dto: CreateCommerceOrderDraftDto) {
    const store = await this.prisma.commerceStore.findFirst({
      where: {
        id: dto.storeId,
        organizationId: orgId,
        isActive: true,
      },
      select: {
        id: true,
        currency: true,
      },
    });
    if (!store) {
      throw new NotFoundException('Commerce store not found for this organization');
    }

    const variantIds = [...new Set(dto.items.map((item) => item.variantId))];
    const variants = await this.prisma.commerceVariant.findMany({
      where: {
        id: { in: variantIds },
        isActive: true,
        product: {
          storeId: store.id,
          isActive: true,
        },
      },
      select: {
        id: true,
        priceMinor: true,
        currency: true,
        product: {
          select: {
            storeId: true,
          },
        },
      },
    });

    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more variants are invalid for this store');
    }

    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const locationIds = [...new Set(dto.items.map((item) => item.locationId).filter((id): id is string => !!id))];

    if (locationIds.length > 0) {
      const locations = await this.prisma.commerceLocation.findMany({
        where: {
          id: { in: locationIds },
          storeId: store.id,
          isActive: true,
        },
        select: { id: true },
      });
      if (locations.length !== locationIds.length) {
        throw new BadRequestException('One or more locations are invalid for this store');
      }
    }

    const items = dto.items.map((item) => {
      const variant = variantsById.get(item.variantId);
      if (!variant) {
        throw new BadRequestException(`Variant not found: ${item.variantId}`);
      }
      if (variant.currency !== store.currency) {
        throw new BadRequestException('Order currency must match the store and variant currency');
      }
      const lineTotalMinor = variant.priceMinor * item.quantity;
      return {
        variantId: item.variantId,
        locationId: item.locationId ?? null,
        quantity: item.quantity,
        unitPriceMinor: variant.priceMinor,
        lineTotalMinor,
      };
    });

    const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);

    const order = await this.prisma.commerceOrder.create({
      data: {
        organizationId: orgId,
        storeId: store.id,
        customerName: dto.customerName?.trim() || null,
        customerEmail: dto.customerEmail?.trim().toLowerCase() || null,
        customerPhone: dto.customerPhone?.trim() || null,
        deliveryAddress: dto.deliveryAddress?.trim() || null,
        notes: dto.notes?.trim() || null,
        currency: store.currency,
        subtotalMinor,
        totalMinor: subtotalMinor,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
        items: {
          create: items.map((item) => ({
            ...item,
            metadata: {},
          })),
        },
      },
      include: {
        items: true,
      },
    });

    return order;
  }

  async listOrders(orgId: string, limit = 50) {
    const effectiveLimit = Math.max(1, Math.min(100, limit));
    return this.prisma.commerceOrder.findMany({
      where: { organizationId: orgId },
      include: {
        store: { select: { id: true, name: true, currency: true } },
        items: {
          include: {
            variant: {
              select: {
                id: true, sku: true, title: true,
                product: { select: { id: true, title: true } },
              },
            },
          },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: effectiveLimit,
    });
  }

  async uploadProductImage(orgId: string, file: Express.Multer.File): Promise<{ url: string }> {
    const storage = resolveSupabaseStorageConfig(this.configService, {
      bucketEnvKey: 'SUPABASE_COMMERCE_STORAGE_BUCKET',
    });
    if (!storage) {
      throw new BadRequestException('Image storage is not configured on this server');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP and GIF images are accepted');
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Image must be smaller than 5 MB');
    }
    const result = await uploadBufferToSupabaseStorage(storage, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      organizationId: orgId,
      channel: 'commerce',
      fileName: file.originalname,
    });
    const url = result.publicUrl ?? `${storage.url}/storage/v1/object/public/${storage.bucket}/${result.storageKey}`;
    return { url };
  }

  async getOrder(orgId: string, orderId: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: {
        id: orderId,
        organizationId: orgId,
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            currency: true,
          },
        },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                title: true,
                attributes: true,
                product: {
                  select: {
                    id: true,
                    title: true,
                    slug: true,
                  },
                },
              },
            },
            location: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Commerce order not found');
    }

    return order;
  }

  async initializeOrderPayment(orgId: string, orderId: string, dto: InitializeCommerceOrderPaymentDto) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: {
        id: orderId,
        organizationId: orgId,
      },
      include: {
        store: {
          select: {
            metadata: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Commerce order not found');
    }

    if (order.totalMinor <= 0) {
      throw new BadRequestException('Order total must be greater than zero before payment initialization');
    }

    // Idempotency: return existing PENDING payment if one already exists and has an authorization URL
    const pendingPayment = await this.prisma.commercePayment.findFirst({
      where: {
        orderId: order.id,
        organizationId: orgId,
        status: CommercePaymentStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingPayment?.authorizationUrl) {
      // Check idempotency key match if caller provided one
      const storedMeta = pendingPayment.metadata && typeof pendingPayment.metadata === 'object'
        ? (pendingPayment.metadata as Record<string, unknown>)
        : {};
      const keyMatches = !dto.idempotencyKey || storedMeta.idempotencyKey === dto.idempotencyKey;
      if (keyMatches) {
        return {
          orderId: order.id,
          paymentId: pendingPayment.id,
          reference: pendingPayment.reference,
          authorizationUrl: pendingPayment.authorizationUrl,
          reused: true,
        };
      }
    }

    if (order.status === CommerceOrderStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }

    if (order.status === CommerceOrderStatus.CANCELLED || order.status === CommerceOrderStatus.FAILED) {
      throw new BadRequestException('Order cannot be paid in its current status');
    }

    const paystackSecret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    }

    const customerEmail = dto.customerEmail?.trim().toLowerCase() || order.customerEmail;
    if (!customerEmail) {
      throw new BadRequestException('Customer email is required to initialize payment');
    }

    const appUrl = this.configService.get<string>('APP_URL') ?? '';
    const callbackUrl = dto.callbackUrl || (appUrl ? `${appUrl.replace(/\/$/, '')}/commerce/checkout/callback` : undefined);

    const metadataFromStore = order.store.metadata && typeof order.store.metadata === 'object'
      ? (order.store.metadata as Record<string, unknown>)
      : {};
    const subaccount = typeof metadataFromStore.paystackSubaccountCode === 'string'
      ? metadataFromStore.paystackSubaccountCode
      : undefined;

    const reference = `zuti_commerce_${Date.now()}_${randomBytes(6).toString('hex')}`;
    const payload: Record<string, unknown> = {
      amount: order.totalMinor,
      email: customerEmail,
      currency: order.currency,
      reference,
      metadata: {
        organizationId: orgId,
        commerceOrderId: order.id,
        source: 'zuti-commerce',
      },
    };
    if (callbackUrl) payload.callback_url = callbackUrl;
    if (subaccount) payload.subaccount = subaccount;

    const response = await firstValueFrom(
      this.httpService.post<PaystackInitializeResponse>('https://api.paystack.co/transaction/initialize', payload, {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    if (!response.data?.status || !response.data.data?.authorization_url || !response.data.data.reference) {
      throw new BadRequestException(`Paystack initialization failed: ${response.data?.message ?? 'Unknown error'}`);
    }

    const authorizationUrl = response.data.data.authorization_url;
    const paymentReference = response.data.data.reference;

    const payment = await this.prisma.commercePayment.create({
      data: {
        organizationId: orgId,
        orderId: order.id,
        provider: 'PAYSTACK',
        reference: paymentReference,
        amountMinor: order.totalMinor,
        currency: order.currency,
        status: CommercePaymentStatus.PENDING,
        authorizationUrl,
        metadata: {
          requestedByEmail: customerEmail,
          callbackUrl: callbackUrl ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          subaccount: subaccount ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.commerceOrder.update({
      where: { id: order.id },
      data: {
        status: CommerceOrderStatus.PENDING_PAYMENT,
        paymentStatus: CommercePaymentStatus.PENDING,
        customerEmail,
      },
    });

    return {
      orderId: order.id,
      paymentId: payment.id,
      reference: payment.reference,
      authorizationUrl: payment.authorizationUrl,
    };
  }

  async verifyOrderPayment(orgId: string, orderId: string, reference?: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: {
        id: orderId,
        organizationId: orgId,
      },
      include: {
        payments: {
          where: {
            ...(reference ? { reference } : {}),
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Commerce order not found');
    }

    const payment = order.payments.find((p) => p.status === CommercePaymentStatus.PENDING) ?? order.payments[0];
    if (!payment) {
      throw new NotFoundException('No payment attempt found for this order');
    }

    const paystackSecret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!paystackSecret) {
      throw new InternalServerErrorException('PAYSTACK_SECRET_KEY is not configured');
    }

    const response = await firstValueFrom(
      this.httpService.get<PaystackVerifyResponse>(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment.reference)}`, {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    const verified = response.data?.status && response.data.data?.status === 'success';
    const amountMatches = (response.data?.data?.amount ?? 0) === payment.amountMinor;
    const currencyMatches = (response.data?.data?.currency ?? '').toUpperCase() === payment.currency;

    if (verified && amountMatches && currencyMatches) {
      const paidAt = response.data.data?.paid_at ? new Date(response.data.data.paid_at) : new Date();

      const [, orderUpdateResult] = await this.prisma.$transaction([
        this.prisma.commercePayment.update({
          where: { id: payment.id },
          data: {
            status: CommercePaymentStatus.SUCCESS,
            paidAt,
            metadata: {
              ...(payment.metadata as Record<string, unknown>),
              verifyPayload: response.data,
            } as Prisma.InputJsonValue,
          },
        }),
        // Conditional update: only rows not already PAID are affected. This makes the
        // "did THIS call perform the transition" check atomic instead of a racy pre-read,
        // so concurrent webhook/manual-verify calls can't both enqueue a duplicate receipt.
        this.prisma.commerceOrder.updateMany({
          where: { id: order.id, status: { not: CommerceOrderStatus.PAID } },
          data: {
            status: CommerceOrderStatus.PAID,
            paymentStatus: CommercePaymentStatus.SUCCESS,
          },
        }),
      ]);

      if (orderUpdateResult.count > 0) {
        await this.enqueueEcommerceReceipt(order.id, orgId);
      }

      return {
        orderId: order.id,
        reference: payment.reference,
        paid: true,
        status: CommerceOrderStatus.PAID,
      };
    }

    await this.prisma.$transaction([
      this.prisma.commercePayment.update({
        where: { id: payment.id },
        data: {
          status: CommercePaymentStatus.FAILED,
          metadata: {
            ...(payment.metadata as Record<string, unknown>),
            verifyPayload: response.data,
          } as Prisma.InputJsonValue,
        },
      }),
      this.prisma.commerceOrder.update({
        where: { id: order.id },
        data: {
          status: CommerceOrderStatus.FAILED,
          paymentStatus: CommercePaymentStatus.FAILED,
        },
      }),
    ]);

    return {
      orderId: order.id,
      reference: payment.reference,
      paid: false,
      status: CommerceOrderStatus.FAILED,
      reason: {
        verified,
        amountMatches,
        currencyMatches,
      },
    };
  }

  async handlePaystackWebhook(signature: string | undefined, rawBody: Buffer, payload: any) {
    if (!this.isPaystackSignatureValid(signature, rawBody)) {
      this.logger.warn('Ignoring commerce Paystack webhook with invalid signature');
      return { ok: true };
    }

    if (payload?.event !== 'charge.success') {
      return { ok: true };
    }

    const reference = payload?.data?.reference;
    if (!reference || typeof reference !== 'string') {
      return { ok: true };
    }

    if (!this.paystackReferencePattern.test(reference)) {
      return { ok: true };
    }

    const payment = await this.prisma.commercePayment.findUnique({
      where: { reference },
      select: {
        id: true,
        orderId: true,
        organizationId: true,
        status: true,
      },
    });

    if (!payment) {
      return { ok: true };
    }

    if (payment.status === CommercePaymentStatus.SUCCESS) {
      return { ok: true };
    }

    try {
      await this.verifyOrderPayment(payment.organizationId, payment.orderId, reference);
    } catch (error) {
      this.logger.error(`Commerce Paystack webhook verification failed for ${reference}: ${(error as Error).message}`);
    }

    return { ok: true };
  }

  private isPaystackSignatureValid(signature: string | undefined, rawBody: Buffer) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      this.logger.warn('PAYSTACK_SECRET_KEY is missing; rejecting commerce webhook signature validation');
      return false;
    }

    if (!signature || !rawBody?.length) return false;
    if (!/^[a-fA-F0-9]{128}$/.test(signature)) return false;

    const digest = createHmac('sha512', secret).update(rawBody).digest('hex').toLowerCase();
    const digestBuf = Buffer.from(digest, 'utf8');
    const signatureBuf = Buffer.from(signature.toLowerCase(), 'utf8');

    if (digestBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(digestBuf, signatureBuf);
  }
}
