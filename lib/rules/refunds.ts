import { formatMoney } from './money';
import { requireReason } from './reasons';
import { requireRole } from './roles';
import { all, allow, deny, type RuleResult } from './result';
import {
  KYC_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  type Actor,
  type KycStatus,
  type RefundStatus,
} from './types';

/**
 * Refunds at or above this value need a second approver, and that approver must
 * be a different person from the one who approved first. Minor units.
 */
export const SECOND_APPROVER_THRESHOLD_CENTS = 100_000;

/** The part of a refund that determines how many approvals it still needs. */
export interface RefundApprovalState {
  status: RefundStatus;
  amountCents: number;
  firstApproverId: string | null;
  secondApproverId: string | null;
}

/** The projection of a refund the rules need. Deliberately not a database row. */
export interface RefundSnapshot extends RefundApprovalState {
  refundRef: string;
  currency: string;
  requestedById: string;
}

/** When on, a refund may only be approved for a customer whose KYC case is approved. */
export const REQUIRE_KYC_APPROVAL_FLAG = 'refunds.require_kyc_approval';

/**
 * What the approval decision needs beyond the refund itself: the flag value in
 * the running environment and the customer's KYC position. Loaded by the caller
 * and passed in, so the rule stays pure and the refunds module never reads the
 * flags table itself.
 */
export interface RefundApprovalContext {
  requireKycApproval: boolean;
  customerKycStatus: KycStatus;
}

/** Roles that may decide a refund at all. */
const REFUND_DECIDER_ROLES = ['support_agent', 'compliance_analyst'] as const;

/** A decided-and-closed refund is immutable. */
export function isTerminalRefundStatus(status: RefundStatus): boolean {
  return status === 'settled' || status === 'rejected';
}

export function requiresSecondApproval(snapshot: RefundApprovalState): boolean {
  return snapshot.amountCents >= SECOND_APPROVER_THRESHOLD_CENTS;
}

/** One approval is recorded, the value needs two, and nobody has completed it. */
export function isAwaitingSecondApproval(snapshot: RefundApprovalState): boolean {
  return (
    requiresSecondApproval(snapshot) &&
    snapshot.firstApproverId !== null &&
    snapshot.secondApproverId === null &&
    !isTerminalRefundStatus(snapshot.status) &&
    snapshot.status !== 'approved'
  );
}

function requireOpenRefund(snapshot: RefundSnapshot, activity: string): RuleResult {
  if (isTerminalRefundStatus(snapshot.status)) {
    return deny(
      `Refund ${snapshot.refundRef} is ${REFUND_STATUS_LABELS[snapshot.status].toLowerCase()} and can no longer ${activity}.`,
    );
  }
  return allow(`Refund ${snapshot.refundRef} is open.`);
}

/**
 * The KYC gate on approval. Derived on every read, never stored: the refund
 * keeps its own status, and a blocked refund unblocks the moment the customer's
 * case is approved or the flag is turned off. The list badge, the detail banner
 * and the approval denial all render this one reason.
 */
export function requireCustomerKycApproved(
  snapshot: RefundSnapshot,
  context: RefundApprovalContext,
): RuleResult {
  if (!context.requireKycApproval) {
    return allow(`${REQUIRE_KYC_APPROVAL_FLAG} is off; KYC does not gate refund approval.`);
  }
  if (context.customerKycStatus !== 'approved') {
    return deny(
      `Refund ${snapshot.refundRef} cannot be approved: the customer's KYC is ${KYC_STATUS_LABELS[context.customerKycStatus].toLowerCase()}, and ${REQUIRE_KYC_APPROVAL_FLAG} requires an approved KYC case.`,
    );
  }
  return allow(`The customer's KYC is approved.`);
}

/**
 * The KYC denial when the refund is still decidable and the gate is what stops
 * approval; null otherwise. Callers render its reason as the blocked banner.
 */
export function refundKycBlock(
  snapshot: RefundSnapshot,
  context: RefundApprovalContext,
): RuleResult | null {
  if (isTerminalRefundStatus(snapshot.status) || snapshot.status === 'approved') return null;
  const gate = requireCustomerKycApproved(snapshot, context);
  return gate.allowed ? null : gate;
}

