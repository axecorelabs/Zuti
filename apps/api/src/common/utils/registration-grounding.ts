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
    const requiredFields = fields.filter((f) => f.required).map((f) => f.label);
    const optionalFields = fields.filter((f) => !f.required).map((f) => f.label);

    const parts: string[] = [`- ID: ${p.id} | Name: "${p.name}"`];
    if (p.description) parts.push(`Description: ${p.description}`);
    if (p.eventDate) parts.push(`Date: ${p.eventDate.toISOString().split('T')[0]}`);
    parts.push(p.isFree ? 'Price: Free' : `Price: ${(p.currency ?? 'NGN')} ${((p.priceMinor ?? 0) / 100).toFixed(2)}`);
    if (requiredFields.length > 0) parts.push(`Required info: ${requiredFields.join(', ')}`);
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
    'When a customer wants to register: identify the matching product by name or context, set action_type to REGISTRATION_REQUEST, set registration_product_id to the product ID, and collect the required fields conversationally before classifying.',
  );

  return lines.join('\n');
}
