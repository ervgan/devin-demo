import { and, eq, isNull } from 'drizzle-orm';
import { recordAuditEntriesSync } from '@/lib/audit';
import type { AppDatabase } from '@/lib/db/client';
import { customers, kycCaseEvents, kycCases, kycDocuments, users } from '@/lib/db/schema';
import {
  canAdvanceStage,
  canApproveCase,
  canAssignReviewer,
  canRejectCase,
  canRequestInformation,
  canVerifyDocument,
  deny,
  nextStage,
  type CaseSnapshot,
  type RuleResult,
} from '@/lib/rules';
import { toActor } from '@/lib/actors';
import type { Actor, CaseEventType, CaseStage } from '@/lib/rules/types';

/**
 * Applies KYC transitions. Every decision here is delegated to lib/rules; this
 * module only loads state, persists the outcome and writes the audit entry.
 */

interface LoadedCase {
  id: string;
  customerId: string;
  stage: CaseStage;
  assignedReviewerId: string | null;
  modifiedAt: Date;
  snapshot: CaseSnapshot;
}

async function loadCase(db: AppDatabase, caseId: string): Promise<LoadedCase | null> {
  const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
  if (!row) return null;

  const documents = await db
    .select({ documentType: kycDocuments.documentType, status: kycDocuments.status })
    .from(kycDocuments)
    .where(eq(kycDocuments.caseId, caseId));

  return {
    id: row.id,
    customerId: row.customerId,
    stage: row.stage,
    assignedReviewerId: row.assignedReviewerId,
    modifiedAt: row.modifiedAt,
    snapshot: {
      caseRef: row.caseRef,
      stage: row.stage,
      riskRating: row.riskRating,
      assignedReviewerId: row.assignedReviewerId,
      documents,
    },
  };
}

interface TransitionWrite {
  patch: Partial<{
    stage: CaseStage;
    assignedReviewerId: string | null;
    decisionReason: string | null;
  }>;
  eventType: CaseEventType;
  note: string | null;
  action: string;
}

const CASE_NOT_FOUND = 'Case not found.';
const CASE_CHANGED =
  'This case changed while you were working on it. Reload the case and try again.';

/**
 * Persists a transition. The case row is updated only while it still matches
 * the state the rule was evaluated against, and case, customer, timeline and
 * audit writes share one transaction so a failure leaves no partial history.
 */
function applyTransition(
  db: AppDatabase,
  actor: Actor,
  loaded: LoadedCase,
  write: TransitionWrite,
  decision: RuleResult,
): RuleResult {
  return db.transaction((tx) => {
    const now = new Date();
    const before = {
      stage: loaded.stage,
      assignedReviewerId: loaded.assignedReviewerId,
    };

    const unchanged = and(
      eq(kycCases.id, loaded.id),
      eq(kycCases.stage, loaded.stage),
      eq(kycCases.modifiedAt, loaded.modifiedAt),
      loaded.assignedReviewerId === null
        ? isNull(kycCases.assignedReviewerId)
        : eq(kycCases.assignedReviewerId, loaded.assignedReviewerId),
    );

    const updated = tx
      .update(kycCases)
      .set({ ...write.patch, modifiedAt: now })
      .where(unchanged)
      .run();

    if (updated.changes === 0) return deny(CASE_CHANGED);

    if (write.patch.stage === 'approved' || write.patch.stage === 'rejected') {
      tx.update(customers)
        .set({ kycStatus: write.patch.stage })
        .where(eq(customers.id, loaded.customerId))
        .run();
    }

    tx.insert(kycCaseEvents)
      .values({
        id: `evt_${crypto.randomUUID()}`,
        caseId: loaded.id,
        actorId: actor.id,
        type: write.eventType,
        fromStage: loaded.stage,
        toStage: write.patch.stage ?? null,
        note: write.note,
        createdAt: now,
      })
      .run();

    recordAuditEntriesSync(tx, [
      {
        actor,
        action: write.action,
        entityType: 'kyc_case',
        entityId: loaded.id,
        before,
        after: { ...before, ...write.patch },
        at: now,
      },
    ]);

    return decision;
  });
}