/**
 * The single approval decision for a refund. Every caller — the UI button, the
 * message it shows and the service that writes the decision — uses this one
 * result rather than deriving eligibility for itself, so future eligibility
 * rules are added here and nowhere else.
 */
export function canApproveRefund(
  actor: Actor,
  snapshot: RefundSnapshot,
  context: RefundApprovalContext,
): RuleResult {
  const base = all(
    requireRole(actor, [...REFUND_DECIDER_ROLES], 'decide a refund'),
    requireOpenRefund(snapshot, 'be approved'),
  );
  if (!base.allowed) return base;

  if (snapshot.status === 'approved') {
    return deny(`Refund ${snapshot.refundRef} is already approved and is awaiting settlement.`);
  }

  const kycGate = requireCustomerKycApproved(snapshot, context);
  if (!kycGate.allowed) return kycGate;

  if (isAwaitingSecondApproval(snapshot) && actor.id === snapshot.firstApproverId) {
    return deny(
      `You recorded the first approval on ${snapshot.refundRef}; a different approver must complete it.`,
    );
  }

  if (isAwaitingSecondApproval(snapshot)) {
    return allow(`Refund ${snapshot.refundRef} may be given its second approval.`);
  }

  if (requiresSecondApproval(snapshot)) {
    return allow(
      `Refund ${snapshot.refundRef} is above ${formatMoney(SECOND_APPROVER_THRESHOLD_CENTS, snapshot.currency)}, so this records the first of two approvals.`,
    );
  }

  return allow(`Refund ${snapshot.refundRef} may be approved.`);
}

/** Whether the actor could reject the refund, ignoring the reason. */
export function mayRejectRefund(actor: Actor, snapshot: RefundSnapshot): RuleResult {
  return all(
    requireRole(actor, [...REFUND_DECIDER_ROLES], 'decide a refund'),
    requireOpenRefund(snapshot, 'be rejected'),
  );
}

export function canRejectRefund(
  actor: Actor,
  snapshot: RefundSnapshot,
  reason: string | null | undefined,
): RuleResult {
  return all(mayRejectRefund(actor, snapshot), requireReason(reason, 'reject the refund'));
}

/**
 * Whether the actor could ask for more information, ignoring the question.
 * Only the second approver of a refund that needs two approvals may ask: the
 * request exists so the person completing a high-value approval can challenge
 * it, so the first approver cannot raise it against their own approval.
 */
export function mayRequestRefundInformation(actor: Actor, snapshot: RefundSnapshot): RuleResult {
  const base = all(
    requireRole(actor, [...REFUND_DECIDER_ROLES], 'request more information on a refund'),
    requireOpenRefund(snapshot, 'have information requested'),
  );
  if (!base.allowed) return base;

  if (!requiresSecondApproval(snapshot)) {
    return deny(
      `Refund ${snapshot.refundRef} is below ${formatMoney(SECOND_APPROVER_THRESHOLD_CENTS, snapshot.currency)}, so it takes a single approval and has no second approver to ask.`,
    );
  }

  if (!isAwaitingSecondApproval(snapshot)) {
    return deny(
      `Refund ${snapshot.refundRef} is not awaiting a second approval, so there is no second approver to request information.`,
    );
  }

  if (actor.id === snapshot.firstApproverId) {
    return deny(
      `You recorded the first approval on ${snapshot.refundRef}; only the second approver may request more information.`,
    );
  }

  return allow(`Refund ${snapshot.refundRef} may have more information requested before its second approval.`);
}

export function canRequestRefundInformation(
  actor: Actor,
  snapshot: RefundSnapshot,
  reason: string | null | undefined,
): RuleResult {
  return all(
    mayRequestRefundInformation(actor, snapshot),
    requireReason(reason, 'request more information'),
  );
}

/** Whether the actor could annotate the refund, ignoring the note itself. */
export function mayAddRefundNote(actor: Actor): RuleResult {
  return requireRole(actor, [...REFUND_DECIDER_ROLES], 'add an internal note to a refund');
}

export function canAddRefundNote(actor: Actor, note: string | null | undefined): RuleResult {
  return all(mayAddRefundNote(actor), requireReason(note, 'add an internal note'));
}
