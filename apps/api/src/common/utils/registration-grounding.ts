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

    const entryCount = await params.prisma.registrationEntry.count({
      where: { productId: p.id, status: { not: 'CANCELLED' } },
    });
    if (p.capacity !== null) {
      const remaining = p.capacity - entryCount;
      if (remaining <= 0) {
        parts.push('Status: FULL — do not accept new registrations for this product');
      } else {
        parts.push(`Capacity: ${remaining} spot(s) remaining`);
      }
    }

    lines.push(parts.join(' | '));
  }

  lines.push(
    'When a customer wants to register: identify the matching product, set action_type to REGISTRATION_REQUEST and registration_product_id to that product\'s ID, and gather the required fields conversationally. On every registration turn, put everything gathered so far into collected_fields using each field\'s exact key shown above (e.g. customer_name, customer_email). Ask only for the fields still missing. Once all required fields are present, the registration and any payment are finalized automatically by the system — so you may confirm to the customer that they are registered.',
  );

  return lines.join('\n');
}
