import { and, eq, isNull } from 'drizzle-orm';
import { recordAuditEntriesSync } from '@/lib/audit';
import type { AppDatabase } from '@/lib/db/client';
import { customers, refundEvents, refundRequests } from '@/lib/db/schema';
import {
  canAddRefundNote,
  canApproveRefund,
  canRejectRefund,
  canRequestRefundInformation,
  deny,
  isAwaitingSecondApproval,
  requiresSecondApproval,
  type RefundApprovalContext,
  type RefundSnapshot,
  type RuleResult,
} from '@/lib/rules';
import { loadRefundApprovalContext, REFUND_ENTITY_TYPE } from './queries';
import type { Actor, RefundEventType, RefundStatus } from '@/lib/rules/types';

/**
 * Applies refund decisions. Every decision here is delegated to lib/rules; this
 * module only loads state, persists the outcome and writes the audit entry.
 */

interface LoadedRefund {
  id: string;
  modifiedAt: Date;
  snapshot: RefundSnapshot;
  approvalContext: RefundApprovalContext;
}

async function loadRefund(db: AppDatabase, refundId: string): Promise<LoadedRefund | null> {
  const [found] = await db
    .select({ refund: refundRequests, customerKycStatus: customers.kycStatus })
    .from(refundRequests)
    .innerJoin(customers, eq(refundRequests.customerId, customers.id))
    .where(eq(refundRequests.id, refundId))
    .limit(1);
  if (!found) return null;
  const row = found.refund;

  return {
    id: row.id,
    modifiedAt: row.modifiedAt,
    approvalContext: await loadRefundApprovalContext(db, found.customerKycStatus),
    snapshot: {
      refundRef: row.refundRef,
      status: row.status,
      amountCents: row.amountCents,
      currency: row.currency,
      requestedById: row.requestedById,
      firstApproverId: row.firstApproverId,
      secondApproverId: row.secondApproverId,
    },
  };
}

interface RefundWrite {
  patch: Partial<{
    status: RefundStatus;
    firstApproverId: string | null;
    secondApproverId: string | null;
    rejectionReason: string | null;
  }>;
  eventType: RefundEventType;
  note: string | null;
  action: string;
}

const REFUND_NOT_FOUND = 'Refund not found.';
const REFUND_CHANGED =
  'This refund changed while you were working on it. Reload the refund and try again.';

/**
 * Persists a decision. The refund row is updated only while it still matches
 * the state the rule was evaluated against, and refund, timeline and audit
 * writes share one transaction so a failure leaves no partial history.
 */
function applyDecision(
  db: AppDatabase,
  actor: Actor,
  loaded: LoadedRefund,
  write: RefundWrite,
  decision: RuleResult,
): RuleResult {
  return db.transaction((tx) => {
    const now = new Date();
    const before = {
      status: loaded.snapshot.status,
      firstApproverId: loaded.snapshot.firstApproverId,
      secondApproverId: loaded.snapshot.secondApproverId,
    };

    const unchanged = and(
      eq(refundRequests.id, loaded.id),
      eq(refundRequests.status, loaded.snapshot.status),
      eq(refundRequests.modifiedAt, loaded.modifiedAt),
      loaded.snapshot.firstApproverId === null
        ? isNull(refundRequests.firstApproverId)
        : eq(refundRequests.firstApproverId, loaded.snapshot.firstApproverId),
    );

    const updated = tx
      .update(refundRequests)
      .set({ ...write.patch, modifiedAt: now })
      .where(unchanged)
      .run();

    if (updated.changes === 0) return deny(REFUND_CHANGED);

    tx.insert(refundEvents)
      .values({
        id: `rev_${crypto.randomUUID()}`,
        refundId: loaded.id,
        actorId: actor.id,
        type: write.eventType,
        fromStatus: loaded.snapshot.status,
        toStatus: write.patch.status ?? null,
        note: write.note,
        createdAt: now,
      })
      .run();

    recordAuditEntriesSync(tx, [
      {
        actor,
        action: write.action,
        entityType: REFUND_ENTITY_TYPE,
        entityId: loaded.id,
        before,
        after: { ...before, ...write.patch },
        at: now,
      },
    ]);

    return decision;
  });
}

/**
 * Approves a refund, or records the first of the two approvals a high-value
 * refund needs. Eligibility comes from canApproveRefund and nowhere else.
 */
export async function approveRefund(
  db: AppDatabase,
  actor: Actor,
  refundId: string,
): Promise<RuleResult> {
  const loaded = await loadRefund(db, refundId);
  if (!loaded) return deny(REFUND_NOT_FOUND);

  const decision = canApproveRefund(actor, loaded.snapshot, loaded.approvalContext);
  if (!decision.allowed) return decision;

  const secondApprovalOutstanding = isAwaitingSecondApproval(loaded.snapshot);

  if (requiresSecondApproval(loaded.snapshot) && !secondApprovalOutstanding) {
    return applyDecision(
      db,
      actor,
      loaded,
      {
        patch: { status: 'under_review', firstApproverId: actor.id },
        eventType: 'first_approval_recorded',
        note: 'First approval recorded; a second approver must complete it.',
        action: 'refund.first_approval_recorded',
      },
      decision,
    );
  }

  return applyDecision(
    db,
    actor,
    loaded,
    {
      patch: {
        status: 'approved',
        ...(secondApprovalOutstanding
          ? { secondApproverId: actor.id }
          : { firstApproverId: actor.id }),
      },
      eventType: 'refund_approved',
      note: null,
      action: 'refund.approved',
    },
    decision,
  );
}

export async function rejectRefund(
  db: AppDatabase,
  actor: Actor,
  refundId: string,
  reason: string,
): Promise<RuleResult> {
  const loaded = await loadRefund(db, refundId);
  if (!loaded) return deny(REFUND_NOT_FOUND);

  const decision = canRejectRefund(actor, loaded.snapshot, reason);
  if (!decision.allowed) return decision;

  return applyDecision(
    db,
    actor,
    loaded,
    {
      patch: { status: 'rejected', rejectionReason: reason.trim() },
      eventType: 'refund_rejected',
      note: reason.trim(),
      action: 'refund.rejected',
    },
    decision,
  );
}

export async function requestRefundInformation(
  db: AppDatabase,
  actor: Actor,
  refundId: string,
  reason: string,
): Promise<RuleResult> {
  const loaded = await loadRefund(db, refundId);
  if (!loaded) return deny(REFUND_NOT_FOUND);

  const decision = canRequestRefundInformation(actor, loaded.snapshot, reason);
  if (!decision.allowed) return decision;

  return applyDecision(
    db,
    actor,
    loaded,
    {
      patch: { status: 'under_review' },
      eventType: 'information_requested',
      note: reason.trim(),
      action: 'refund.information_requested',
    },
    decision,
  );
}

export async function addRefundNote(
  db: AppDatabase,
  actor: Actor,
  refundId: string,
  note: string,
): Promise<RuleResult> {
  const loaded = await loadRefund(db, refundId);
  if (!loaded) return deny(REFUND_NOT_FOUND);

  const decision = canAddRefundNote(actor, note);
  if (!decision.allowed) return decision;

  return applyDecision(
    db,
    actor,
    loaded,
    {
      patch: {},
      eventType: 'note_added',
      note: note.trim(),
      action: 'refund.note_added',
    },
    decision,
  );
}
