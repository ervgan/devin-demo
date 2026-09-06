import { requireReason } from './reasons';
import { requireRole } from './roles';
import { all, allow, deny, type RuleResult } from './result';
import {
  STAGE_LABELS,
  WORKFLOW_STAGES,
  type Actor,
  type CaseStage,
  type DocumentStatus,
  type RiskRating,
  type WorkflowStage,
} from './types';

export interface CaseDocument {
  documentType: string;
  status: DocumentStatus;
}

/** The projection of a case the rules need. Deliberately not a database row. */
export interface CaseSnapshot {
  caseRef: string;
  stage: CaseStage;
  riskRating: RiskRating;
  assignedReviewerId: string | null;
  documents: CaseDocument[];
}

/** Roles that may move a case through the workflow at all. */
const CASE_WORKER_ROLES = ['compliance_analyst', 'support_agent'] as const;

/** Roles that may take a final decision on a case. */
const CASE_DECIDER_ROLES = ['compliance_analyst'] as const;

/** Documents must all be verified before a case leaves this stage. */
const DOCUMENTS_COMPLETE_FROM: WorkflowStage = 'due_diligence';

export function isTerminalStage(stage: CaseStage): boolean {
  return stage === 'approved' || stage === 'rejected';
}

export function nextStage(stage: CaseStage): WorkflowStage | null {
  const index = WORKFLOW_STAGES.indexOf(stage as WorkflowStage);
  if (index < 0) return null;
  return WORKFLOW_STAGES[index + 1] ?? null;
}

export function missingDocuments(snapshot: CaseSnapshot): CaseDocument[] {
  return snapshot.documents.filter((document) => document.status === 'missing');
}

/** Shared precondition: a decided case is immutable. */
function requireOpenCase(snapshot: CaseSnapshot, activity: string): RuleResult {
  if (isTerminalStage(snapshot.stage)) {
    return deny(
      `Case ${snapshot.caseRef} is ${STAGE_LABELS[snapshot.stage].toLowerCase()} and can no longer ${activity}.`,
    );
  }
  return allow(`Case ${snapshot.caseRef} is open.`);
}

function requireDocumentsVerified(snapshot: CaseSnapshot, activity: string): RuleResult {
  const missing = missingDocuments(snapshot);
  if (missing.length > 0) {
    return deny(
      `Cannot ${activity} while ${missing.length} document${missing.length === 1 ? ' is' : 's are'} missing: ${missing
        .map((document) => document.documentType)
        .join(', ')}.`,
    );
  }
  return allow('All documents are verified.');
}

export function canAdvanceStage(actor: Actor, snapshot: CaseSnapshot): RuleResult {
  const target = nextStage(snapshot.stage);
  const roleCheck = requireRole(actor, [...CASE_WORKER_ROLES], 'advance a KYC case');
  const openCheck = requireOpenCase(snapshot, 'be advanced');
  if (!roleCheck.allowed || !openCheck.allowed) return all(roleCheck, openCheck);

  if (target === null) {
    return deny(
      `Case ${snapshot.caseRef} is at ${STAGE_LABELS[snapshot.stage]}; approve or reject it instead of advancing.`,
    );
  }
  if (snapshot.stage === DOCUMENTS_COMPLETE_FROM) {
    const documentCheck = requireDocumentsVerified(snapshot, `advance to ${STAGE_LABELS[target]}`);
    if (!documentCheck.allowed) return documentCheck;
  }
  return allow(`Case may advance to ${STAGE_LABELS[target]}.`);
}

/**
 * Whether the actor could request information at all, ignoring the reason.
 * The queue uses this to decide whether to offer the form; the action still
 * calls `canRequestInformation`, which additionally requires the reason.
 */
export function mayRequestInformation(actor: Actor, snapshot: CaseSnapshot): RuleResult {
  return all(
    requireRole(actor, [...CASE_WORKER_ROLES], 'request more information on a KYC case'),
    requireOpenCase(snapshot, 'have information requested'),
  );
}

export function canRequestInformation(
  actor: Actor,
  snapshot: CaseSnapshot,
  reason: string | null | undefined,
): RuleResult {
  return all(
    mayRequestInformation(actor, snapshot),
    requireReason(reason, 'request more information'),
  );
}

/** Whether the actor could reassign the case, ignoring who the reviewer is. */
export function mayAssignReviewer(actor: Actor, snapshot: CaseSnapshot): RuleResult {
  return all(
    requireRole(actor, [...CASE_WORKER_ROLES], 'assign a KYC case'),
    requireOpenCase(snapshot, 'be reassigned'),
  );
}

export function canAssignReviewer(
  actor: Actor,
  snapshot: CaseSnapshot,
  reviewer: Actor,
): RuleResult {
  const base = mayAssignReviewer(actor, snapshot);
  if (!base.allowed) return base;
  if (reviewer.role !== 'compliance_analyst') {
    return deny(`${reviewer.name} is not a compliance analyst and cannot review KYC cases.`);
  }
  return allow(`Case may be assigned to ${reviewer.name}.`);
}

export function canApproveCase(actor: Actor, snapshot: CaseSnapshot): RuleResult {
  const base = all(
    requireRole(actor, [...CASE_DECIDER_ROLES], 'approve a KYC case'),
    requireOpenCase(snapshot, 'be approved'),
  );
  if (!base.allowed) return base;
  if (snapshot.stage !== 'fulfilment') {
    return deny(
      `Case ${snapshot.caseRef} must reach Fulfilment before approval; it is at ${STAGE_LABELS[snapshot.stage]}.`,
    );
  }
  const documentCheck = requireDocumentsVerified(snapshot, 'approve the case');
  if (!documentCheck.allowed) return documentCheck;
  if (snapshot.assignedReviewerId === null) {
    return deny(`Case ${snapshot.caseRef} must have an assigned reviewer before approval.`);
  }
  return allow(`Case ${snapshot.caseRef} may be approved.`);
}

/** Whether the actor could reject the case, ignoring the reason. */
export function mayRejectCase(actor: Actor, snapshot: CaseSnapshot): RuleResult {
  return all(
    requireRole(actor, [...CASE_DECIDER_ROLES], 'reject a KYC case'),
    requireOpenCase(snapshot, 'be rejected'),
  );
}

export function canRejectCase(
  actor: Actor,
  snapshot: CaseSnapshot,
  reason: string | null | undefined,
): RuleResult {
  return all(mayRejectCase(actor, snapshot), requireReason(reason, 'reject the case'));
}
