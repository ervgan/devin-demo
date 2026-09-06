import { formatMoney } from './money';
import { requireReason } from './reasons';
import { requireRole } from './roles';
import { all, allow, deny, type RuleResult } from './result';
import { REFUND_STATUS_LABELS, type Actor, type RefundStatus } from './types';

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
 * The single approval decision for a refund. Every caller — the UI button, the
 * message it shows and the service that writes the decision — uses this one
 * result rather than deriving eligibility for itself, so future eligibility
 * rules are added here and nowhere else.
 */
export function canApproveRefund(actor: Actor, snapshot: RefundSnapshot): RuleResult {
  const base = all(
    requireRole(actor, [...REFUND_DECIDER_ROLES], 'decide a refund'),
    requireOpenRefund(snapshot, 'be approved'),
  );
  if (!base.allowed) return base;

  if (snapshot.status === 'approved') {
    return deny(`Refund ${snapshot.refundRef} is already approved and is awaiting settlement.`);
  }

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

/** Whether the actor could ask for more information, ignoring the question. */
export function mayRequestRefundInformation(actor: Actor, snapshot: RefundSnapshot): RuleResult {
  return all(
    requireRole(actor, [...REFUND_DECIDER_ROLES], 'request more information on a refund'),
    requireOpenRefund(snapshot, 'have information requested'),
  );
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
