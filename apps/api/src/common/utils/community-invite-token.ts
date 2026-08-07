// Encodes the payload for a Telegram bot deep-link (t.me/<bot>?start=<token>) used to invite a
// ticket buyer into a Community. Deliberately unsigned — worst case of a forged token is someone
// joining a public-ish community channel they didn't buy a ticket for, which the chat_member
// webhook still records honestly (sourceRegistrationEntryId just won't resolve to a real entry).
// Telegram start-param payloads must match ^[A-Za-z0-9_-]+$ and be under 64 chars.

interface CommunityInviteTokenPayload {
  communityId: string;
  registrationEntryId: string | null;
}

export function encodeCommunityInviteToken(payload: CommunityInviteTokenPayload): string {
  const raw = `${payload.communityId}.${payload.registrationEntryId ?? ''}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCommunityInviteToken(token: string): CommunityInviteTokenPayload | null {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [communityId, registrationEntryId] = raw.split('.');
    if (!communityId) return null;
    return { communityId, registrationEntryId: registrationEntryId || null };
  } catch {
    return null;
  }
}
