import { eq } from 'drizzle-orm';
import { recordAuditEntry } from '@/lib/audit';
import type { AppDatabase } from '@/lib/db/client';
import { customers, kycCaseEvents, kycCases, kycDocuments, users } from '@/lib/db/schema';
import {
  canAdvanceStage,
  canApproveCase,
  canAssignReviewer,
  canRejectCase,
  canRequestInformation,
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

async function applyTransition(
  db: AppDatabase,
  actor: Actor,
  loaded: LoadedCase,
  write: TransitionWrite,
): Promise<void> {
  const now = new Date();
  const before = {
    stage: loaded.stage,
    assignedReviewerId: loaded.assignedReviewerId,
  };

  await db
    .update(kycCases)
    .set({ ...write.patch, modifiedAt: now })
    .where(eq(kycCases.id, loaded.id));

  if (write.patch.stage === 'approved' || write.patch.stage === 'rejected') {
    await db
      .update(customers)
      .set({ kycStatus: write.patch.stage })
      .where(eq(customers.id, loaded.customerId));
  }

  await db.insert(kycCaseEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    caseId: loaded.id,
    actorId: actor.id,
    type: write.eventType,
    fromStage: loaded.stage,
    toStage: write.patch.stage ?? null,
    note: write.note,
    createdAt: now,
  });

  await recordAuditEntry(db, {
    actor,
    action: write.action,
    entityType: 'kyc_case',
    entityId: loaded.id,
    before,
    after: { ...before, ...write.patch },
    at: now,
  });
}

const CASE_NOT_FOUND = 'Case not found.';

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

  await applyTransition(db, actor, loaded, {
    patch: { stage: target },
    eventType: 'stage_advanced',
    note: null,
    action: 'kyc.case.advanced',
  });
  return decision;
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

  await applyTransition(db, actor, loaded, {
    patch: {},
    eventType: 'information_requested',
    note: reason.trim(),
    action: 'kyc.case.information_requested',
  });
  return decision;
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

  await applyTransition(db, actor, loaded, {
    patch: { assignedReviewerId: reviewer.id },
    eventType: 'reviewer_assigned',
    note: `Assigned to ${reviewer.name}.`,
    action: 'kyc.case.reviewer_assigned',
  });
  return decision;
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

  await applyTransition(db, actor, loaded, {
    patch: { stage: 'approved' },
    eventType: 'case_approved',
    note: null,
    action: 'kyc.case.approved',
  });
  return decision;
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

  await applyTransition(db, actor, loaded, {
    patch: { stage: 'rejected', decisionReason: reason.trim() },
    eventType: 'case_rejected',
    note: reason.trim(),
    action: 'kyc.case.rejected',
  });
  return decision;
}
