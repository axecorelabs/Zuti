/**
 * One-time (idempotent) backfill: resolve every existing Conversation into a Customer and set
 * Conversation.customerId. Re-runnable — already-linked conversations are skipped. Run AFTER building
 * the API (`npx nest build`) so ./dist reflects the current CustomerIdentityService.
 *
 *   node apps/api/scripts/backfill-customers-from-conversations.js
 *
 * Anchors per channel: Telegram chatId, WhatsApp phone/user id, email (sender address). Widget uses a
 * session-id anchor; a widget-typed email is attached as a NON-anchor attribute. See CUSTOMER_HUB_PLAN.md.
 */
const { PrismaClient } = require('@prisma/client');
const { CustomerIdentityService } = require('../dist/modules/customers/customer-identity.service');

const prisma = new PrismaClient();
const svc = new CustomerIdentityService(prisma);
const PAGE = 500;

function identifiersFor(c) {
  const ids = [];
  if (c.channel === 'TELEGRAM' && c.telegramChatId) ids.push({ type: 'TELEGRAM_CHAT', value: c.telegramChatId, isAnchor: true, source: 'conversation' });
  if (c.channel === 'WHATSAPP') {
    const wa = c.whatsappPhoneNumber || c.whatsappUserId;
    if (wa) ids.push({ type: 'WHATSAPP_PHONE', value: wa, isAnchor: true, source: 'conversation' });
  }
  if (c.channel === 'EMAIL' && c.customerEmail) ids.push({ type: 'EMAIL', value: c.customerEmail, isAnchor: true, source: 'conversation' });
  if (c.channel === 'WIDGET') {
    if (c.widgetVisitorId) ids.push({ type: 'WIDGET_SESSION', value: c.widgetVisitorId, isAnchor: true, source: 'conversation' });
    if (c.widgetVisitorEmail) ids.push({ type: 'EMAIL', value: c.widgetVisitorEmail, isAnchor: false, source: 'widget-typed' }); // typed → attribute
  }
  // Any channel: a sender email we haven't already added, as an anchor (they emailed from it).
  if (c.customerEmail && !ids.some((i) => i.type === 'EMAIL')) ids.push({ type: 'EMAIL', value: c.customerEmail, isAnchor: c.channel === 'EMAIL', source: 'conversation' });
  return ids;
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let cursor = null, processed = 0, linked = 0, skippedNoAnchor = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await prisma.conversation.findMany({
      where: { customerId: null },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE,
      select: {
        id: true, organizationId: true, channel: true, telegramChatId: true, customerName: true,
        customerEmail: true, whatsappUserId: true, whatsappPhoneNumber: true, whatsappProfileName: true,
        widgetVisitorId: true, widgetVisitorEmail: true, createdAt: true, lastMessageAt: true,
      },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const c of batch) {
      processed++;
      const ids = identifiersFor(c);
      if (ids.length === 0) { skippedNoAnchor++; continue; }
      if (dryRun) { linked++; continue; }
      try {
        const customerId = await svc.resolve(c.organizationId, ids, {
          displayName: c.customerName || c.whatsappProfileName || null,
          email: c.customerEmail || c.widgetVisitorEmail || null,
          phone: c.whatsappPhoneNumber || null,
          minLifecycle: 'LEAD',
          seenAt: c.lastMessageAt || c.createdAt,
        });
        await prisma.conversation.update({ where: { id: c.id }, data: { customerId } });
        linked++;
      } catch (e) {
        console.error(`  ! conversation ${c.id}: ${e.message}`);
      }
    }
    process.stdout.write(`\r  processed ${processed} · linked ${linked} · no-anchor ${skippedNoAnchor}`);
  }

  const customers = dryRun ? 0 : await prisma.customer.count();
  console.log(`\n\nDone${dryRun ? ' (DRY RUN)' : ''}. processed ${processed} conversations · linked ${linked} · skipped ${skippedNoAnchor} (no anchor).`);
  if (!dryRun) console.log(`Total customers now: ${customers}.`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
