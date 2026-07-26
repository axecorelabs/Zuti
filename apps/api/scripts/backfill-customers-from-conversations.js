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

// Anchor extraction + resolve + link all live in CustomerIdentityService (identifiersForConversation /
// linkConversation) so this backfill and the live ingest wiring never drift apart.

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
      if (dryRun) {
        if (svc.identifiersForConversation(c).length > 0) linked++; else skippedNoAnchor++;
        continue;
      }
      try {
        const customerId = await svc.linkConversation(c); // resolves + sets conversation.customerId
        if (customerId) linked++; else skippedNoAnchor++;
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
