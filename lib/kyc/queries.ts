import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  customers,
  kycCaseEvents,
  kycCases,
  kycDocuments,
  kycRiskFactors,
  users,
} from '@/lib/db/schema';
import { listAuditEntriesForEntity, type AuditEntryView } from '@/lib/audit';
import { canViewAuditHistory, missingDocuments, type CaseSnapshot } from '@/lib/rules';
import type {
  Actor,
  CaseEventType,
  CaseStage,
  DocumentStatus,
  RiskRating,
  SubjectType,
} from '@/lib/rules/types';

export const KYC_ENTITY_TYPE = 'kyc_case';

export interface CaseListItem {
  id: string;
  caseRef: string;
  subjectName: string;
  subjectType: SubjectType;
  stage: CaseStage;
  riskRating: RiskRating;
  reviewerId: string | null;
  reviewerName: string | null;
  modifiedAt: Date;
}

export interface CaseFilters {
  search?: string;
  stage?: CaseStage;
  risk?: RiskRating;
  assigneeId?: string;
  /** Matches cases with no reviewer when true. */
  unassigned?: boolean;
}

export interface CaseDocumentView {
  id: string;
  documentType: string;
  status: DocumentStatus;
  verifiedAt: Date | null;
}

export interface CaseRiskFactorView {
  id: string;
  factor: string;
  detail: string;
  weight: number;
}

export interface CaseTimelineEntry {
  id: string;
  type: CaseEventType;
  actorName: string;
  fromStage: CaseStage | null;
  toStage: CaseStage | null;
  note: string | null;
  createdAt: Date;
}

export interface CaseDetail {
  id: string;
  caseRef: string;
  stage: CaseStage;
  riskRating: RiskRating;
  reviewerId: string | null;
  reviewerName: string | null;
  decisionReason: string | null;
  openedAt: Date;
  modifiedAt: Date;
  subject: {
    id: string;
    name: string;
    subjectType: SubjectType;
    email: string;
    country: string;
    dateOfBirth: string | null;
    registrationNumber: string | null;
  };
  documents: CaseDocumentView[];
  riskFactors: CaseRiskFactorView[];
  timeline: CaseTimelineEntry[];
  /** Empty unless the reader is allowed to see the technical audit trail. */
  auditHistory: AuditEntryView[];
  /** The projection the rules operate on, built once here. */
  snapshot: CaseSnapshot;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

export async function listCases(filters: CaseFilters = {}): Promise<CaseListItem[]> {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filters.stage) conditions.push(eq(kycCases.stage, filters.stage));
  if (filters.risk) conditions.push(eq(kycCases.riskRating, filters.risk));
  if (filters.assigneeId) conditions.push(eq(kycCases.assignedReviewerId, filters.assigneeId));

  const query = db
    .select({
      id: kycCases.id,
      caseRef: kycCases.caseRef,
      stage: kycCases.stage,
      riskRating: kycCases.riskRating,
      reviewerId: kycCases.assignedReviewerId,
      reviewerName: users.name,
      modifiedAt: kycCases.modifiedAt,
      subjectName: customers.name,
      subjectType: customers.subjectType,
    })
    .from(kycCases)
    .innerJoin(customers, eq(kycCases.customerId, customers.id))
    .leftJoin(users, eq(kycCases.assignedReviewerId, users.id))
    .orderBy(desc(kycCases.modifiedAt));

  const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query);

  // Case-insensitive matching is done here rather than in SQL: LIKE differs in
  // case sensitivity between SQLite and Postgres, and the queue is small.
  const search = filters.search ? normalise(filters.search) : '';

  return rows.filter((row) => {
    if (filters.unassigned && row.reviewerId !== null) return false;
    if (!search) return true;
    return (
      normalise(row.caseRef).includes(search) || normalise(row.subjectName).includes(search)
    );
  });
}

export async function countCasesByStage(): Promise<Record<CaseStage, number>> {
  const rows = await getDb().select({ stage: kycCases.stage }).from(kycCases);
  const counts: Record<CaseStage, number> = {
    capture: 0,
    enrichment: 0,
    due_diligence: 0,
    fulfilment: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of rows) counts[row.stage] += 1;
  return counts;
}

