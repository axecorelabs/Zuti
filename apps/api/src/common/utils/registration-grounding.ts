import { PrismaService } from '../../modules/prisma/prisma.service';

type RegistrationProductField = { key: string; label: string; required: boolean };

export async function buildRegistrationContextBlock(params: {
  prisma: PrismaService;
  botId: string;
  orgId: string;
}): Promise<string | null> {
  const products = await params.prisma.registrationProduct.findMany({
    // botId is null for events created with "— Any bot —" — an exact-equality filter would
    // exclude those from every bot's context, so org-wide events must be OR'd in explicitly.
    where: { orgId: params.orgId, isActive: true, OR: [{ botId: params.botId }, { botId: null }] },
    orderBy: { createdAt: 'asc' },
  });
  if (products.length === 0) return null;

  const lines: string[] = [
    'Available registration products (use these when a customer expresses interest in registering, signing up, or booking a slot):',
  ];

  for (const p of products) {
    const fields = (Array.isArray(p.fields) ? p.fields : []) as RegistrationProductField[];
    // The base contract always requires name + email; product custom fields come after.
    // Expose the exact field KEY next to each label so the AI keys collected_fields correctly.
    const describeField = (label: string, key: string) => `${label} (key: ${key})`;
    const requiredFields = [
      describeField('Full name', 'customer_name'),
      describeField('Email address', 'customer_email'),
      ...fields.filter((f) => f.required).map((f) => describeField(f.label, f.key)),
    ];
    const optionalFields = fields.filter((f) => !f.required).map((f) => describeField(f.label, f.key));

    const parts: string[] = [`- ID: ${p.id} | Name: "${p.name}"`];
    if (p.description) parts.push(`Description: ${p.description}`);
    if (p.eventDate) parts.push(`Date: ${p.eventDate.toISOString().split('T')[0]}`);
    parts.push(p.isFree ? 'Price: Free' : `Price: ${(p.currency ?? 'NGN')} ${((p.priceMinor ?? 0) / 100).toFixed(2)}`);
    parts.push(`Required info (collect all before confirming): ${requiredFields.join(', ')}`);
    if (optionalFields.length > 0) parts.push(`Optional info: ${optionalFields.join(', ')}`);

    // Spots used = sum of ticket quantities across non-cancelled entries (not a row count).
    const usedAgg = await params.prisma.registrationEntry.aggregate({
      where: { productId: p.id, status: { not: 'CANCELLED' } },
      _sum: { quantity: true },
    });
    const usedSpots = usedAgg._sum.quantity ?? 0;
    if (p.capacity !== null) {
      const remaining = p.capacity - usedSpots;
      if (remaining <= 0) {
        parts.push('Status: FULL — do not accept new registrations for this product');
      } else {
        parts.push(`Capacity: ${remaining} spot(s) remaining`);
      }
    }

    lines.push(parts.join(' | '));
  }

  lines.push(
    'When a customer wants to register: identify the matching product, set action_type to REGISTRATION_REQUEST and registration_product_id to that product\'s ID, and gather the required fields conversationally. On every registration turn, put everything gathered so far into collected_fields using each field\'s exact key shown above (e.g. customer_name, customer_email). Ask only for the fields still missing.',
  );
  lines.push(
    'Once all required fields are present, completion depends on the product price:',
  );
  lines.push(
    '- FREE product: the registration is finalized automatically — you may confirm the customer is registered and ask if they need anything else.',
  );
  lines.push(
    '- PAID product: DO NOT say the customer is registered, confirmed, or complete, and DO NOT ask "is there anything else" — payment is still required. Instead say you have all their details and a secure payment link will follow (or has just been sent) which they must complete to finalize the registration. The system sends the payment link automatically; you only need to set the fields.',
  );
  lines.push(
    'Ticket quantity: if the customer wants more than one ticket/spot (e.g. "3 tickets", "me and 2 friends"), set collected_fields.quantity to that number (default 1). For paid products the total charged is the price × quantity, and each ticket consumes one capacity spot.',
  );
  lines.push(
    'The system enforces capacity and prevents duplicate registrations, and will append an authoritative notice if the event is full or the customer is already registered — so do not fabricate confirmations; state what you have collected and let the system finalize.',
  );

  return lines.join('\n');
}