export async function advanceCase(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const decision = canAdvanceStage(actor, loaded.snapshot);
  if (!decision.allowed) return decision;

  const target = nextStage(loaded.stage);
  if (target === null) return deny(CASE_NOT_FOUND);

  return applyTransition(
    db,
    actor,
    loaded,
    {
      patch: { stage: target },
      eventType: 'stage_advanced',
      note: null,
      action: 'kyc.case.advanced',
    },
    decision,
  );
}

export async function requestInformation(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
  reason: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const decision = canRequestInformation(actor, loaded.snapshot, reason);
  if (!decision.allowed) return decision;

  return applyTransition(
    db,
    actor,
    loaded,
    {
      patch: {},
      eventType: 'information_requested',
      note: reason.trim(),
      action: 'kyc.case.information_requested',
    },
    decision,
  );
}

export async function assignReviewer(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
  reviewerId: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const [reviewerRow] = await db.select().from(users).where(eq(users.id, reviewerId)).limit(1);
  if (!reviewerRow) return deny('The selected reviewer does not exist.');
  const reviewer = toActor(reviewerRow);

  const decision = canAssignReviewer(actor, loaded.snapshot, reviewer);
  if (!decision.allowed) return decision;

  return applyTransition(
    db,
    actor,
    loaded,
    {
      patch: { assignedReviewerId: reviewer.id },
      eventType: 'reviewer_assigned',
      note: `Assigned to ${reviewer.name}.`,
      action: 'kyc.case.reviewer_assigned',
    },
    decision,
  );
}

export async function verifyDocument(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
  documentId: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const [document] = await db
    .select()
    .from(kycDocuments)
    .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.caseId, caseId)))
    .limit(1);
  if (!document) return deny('Document not found on this case.');

  const decision = canVerifyDocument(actor, loaded.snapshot, document);
  if (!decision.allowed) return decision;

  return db.transaction((tx) => {
    const now = new Date();

    // The case must still be in the state the rule saw, so a decision that
    // commits in between cannot be followed by a verification.
    const touched = tx
      .update(kycCases)
      .set({ modifiedAt: now })
      .where(
        and(
          eq(kycCases.id, caseId),
          eq(kycCases.stage, loaded.stage),
          eq(kycCases.modifiedAt, loaded.modifiedAt),
        ),
      )
      .run();

    if (touched.changes === 0) return deny(CASE_CHANGED);

    const updated = tx
      .update(kycDocuments)
      .set({ status: 'verified', verifiedAt: now, verifiedById: actor.id })
      .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.status, 'missing')))
      .run();

    if (updated.changes === 0) return deny(`${document.documentType} is already verified.`);

    tx.insert(kycCaseEvents)
      .values({
        id: `evt_${crypto.randomUUID()}`,
        caseId,
        actorId: actor.id,
        type: 'document_verified',
        fromStage: loaded.stage,
        toStage: null,
        note: `${document.documentType} verified.`,
        createdAt: now,
      })
      .run();

    recordAuditEntriesSync(tx, [
      {
        actor,
        action: 'kyc.document.verified',
        entityType: 'kyc_case',
        entityId: caseId,
        before: { document: document.documentType, status: document.status },
        after: { document: document.documentType, status: 'verified' },
        at: now,
      },
    ]);

    return decision;
  });
}

export async function approveCase(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const decision = canApproveCase(actor, loaded.snapshot);
  if (!decision.allowed) return decision;

  return applyTransition(
    db,
    actor,
    loaded,
    {
      patch: { stage: 'approved' },
      eventType: 'case_approved',
      note: null,
      action: 'kyc.case.approved',
    },
    decision,
  );
}

export async function rejectCase(
  db: AppDatabase,
  actor: Actor,
  caseId: string,
  reason: string,
): Promise<RuleResult> {
  const loaded = await loadCase(db, caseId);
  if (!loaded) return deny(CASE_NOT_FOUND);

  const decision = canRejectCase(actor, loaded.snapshot, reason);
  if (!decision.allowed) return decision;

  return applyTransition(
    db,
    actor,
    loaded,
    {
      patch: { stage: 'rejected', decisionReason: reason.trim() },
      eventType: 'case_rejected',
      note: reason.trim(),
      action: 'kyc.case.rejected',
    },
    decision,
  );
}