export async function getCaseDetail(caseId: string, reader: Actor): Promise<CaseDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({ kycCase: kycCases, customer: customers, reviewerName: users.name })
    .from(kycCases)
    .innerJoin(customers, eq(kycCases.customerId, customers.id))
    .leftJoin(users, eq(kycCases.assignedReviewerId, users.id))
    .where(eq(kycCases.id, caseId))
    .limit(1);

  if (!row) return null;

  const [documents, riskFactors, events, auditHistory] = await Promise.all([
    db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.caseId, caseId))
      .orderBy(asc(kycDocuments.id)),
    db
      .select()
      .from(kycRiskFactors)
      .where(eq(kycRiskFactors.caseId, caseId))
      .orderBy(desc(kycRiskFactors.weight)),
    db
      .select({ event: kycCaseEvents, actorName: users.name })
      .from(kycCaseEvents)
      .innerJoin(users, eq(kycCaseEvents.actorId, users.id))
      .where(eq(kycCaseEvents.caseId, caseId))
      .orderBy(desc(kycCaseEvents.createdAt)),
    canViewAuditHistory(reader).allowed
      ? listAuditEntriesForEntity(db, KYC_ENTITY_TYPE, caseId)
      : Promise.resolve<AuditEntryView[]>([]),
  ]);

  const documentViews: CaseDocumentView[] = documents.map((document) => ({
    id: document.id,
    documentType: document.documentType,
    status: document.status,
    verifiedAt: document.verifiedAt,
  }));

  return {
    id: row.kycCase.id,
    caseRef: row.kycCase.caseRef,
    stage: row.kycCase.stage,
    riskRating: row.kycCase.riskRating,
    reviewerId: row.kycCase.assignedReviewerId,
    reviewerName: row.reviewerName,
    decisionReason: row.kycCase.decisionReason,
    openedAt: row.kycCase.openedAt,
    modifiedAt: row.kycCase.modifiedAt,
    subject: {
      id: row.customer.id,
      name: row.customer.name,
      subjectType: row.customer.subjectType,
      email: row.customer.email,
      country: row.customer.country,
      dateOfBirth: row.customer.dateOfBirth,
      registrationNumber: row.customer.registrationNumber,
    },
    documents: documentViews,
    riskFactors: riskFactors.map((factor) => ({
      id: factor.id,
      factor: factor.factor,
      detail: factor.detail,
      weight: factor.weight,
    })),
    timeline: events.map((entry) => ({
      id: entry.event.id,
      type: entry.event.type,
      actorName: entry.actorName,
      fromStage: entry.event.fromStage,
      toStage: entry.event.toStage,
      note: entry.event.note,
      createdAt: entry.event.createdAt,
    })),
    auditHistory,
    snapshot: {
      caseRef: row.kycCase.caseRef,
      stage: row.kycCase.stage,
      riskRating: row.kycCase.riskRating,
      assignedReviewerId: row.kycCase.assignedReviewerId,
      documents: documentViews.map((document) => ({
        documentType: document.documentType,
        status: document.status,
      })),
    },
  };
}

export interface CustomerKycSummary {
  caseId: string;
  caseRef: string;
  stage: CaseStage;
  riskRating: RiskRating;
}

/**
 * The KYC position of a customer, for other modules to display. Read-only:
 * nothing outside KYC decides anything from it.
 */
export async function getKycSummaryForCustomer(
  customerId: string,
): Promise<CustomerKycSummary | null> {
  const [row] = await getDb()
    .select({
      caseId: kycCases.id,
      caseRef: kycCases.caseRef,
      stage: kycCases.stage,
      riskRating: kycCases.riskRating,
    })
    .from(kycCases)
    .where(eq(kycCases.customerId, customerId))
    .orderBy(desc(kycCases.modifiedAt))
    .limit(1);

  return row ?? null;
}

export function outstandingDocumentCount(snapshot: CaseSnapshot): number {
  return missingDocuments(snapshot).length;
}
