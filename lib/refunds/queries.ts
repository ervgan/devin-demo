import { and, desc, eq, gte, lt, ne, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  customers,
  refundEvents,
  refundRequests,
  transactions,
  users,
} from '@/lib/db/schema';
import { listAuditEntriesForEntity, type AuditEntryView } from '@/lib/audit';
import { getKycSummaryForCustomer, type CustomerKycSummary } from '@/lib/kyc/queries';
import {
  isAwaitingSecondApproval,
  SECOND_APPROVER_THRESHOLD_CENTS,
  type RefundSnapshot,
} from '@/lib/rules';
import type {
  KycStatus,
  RefundChannel,
  RefundEventType,
  RefundReasonCode,
  RefundStatus,
  SubjectType,
} from '@/lib/rules/types';

export const REFUND_ENTITY_TYPE = 'refund_request';

/** Refund value still owed to customers: everything not settled or rejected. */
const PENDING_STATUSES: readonly RefundStatus[] = ['requested', 'under_review', 'approved'];

export const AMOUNT_BANDS = {
  small: { label: 'Under €100', min: 0, max: 10_000 },
  medium: { label: '€100 – €999.99', min: 10_000, max: SECOND_APPROVER_THRESHOLD_CENTS },
  large: { label: '€1,000 and over', min: SECOND_APPROVER_THRESHOLD_CENTS, max: null },
} as const;

export type AmountBand = keyof typeof AMOUNT_BANDS;

export const REFUND_SORT_FIELDS = [
  'reference',
  'customer',
  'amount',
  'status',
  'created',
  'modified',
] as const;
export type RefundSortField = (typeof REFUND_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

export interface RefundFilters {
  search?: string;
  status?: RefundStatus;
  reasonCode?: RefundReasonCode;
  band?: AmountBand;
  sort?: RefundSortField;
  direction?: SortDirection;
}

export interface RefundListItem {
  id: string;
  refundRef: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  currency: string;
  reasonCode: RefundReasonCode;
  channel: RefundChannel;
  status: RefundStatus;
  requestedByName: string;
  awaitingSecondApproval: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface RefundTimelineEntry {
  id: string;
  type: RefundEventType;
  actorName: string;
  fromStatus: RefundStatus | null;
  toStatus: RefundStatus | null;
  note: string | null;
  createdAt: Date;
}

export interface RefundHistoryItem {
  id: string;
  refundRef: string;
  amountCents: number;
  currency: string;
  reasonCode: RefundReasonCode;
  status: RefundStatus;
  createdAt: Date;
}

export interface RefundDetail {
  id: string;
  refundRef: string;
  status: RefundStatus;
  amountCents: number;
  currency: string;
  reasonCode: RefundReasonCode;
  channel: RefundChannel;
  requestedByName: string;
  firstApproverName: string | null;
  secondApproverName: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  modifiedAt: Date;
  customer: {
    id: string;
    name: string;
    subjectType: SubjectType;
    email: string;
    country: string;
    /** Shown for information only; no refund rule reads it. */
    kycStatus: KycStatus;
    kycCase: CustomerKycSummary | null;
  };
  transaction: {
    transactionRef: string;
    amountCents: number;
    currency: string;
    channel: RefundChannel;
    description: string;
    occurredAt: Date;
  };
  customerRefunds: RefundHistoryItem[];
  timeline: RefundTimelineEntry[];
  auditHistory: AuditEntryView[];
  /** The projection the rules operate on, built once here. */
  snapshot: RefundSnapshot;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function compareListItems(
  a: RefundListItem,
  b: RefundListItem,
  field: RefundSortField,
): number {
  switch (field) {
    case 'reference':
      return a.refundRef.localeCompare(b.refundRef);
    case 'customer':
      return a.customerName.localeCompare(b.customerName);
    case 'amount':
      return a.amountCents - b.amountCents;
    case 'status':
      return a.status.localeCompare(b.status);
    case 'created':
      return a.createdAt.getTime() - b.createdAt.getTime();
    case 'modified':
      return a.modifiedAt.getTime() - b.modifiedAt.getTime();
  }
}

export async function listRefunds(filters: RefundFilters = {}): Promise<RefundListItem[]> {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(refundRequests.status, filters.status));
  if (filters.reasonCode) conditions.push(eq(refundRequests.reasonCode, filters.reasonCode));
  if (filters.band) {
    const band = AMOUNT_BANDS[filters.band];
    conditions.push(gte(refundRequests.amountCents, band.min));
    if (band.max !== null) conditions.push(lt(refundRequests.amountCents, band.max));
  }

  const query = db
    .select({
      id: refundRequests.id,
      refundRef: refundRequests.refundRef,
      customerId: refundRequests.customerId,
      customerName: customers.name,
      amountCents: refundRequests.amountCents,
      currency: refundRequests.currency,
      reasonCode: refundRequests.reasonCode,
      channel: refundRequests.channel,
      status: refundRequests.status,
      requestedByName: users.name,
      firstApproverId: refundRequests.firstApproverId,
      secondApproverId: refundRequests.secondApproverId,
      createdAt: refundRequests.createdAt,
      modifiedAt: refundRequests.modifiedAt,
    })
    .from(refundRequests)
    .innerJoin(customers, eq(refundRequests.customerId, customers.id))
    .innerJoin(users, eq(refundRequests.requestedById, users.id));

  const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query);

  // Case-insensitive matching is done here rather than in SQL: LIKE differs in
  // case sensitivity between SQLite and Postgres, and the queue is small.
  const search = filters.search ? normalise(filters.search) : '';
  const items = rows
    .filter((row) => {
      if (!search) return true;
      return (
        normalise(row.refundRef).includes(search) || normalise(row.customerName).includes(search)
      );
    })
    .map(({ firstApproverId, secondApproverId, ...row }) => ({
      ...row,
      awaitingSecondApproval: isAwaitingSecondApproval({
        amountCents: row.amountCents,
        status: row.status,
        firstApproverId,
        secondApproverId,
      }),
    }));

  const field = filters.sort ?? 'modified';
  const factor = (filters.direction ?? 'desc') === 'asc' ? 1 : -1;
  return items.sort((a, b) => compareListItems(a, b, field) * factor);
}

export interface PendingValue {
  currency: string;
  amountCents: number;
}

export interface RefundTotals {
  counts: Record<RefundStatus, number>;
  awaitingSecondApproval: number;
  /** One total per currency: amounts in different currencies are never added together. */
  pendingValues: PendingValue[];
}

export async function summariseRefunds(): Promise<RefundTotals> {
  const rows = await getDb()
    .select({
      status: refundRequests.status,
      amountCents: refundRequests.amountCents,
      currency: refundRequests.currency,
      firstApproverId: refundRequests.firstApproverId,
      secondApproverId: refundRequests.secondApproverId,
    })
    .from(refundRequests);

  const counts: Record<RefundStatus, number> = {
    requested: 0,
    under_review: 0,
    approved: 0,
    settled: 0,
    rejected: 0,
  };
  const pending = new Map<string, number>();
  let awaitingSecondApproval = 0;

  for (const row of rows) {
    counts[row.status] += 1;
    if (PENDING_STATUSES.includes(row.status)) {
      pending.set(row.currency, (pending.get(row.currency) ?? 0) + row.amountCents);
    }
    if (isAwaitingSecondApproval(row)) awaitingSecondApproval += 1;
  }

  const pendingValues = [...pending.entries()]
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);

  return { counts, awaitingSecondApproval, pendingValues };
}

