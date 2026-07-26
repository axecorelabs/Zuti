/**
 * One-time (idempotent) backfill: link existing transactions to their Customer so profiles show
 * purchases/registrations/bookings. Run AFTER `npx nest build`.
 *
 *   node apps/api/scripts/backfill-customer-transactions.js
 *
 * Registration entries link ONLY via their conversation's resolved customer (an attendee's typed
 * email is not the buyer). Single-buyer orders/bookings link via the buyer's own email
 * (anchor-by-necessity). See CUSTOMER_HUB_PLAN.md.
 */
const { PrismaClient } = require('@prisma/client');
const { CustomerIdentityService } = require('../dist/modules/customers/customer-identity.service');
const prisma = new PrismaClient();
const svc = new CustomerIdentityService(prisma);

async function run(label, fetch, orgKey, opts) {
  let linked = 0, skipped = 0, processed = 0;
  const rows = await fetch();
  for (const r of rows) {
    processed++;
    try {
      const customerId = await svc.resolveForTransaction(r[orgKey], opts(r));
      if (customerId) { await r.update(customerId); linked++; } else skipped++;
    } catch (e) { console.error(`  ! ${label} ${r.id}: ${e.message}`); }
  }
  console.log(`${label}: processed ${processed} · linked ${linked} · skipped ${skipped}`);
}

(async () => {
  // Registration entries — conversation-anchored only.
  await run('RegistrationEntry',
    () => prisma.registrationEntry.findMany({ where: { customerId: null }, select: { id: true, orgId: true, conversationId: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ ...r, update: (cid) => prisma.registrationEntry.update({ where: { id: r.id }, data: { customerId: cid } }) }))),
    'orgId',
    (r) => ({ conversationId: r.conversationId, seenAt: r.createdAt, allowEmailAnchor: false }));

  // Sales orders — buyer email anchor.
  await run('SalesOrder',
    () => prisma.salesOrder.findMany({ where: { customerId: null }, select: { id: true, orgId: true, customerEmail: true, customerName: true, customerPhone: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ ...r, update: (cid) => prisma.salesOrder.update({ where: { id: r.id }, data: { customerId: cid } }) }))),
    'orgId',
    (r) => ({ email: r.customerEmail, name: r.customerName, phone: r.customerPhone, seenAt: r.createdAt, allowEmailAnchor: true }));

  // Bookings — buyer email anchor.
  await run('Booking',
    () => prisma.booking.findMany({ where: { customerId: null }, select: { id: true, orgId: true, customerEmail: true, customerName: true, customerPhone: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ ...r, update: (cid) => prisma.booking.update({ where: { id: r.id }, data: { customerId: cid } }) }))),
    'orgId',
    (r) => ({ email: r.customerEmail, name: r.customerName, phone: r.customerPhone, seenAt: r.createdAt, allowEmailAnchor: true }));

  // Commerce orders — buyer email anchor (note: organizationId).
  await run('CommerceOrder',
    () => prisma.commerceOrder.findMany({ where: { customerId: null }, select: { id: true, organizationId: true, customerEmail: true, customerName: true, customerPhone: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ ...r, update: (cid) => prisma.commerceOrder.update({ where: { id: r.id }, data: { customerId: cid } }) }))),
    'organizationId',
    (r) => ({ email: r.customerEmail, name: r.customerName, phone: r.customerPhone, seenAt: r.createdAt, allowEmailAnchor: true }));

  console.log('\nDone.');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
