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
  refundKycBlock,
  requireCustomerKycApproved,
  requiresSecondApproval,
  REQUIRE_KYC_APPROVAL_FLAG,
  SECOND_APPROVER_THRESHOLD_CENTS,
  type RefundApprovalContext,
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

const FLAG_OFF: RefundApprovalContext = { requireKycApproval: false, customerKycStatus: 'in_review' };
const FLAG_ON_KYC_APPROVED: RefundApprovalContext = {
  requireKycApproval: true,
  customerKycStatus: 'approved',
};
const FLAG_ON_KYC_IN_REVIEW: RefundApprovalContext = {
  requireKycApproval: true,
  customerKycStatus: 'in_review',
};

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

describe('requireCustomerKycApproved', () => {
  it('allows any KYC state while the flag is off', () => {
    expect(requireCustomerKycApproved(snapshot(), FLAG_OFF).allowed).toBe(true);
    expect(
      requireCustomerKycApproved(snapshot(), { ...FLAG_OFF, customerKycStatus: 'rejected' }).allowed,
    ).toBe(true);
  });

  it('allows an approved customer while the flag is on', () => {
    expect(requireCustomerKycApproved(snapshot(), FLAG_ON_KYC_APPROVED).allowed).toBe(true);
  });

  it('denies every non-approved KYC state while the flag is on, naming the reason', () => {
    for (const customerKycStatus of ['not_started', 'in_review', 'rejected'] as const) {
      const result = requireCustomerKycApproved(snapshot(), {
        requireKycApproval: true,
        customerKycStatus,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('RFD-5001');
      expect(result.reason).toContain(REQUIRE_KYC_APPROVAL_FLAG);
    }
    expect(requireCustomerKycApproved(snapshot(), FLAG_ON_KYC_IN_REVIEW).reason).toContain(
      "the customer's KYC is in review",
    );
  });
});

describe('refundKycBlock', () => {
  it('is null while the flag is off or the customer is approved', () => {
    expect(refundKycBlock(snapshot(), FLAG_OFF)).toBeNull();
    expect(refundKycBlock(snapshot(), FLAG_ON_KYC_APPROVED)).toBeNull();
  });

  it('returns the same denial canApproveRefund gives when the gate is what blocks', () => {
    const block = refundKycBlock(snapshot(), FLAG_ON_KYC_IN_REVIEW);
    expect(block?.allowed).toBe(false);
    expect(block?.reason).toBe(canApproveRefund(agent, snapshot(), FLAG_ON_KYC_IN_REVIEW).reason);
    expect(refundKycBlock(AWAITING_SECOND, FLAG_ON_KYC_IN_REVIEW)).not.toBeNull();
  });

  it('is null once the refund is approved, settled or rejected', () => {
    for (const status of ['approved', 'settled', 'rejected'] as const) {
      expect(refundKycBlock(snapshot({ status }), FLAG_ON_KYC_IN_REVIEW)).toBeNull();
    }
  });
});

describe('canApproveRefund and the KYC gate', () => {
  it('approves regardless of KYC state when the flag is off', () => {
    expect(canApproveRefund(agent, snapshot(), FLAG_OFF).allowed).toBe(true);
    expect(
      canApproveRefund(analyst, snapshot(), { ...FLAG_OFF, customerKycStatus: 'rejected' }).allowed,
    ).toBe(true);
  });

  it('approves when the flag is on and the customer KYC is approved', () => {
    expect(canApproveRefund(agent, snapshot(), FLAG_ON_KYC_APPROVED).allowed).toBe(true);
  });

  it('denies when the flag is on and the customer KYC is not approved', () => {
    const result = canApproveRefund(agent, snapshot(), FLAG_ON_KYC_IN_REVIEW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot be approved');
    expect(result.reason).toContain("the customer's KYC is in review");
  });

  it('gates second approvals too', () => {
    expect(canApproveRefund(otherAnalyst, AWAITING_SECOND, FLAG_ON_KYC_IN_REVIEW).allowed).toBe(false);
    expect(canApproveRefund(otherAnalyst, AWAITING_SECOND, FLAG_ON_KYC_APPROVED).allowed).toBe(true);
  });

  it('reports the role denial before the KYC gate', () => {
    expect(canApproveRefund(engineer, snapshot(), FLAG_ON_KYC_IN_REVIEW).reason).toContain(
      'Engineer may not',
    );
  });
});

describe('canApproveRefund', () => {
  it('allows a support agent to approve a refund below the threshold', () => {
    const result = canApproveRefund(agent, snapshot(), FLAG_OFF);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('RFD-5001');
  });

  it('allows a compliance analyst to approve', () => {
    expect(canApproveRefund(analyst, snapshot(), FLAG_OFF).allowed).toBe(true);
  });

  it('denies anyone who is not a support agent or compliance analyst', () => {
    const result = canApproveRefund(engineer, snapshot(), FLAG_OFF);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Engineer may not');
  });

  it('denies a refund that is already settled or rejected', () => {
    expect(canApproveRefund(analyst, snapshot({ status: 'settled' }), FLAG_OFF).allowed).toBe(false);
    expect(canApproveRefund(analyst, snapshot({ status: 'rejected' }), FLAG_OFF).allowed).toBe(false);
  });

  it('denies a refund that is already approved', () => {
    const result = canApproveRefund(analyst, snapshot({ status: 'approved' }), FLAG_OFF);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already approved');
  });

  it('allows the first of two approvals above the threshold and says so', () => {
    const result = canApproveRefund(analyst, HIGH_VALUE, FLAG_OFF);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('first of two approvals');
  });

  it('allows a different approver to complete the second approval', () => {
    const result = canApproveRefund(otherAnalyst, AWAITING_SECOND, FLAG_OFF);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('second approval');
  });

  it('denies the original approver completing their own second approval', () => {
    const result = canApproveRefund(analyst, AWAITING_SECOND, FLAG_OFF);
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
  it('allows the second approver of a refund awaiting its second approval', () => {
    expect(mayRequestRefundInformation(otherAnalyst, AWAITING_SECOND).allowed).toBe(true);
  });

  it('denies the approver who recorded the first approval', () => {
    expect(mayRequestRefundInformation(analyst, AWAITING_SECOND).allowed).toBe(false);
  });

  it('denies a refund below the second-approver threshold', () => {
    expect(mayRequestRefundInformation(agent, snapshot()).allowed).toBe(false);
  });

  it('denies a high-value refund with no first approval yet', () => {
    expect(mayRequestRefundInformation(agent, HIGH_VALUE).allowed).toBe(false);
  });

  it('denies a decided refund', () => {
    expect(
      mayRequestRefundInformation(otherAnalyst, snapshot({ ...AWAITING_SECOND, status: 'rejected' }))
        .allowed,
    ).toBe(false);
  });
});

describe('canRequestRefundInformation', () => {
  it('allows a second approver who says what is needed', () => {
    expect(canRequestRefundInformation(otherAnalyst, AWAITING_SECOND, REASON).allowed).toBe(true);
  });

  it('denies an empty request', () => {
    expect(canRequestRefundInformation(otherAnalyst, AWAITING_SECOND, ' ').allowed).toBe(false);
  });

  it('denies the wrong role', () => {
    expect(canRequestRefundInformation(engineer, AWAITING_SECOND, REASON).allowed).toBe(false);
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