export async function getRefundDetail(refundId: string): Promise<RefundDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      refund: refundRequests,
      customer: customers,
      transaction: transactions,
      requestedByName: users.name,
    })
    .from(refundRequests)
    .innerJoin(customers, eq(refundRequests.customerId, customers.id))
    .innerJoin(transactions, eq(refundRequests.transactionId, transactions.id))
    .innerJoin(users, eq(refundRequests.requestedById, users.id))
    .where(eq(refundRequests.id, refundId))
    .limit(1);

  if (!row) return null;

  const [approvers, events, auditHistory, history, kycCase] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users),
    db
      .select({ event: refundEvents, actorName: users.name })
      .from(refundEvents)
      .innerJoin(users, eq(refundEvents.actorId, users.id))
      .where(eq(refundEvents.refundId, refundId))
      .orderBy(desc(refundEvents.createdAt)),
    listAuditEntriesForEntity(db, REFUND_ENTITY_TYPE, refundId),
    db
      .select({
        id: refundRequests.id,
        refundRef: refundRequests.refundRef,
        amountCents: refundRequests.amountCents,
        currency: refundRequests.currency,
        reasonCode: refundRequests.reasonCode,
        status: refundRequests.status,
        createdAt: refundRequests.createdAt,
      })
      .from(refundRequests)
      .where(
        and(eq(refundRequests.customerId, row.customer.id), ne(refundRequests.id, refundId)),
      )
      .orderBy(desc(refundRequests.createdAt)),
    getKycSummaryForCustomer(row.customer.id),
  ]);

  const nameById = new Map(approvers.map((user) => [user.id, user.name] as const));

  return {
    id: row.refund.id,
    refundRef: row.refund.refundRef,
    status: row.refund.status,
    amountCents: row.refund.amountCents,
    currency: row.refund.currency,
    reasonCode: row.refund.reasonCode,
    channel: row.refund.channel,
    requestedByName: row.requestedByName,
    firstApproverName: row.refund.firstApproverId
      ? nameById.get(row.refund.firstApproverId) ?? null
      : null,
    secondApproverName: row.refund.secondApproverId
      ? nameById.get(row.refund.secondApproverId) ?? null
      : null,
    rejectionReason: row.refund.rejectionReason,
    createdAt: row.refund.createdAt,
    modifiedAt: row.refund.modifiedAt,
    customer: {
      id: row.customer.id,
      name: row.customer.name,
      subjectType: row.customer.subjectType,
      email: row.customer.email,
      country: row.customer.country,
      kycStatus: row.customer.kycStatus,
      kycCase,
    },
    transaction: {
      transactionRef: row.transaction.transactionRef,
      amountCents: row.transaction.amountCents,
      currency: row.transaction.currency,
      channel: row.transaction.channel,
      description: row.transaction.description,
      occurredAt: row.transaction.occurredAt,
    },
    customerRefunds: history,
    timeline: events.map((entry) => ({
      id: entry.event.id,
      type: entry.event.type,
      actorName: entry.actorName,
      fromStatus: entry.event.fromStatus,
      toStatus: entry.event.toStatus,
      note: entry.event.note,
      createdAt: entry.event.createdAt,
    })),
    auditHistory,
    snapshot: {
      refundRef: row.refund.refundRef,
      status: row.refund.status,
      amountCents: row.refund.amountCents,
      currency: row.refund.currency,
      requestedById: row.refund.requestedById,
      firstApproverId: row.refund.firstApproverId,
      secondApproverId: row.refund.secondApproverId,
    },
  };
}
