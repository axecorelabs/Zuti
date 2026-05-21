import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const usage = await prisma.aiUsageEvent.findMany({
    where: {
      usageType: 'CUSTOMER_REPLY',
      metadata: { path: ['channel'], equals: 'TELEGRAM' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      organizationId: true,
      conversationId: true,
      createdAt: true,
      metadata: true,
    },
  });

  const ledger = await prisma.creditLedger.findMany({
    where: { type: 'USAGE' },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: {
      organizationId: true,
      creditsDelta: true,
      createdAt: true,
      metadata: true,
      description: true,
    },
  });

  const telegramLedger = ledger.filter((row) => {
    const md = row.metadata && typeof row.metadata === 'object' ? row.metadata : null;
    return md && md.channel === 'TELEGRAM';
  }).slice(0, 20);

  const usageKeys = new Set(usage.map((u) => `${u.organizationId}|${u.conversationId}`));
  const ledgerKeys = new Set(telegramLedger.map((l) => {
    const md = l.metadata && typeof l.metadata === 'object' ? l.metadata : {};
    return `${l.organizationId}|${md.conversationId ?? ''}`;
  }));

  const overlap = [...usageKeys].filter((k) => ledgerKeys.has(k)).length;

  console.log('USAGE_EVENTS_TELEGRAM_COUNT', usage.length);
  console.log('LEDGER_TELEGRAM_COUNT', telegramLedger.length);
  console.log('OVERLAP_KEYS', overlap);
  console.log('LATEST_USAGE', JSON.stringify(usage.slice(0, 5), null, 2));
  console.log('LATEST_LEDGER_TELEGRAM', JSON.stringify(telegramLedger.slice(0, 5), null, 2));
} finally {
  await prisma.$disconnect();
}
