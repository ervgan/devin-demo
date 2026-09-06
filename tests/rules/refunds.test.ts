import { describe, expect, it } from 'vitest';
import {
  canAddRefundNote,
  canApproveRefund,
  canRejectRefund,
  canRequestRefundInformation,
  isAwaitingSecondApproval,
  isTerminalRefundStatus,
  mayAddRefundNote,
  mayRejectRefund,
  mayRequestRefundInformation,
  requiresSecondApproval,
  SECOND_APPROVER_THRESHOLD_CENTS,
  type RefundSnapshot,
} from '@/lib/rules/refunds';
import { formatMoney } from '@/lib/rules/money';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const otherAnalyst: Actor = { id: 'usr_l', name: 'Liu Chen', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };

const REASON = 'The acquirer already recovered this amount.';

function snapshot(overrides: Partial<RefundSnapshot> = {}): RefundSnapshot {
  return {
    refundRef: 'RFD-5001',
    status: 'requested',
    amountCents: 2450,
    currency: 'EUR',
    requestedById: agent.id,
    firstApproverId: null,
    secondApproverId: null,
    ...overrides,
  };
}

const HIGH_VALUE = snapshot({ refundRef: 'RFD-5004', amountCents: 640_000 });
const AWAITING_SECOND = snapshot({
  refundRef: 'RFD-5004',
  amountCents: 640_000,
  status: 'under_review',
  firstApproverId: analyst.id,
});

describe('formatMoney', () => {
  it('renders minor units as a currency amount', () => {
    expect(formatMoney(640_000, 'EUR')).toBe('€6,400.00');
  });
});

describe('isTerminalRefundStatus', () => {
  it('is true once a refund is settled or rejected', () => {
    expect(isTerminalRefundStatus('settled')).toBe(true);
    expect(isTerminalRefundStatus('rejected')).toBe(true);
  });

  it('is false while the refund is still in flight', () => {
    expect(isTerminalRefundStatus('requested')).toBe(false);
    expect(isTerminalRefundStatus('under_review')).toBe(false);
    expect(isTerminalRefundStatus('approved')).toBe(false);
  });
});

describe('requiresSecondApproval', () => {
  it('is true at and above the threshold', () => {
    expect(requiresSecondApproval(snapshot({ amountCents: SECOND_APPROVER_THRESHOLD_CENTS }))).toBe(
      true,
    );
  });

  it('is false below the threshold', () => {
    expect(
      requiresSecondApproval(snapshot({ amountCents: SECOND_APPROVER_THRESHOLD_CENTS - 1 })),
    ).toBe(false);
  });
});

describe('isAwaitingSecondApproval', () => {
  it('is true once one approver has signed a high-value refund', () => {
    expect(isAwaitingSecondApproval(AWAITING_SECOND)).toBe(true);
  });

  it('is false for low-value refunds and for completed second approvals', () => {
    expect(isAwaitingSecondApproval(snapshot({ firstApproverId: analyst.id }))).toBe(false);
    expect(
      isAwaitingSecondApproval({ ...AWAITING_SECOND, secondApproverId: otherAnalyst.id }),
    ).toBe(false);
  });
});

describe('canApproveRefund', () => {
  it('allows a support agent to approve a refund below the threshold', () => {
    const result = canApproveRefund(agent, snapshot());
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('RFD-5001');
  });

  it('allows a compliance analyst to approve', () => {
    expect(canApproveRefund(analyst, snapshot()).allowed).toBe(true);
  });

  it('denies anyone who is not a support agent or compliance analyst', () => {
    const result = canApproveRefund(engineer, snapshot());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Engineer may not');
  });

  it('denies a refund that is already settled or rejected', () => {
    expect(canApproveRefund(analyst, snapshot({ status: 'settled' })).allowed).toBe(false);
    expect(canApproveRefund(analyst, snapshot({ status: 'rejected' })).allowed).toBe(false);
  });

  it('denies a refund that is already approved', () => {
    const result = canApproveRefund(analyst, snapshot({ status: 'approved' }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already approved');
  });

  it('allows the first of two approvals above the threshold and says so', () => {
    const result = canApproveRefund(analyst, HIGH_VALUE);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('first of two approvals');
  });

  it('allows a different approver to complete the second approval', () => {
    const result = canApproveRefund(otherAnalyst, AWAITING_SECOND);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('second approval');
  });

  it('denies the original approver completing their own second approval', () => {
    const result = canApproveRefund(analyst, AWAITING_SECOND);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('a different approver must complete it');
  });
});

describe('mayRejectRefund', () => {
  it('allows a decider on an open refund', () => {
    expect(mayRejectRefund(agent, snapshot()).allowed).toBe(true);
  });

  it('denies a decided refund', () => {
    expect(mayRejectRefund(agent, snapshot({ status: 'settled' })).allowed).toBe(false);
  });
});

describe('canRejectRefund', () => {
  it('allows a decider who gives a reason', () => {
    expect(canRejectRefund(analyst, snapshot(), REASON).allowed).toBe(true);
  });

  it('denies a missing or too-short reason', () => {
    expect(canRejectRefund(analyst, snapshot(), '').allowed).toBe(false);
    expect(canRejectRefund(analyst, snapshot(), 'no').allowed).toBe(false);
  });

  it('denies the wrong role even with a reason', () => {
    expect(canRejectRefund(engineer, snapshot(), REASON).allowed).toBe(false);
  });
});

describe('mayRequestRefundInformation', () => {
  it('allows a decider on an open refund', () => {
    expect(mayRequestRefundInformation(agent, snapshot()).allowed).toBe(true);
  });

  it('denies a decided refund', () => {
    expect(mayRequestRefundInformation(agent, snapshot({ status: 'rejected' })).allowed).toBe(
      false,
    );
  });
});

describe('canRequestRefundInformation', () => {
  it('allows a decider who says what is needed', () => {
    expect(canRequestRefundInformation(agent, snapshot(), REASON).allowed).toBe(true);
  });

  it('denies an empty request', () => {
    expect(canRequestRefundInformation(agent, snapshot(), ' ').allowed).toBe(false);
  });

  it('denies the wrong role', () => {
    expect(canRequestRefundInformation(engineer, snapshot(), REASON).allowed).toBe(false);
  });
});

describe('mayAddRefundNote', () => {
  it('allows a decider', () => {
    expect(mayAddRefundNote(analyst).allowed).toBe(true);
  });

  it('denies anyone else', () => {
    expect(mayAddRefundNote(engineer).allowed).toBe(false);
  });
});

describe('canAddRefundNote', () => {
  it('allows a note with content', () => {
    expect(canAddRefundNote(agent, 'Customer called to chase this.').allowed).toBe(true);
  });

  it('denies an empty note', () => {
    expect(canAddRefundNote(agent, '').allowed).toBe(false);
  });
});
