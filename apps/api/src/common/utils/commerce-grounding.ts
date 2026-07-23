import { PrismaClient } from '@prisma/client';

type RawConfig = Record<string, unknown> | null | undefined;

type GroundingParams = {
  prisma: PrismaClient;
  organizationId: string;
  botId?: string;
  aiConfig: RawConfig;
  userText: string;
  maxProducts?: number;
};

function shouldGroundCommerce(aiConfig: RawConfig): boolean {
  // ECOMMERCE-template bots are sales-first and must know the catalog to quote prices/stock and
  // place orders (their unit price flows into the commerce order + payment link).
  if (aiConfig?.guidedPreset === 'ecommerce') return true;
  // SALES specialists (mode=SPECIALIST, skill=SALES) also sell from the catalog.
  const profile = aiConfig?.specialistProfile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const mode = (profile as Record<string, unknown>).mode;
  const skill = (profile as Record<string, unknown>).skill;
  return mode === 'SPECIALIST' && skill === 'SALES';
}

function normalizeTerms(input: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'have', 'has', 'from', 'your', 'you', 'are', 'can', 'like', 'want',
    'need', 'get', 'about', 'please', 'what', 'when', 'where', 'which', 'would', 'could', 'there', 'they', 'them',
  ]);

  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stopWords.has(term))
    .slice(0, 10);
}

function computeAvailability(onHand: number, reserved: number): number {
  return Math.max(0, onHand - reserved);
}

function scoreProduct(
  product: {
    title: string;
    slug: string;
    description: string | null;
    category: string | null;
    tags: string[];
    variants: Array<{ sku: string; title: string | null }>;
  },
  terms: string[],
  userText: string,
): number {
  const combined = [
    product.title,
    product.slug,
    product.description ?? '',
    product.category ?? '',
    product.tags.join(' '),
    product.variants.map((variant) => `${variant.sku} ${variant.title ?? ''}`).join(' '),
  ].join(' ').toLowerCase();

  let score = 0;
  const normalizedUserText = userText.trim().toLowerCase();
  if (normalizedUserText.length >= 4 && combined.includes(normalizedUserText)) {
    score += 5;
  }

  for (const term of terms) {
    if (combined.includes(term)) score += 2;
    if (product.title.toLowerCase().includes(term)) score += 2;
    if ((product.category ?? '').toLowerCase().includes(term)) score += 1;
    if (product.variants.some((variant) => variant.sku.toLowerCase().includes(term))) score += 1;
  }

  return score;
}

export async function buildCommerceGroundingContextBlock({
  prisma,
  organizationId,
  botId,
  aiConfig,
  userText,
  maxProducts = 5,
}: GroundingParams): Promise<string | null> {
  // The most reliable "this bot sells" signal is a linked commerce store — guidedPreset /
  // specialistProfile can be edited away (e.g. flipped to 'Custom'). Scope grounding to that store's
  // catalog. Fall back to the config signal for sales bots that aren't linked to a specific store.
  let storeId: string | null = null;
  if (botId) {
    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { commerceStoreId: true } });
    storeId = bot?.commerceStoreId ?? null;
  }
  if (!storeId && !shouldGroundCommerce(aiConfig)) return null;

  const products = await prisma.commerceProduct.findMany({
    where: {
      isActive: true,
      ...(storeId
        ? { storeId }
        : { store: { organizationId, isActive: true } }),
    },
    include: {
      store: {
        select: {
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
        take: 8,
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });

  if (products.length === 0) {
    return [
      'Commerce Grounding (authoritative):',
      '- No active product catalog is currently available for this organization.',
      '- Do not invent product, pricing, stock, discount, or delivery claims.',
      '- Ask a clarifying question or offer human follow-up if catalog data is needed.',
    ].join('\n');
  }

  const terms = normalizeTerms(userText);
  const ranked = products
    .map((product) => ({
      product,
      score: scoreProduct(product, terms, userText),
    }))
    .sort((a, b) => b.score - a.score);

  const matched = ranked.filter((entry) => entry.score > 0);
  const selected = (matched.length > 0 ? matched : ranked).slice(0, Math.max(1, Math.min(maxProducts, 6)));

  const lines: string[] = [
    'Commerce Grounding (authoritative) — this IS your product catalog; answer product, price, and',
    'stock questions directly from it (you do NOT need to search elsewhere for these):',
    '- Use only the catalog facts below for concrete product/price/stock claims.',
    '- To place an order, pass the chosen variant_id to the order tool (create_sales_order). The price is',
    '  taken from the catalog automatically — do NOT type the price yourself.',
    '- You can also call search_products to look up more items or refine a search.',
    '- If something is missing here, say you cannot confirm it yet and ask a focused follow-up question.',
  ];

  for (const { product, score } of selected) {
    lines.push(`- Product: ${product.title} (slug: ${product.slug}) [store: ${product.store.name}, currency: ${product.store.currency}, match_score: ${score}]`);
    if (product.category) lines.push(`  category: ${product.category}`);
    if (product.description) lines.push(`  description: ${product.description.slice(0, 220)}`);
    if (product.tags.length > 0) lines.push(`  tags: ${product.tags.slice(0, 8).join(', ')}`);

    const variants = product.variants.slice(0, 3);
    if (variants.length === 0) {
      lines.push('  variants: none listed');
      continue;
    }

    for (const variant of variants) {
      const activeLevels = variant.inventoryLevels
        .filter((level) => level.location.isActive)
        .sort((a, b) => a.location.priority - b.location.priority)
        .map((level) => ({
          locationName: level.location.name,
          locationCode: level.location.code,
          available: computeAvailability(level.onHand, level.reserved),
        }));

      const totalAvailable = activeLevels.reduce((sum, level) => sum + level.available, 0);
      const topLocations = activeLevels.slice(0, 3)
        .map((level) => `${level.locationName}(${level.locationCode}):${level.available}`)
        .join(', ');

      // Show the human-facing price (major units), NOT price_minor — the AI passes this value as the
      // order's unit price, so exposing kobo/cents caused a 100x overcharge. No thousands separator,
      // so it parses cleanly when passed to the order tool.
      const priceMajor = (variant.priceMinor / 100).toFixed(2);
      lines.push(
        `  variant: variant_id=${variant.id}; sku=${variant.sku}; title=${variant.title ?? 'n/a'}; unit_price=${priceMajor} (${product.store.currency}); total_available=${totalAvailable}; by_location=${topLocations || 'n/a'}`,
      );
    }
  }

  return lines.join('\n');
}
