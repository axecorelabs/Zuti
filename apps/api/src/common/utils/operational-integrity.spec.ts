import {
  buildDeterministicFollowUpMessage,
  buildTruthAwareResponseTemplate,
  sanitizeOperationalClaims,
} from './operational-integrity';

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toContain: (expected: string) => void;
  not: {
    toContain: (expected: string) => void;
  };
};

describe('Operational integrity trust regressions', () => {
  it('sanitizes downstream delivery claims when delivery is unconfirmed', () => {
    const unsafe = 'I have logged your request and our team will reach out shortly.';
    const out = sanitizeOperationalClaims(unsafe, {
      forwardingStatus: 'QUEUED',
      forwardingReason: 'QUEUED_ACTION',
      actionTaskId: 'task_123',
      canClaimCompleted: true,
      deliveryStatus: 'QUEUED_INTERNAL',
    });

    expect(out.toLowerCase()).not.toContain('team will reach out');
    expect(out.toLowerCase()).toContain('cannot confirm downstream delivery');
  });

  it('uses explicit forwarding-disabled messaging in sanitizer', () => {
    const unsafe = 'I can process this request right now.';
    const out = sanitizeOperationalClaims(unsafe, {
      forwardingStatus: 'DISABLED',
      forwardingReason: 'FORWARDING_DISABLED',
      canClaimCompleted: false,
    });

    expect(out).toContain('forwarding is currently disabled');
    expect(out.toLowerCase()).toContain('route you to a human teammate');
  });

  it('returns deterministic blocked response when forwarding is disabled', () => {
    const out = buildDeterministicFollowUpMessage({
      actionType: 'OWNER_ATTENTION_NEEDED',
      forwardingReason: 'FORWARDING_DISABLED',
      blockedCapability: 'FORWARDING',
    });

    expect(out).toContain('forwarding is currently disabled');
  });

  it('returns system-error template for failed/unknown states', () => {
    const out = buildTruthAwareResponseTemplate({
      forwardingStatus: 'FAILED',
      forwardingReason: 'SYSTEM_ERROR',
      canClaimCompleted: false,
    });

    expect(out).toContain('could not verify or complete that action');
  });

  it('returns delivered confirmation only when delivery is explicitly confirmed', () => {
    const out = buildTruthAwareResponseTemplate({
      forwardingStatus: 'QUEUED',
      forwardingReason: 'QUEUED_ACTION',
      canClaimCompleted: true,
      claimLevel: 'DELIVERED_TO_TEAM',
      deliveryStatus: 'DELIVERED_TO_TEAM',
    });

    expect(out).toContain('delivered to our team');
  });
});
