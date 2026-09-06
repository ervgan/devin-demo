import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { booleanCol, timestampCol } from './columns';
import type {
  CaseEventType,
  CaseStage,
  DocumentStatus,
  Environment,
  KycStatus,
  RefundChannel,
  RefundEventType,
  RefundReasonCode,
  RefundStatus,
  RiskRating,
  Role,
  SubjectType,
} from '@/lib/rules/types';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role').$type<Role>().notNull(),
  createdAt: timestampCol('created_at').notNull(),
});

/** One customers table, shared by KYC and refunds. */
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  subjectType: text('subject_type').$type<SubjectType>().notNull(),
  email: text('email').notNull(),
  country: text('country').notNull(),
  /** ISO date string, individuals only. */
  dateOfBirth: text('date_of_birth'),
  /** Company registration number, organisations only. */
  registrationNumber: text('registration_number'),
  kycStatus: text('kyc_status').$type<KycStatus>().notNull(),
  createdAt: timestampCol('created_at').notNull(),
});

export const kycCases = sqliteTable(
  'kyc_cases',
  {
    id: text('id').primaryKey(),
    /** Human-facing case identifier, e.g. KYC-2041. */
    caseRef: text('case_ref').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    stage: text('stage').$type<CaseStage>().notNull(),
    riskRating: text('risk_rating').$type<RiskRating>().notNull(),
    assignedReviewerId: text('assigned_reviewer_id').references(() => users.id),
    decisionReason: text('decision_reason'),
    openedAt: timestampCol('opened_at').notNull(),
    modifiedAt: timestampCol('modified_at').notNull(),
  },
  (table) => ({
    caseRefIdx: uniqueIndex('kyc_cases_case_ref_idx').on(table.caseRef),
    stageIdx: index('kyc_cases_stage_idx').on(table.stage),
  }),
);

export const kycDocuments = sqliteTable(
  'kyc_documents',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => kycCases.id),
    documentType: text('document_type').notNull(),
    status: text('status').$type<DocumentStatus>().notNull(),
    verifiedAt: timestampCol('verified_at'),
    verifiedById: text('verified_by_id').references(() => users.id),
  },
  (table) => ({
    caseIdx: index('kyc_documents_case_idx').on(table.caseId),
  }),
);

/** Contributing factors behind a case's risk rating. */
export const kycRiskFactors = sqliteTable(
  'kyc_risk_factors',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => kycCases.id),
    factor: text('factor').notNull(),
    detail: text('detail').notNull(),
    /** Relative contribution to the rating, 1 (minor) to 5 (decisive). */
    weight: integer('weight').notNull(),
  },
  (table) => ({
    caseIdx: index('kyc_risk_factors_case_idx').on(table.caseId),
  }),
);

/** Case timeline: workflow events, distinct from the platform-wide audit log. */
export const kycCaseEvents = sqliteTable(
  'kyc_case_events',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => kycCases.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<CaseEventType>().notNull(),
    fromStage: text('from_stage').$type<CaseStage>(),
    toStage: text('to_stage').$type<CaseStage>(),
    note: text('note'),
    createdAt: timestampCol('created_at').notNull(),
  },
  (table) => ({
    caseIdx: index('kyc_case_events_case_idx').on(table.caseId),
  }),
);

/** The original payment a refund is raised against. */
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    transactionRef: text('transaction_ref').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Minor units, so no floating point money. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    channel: text('channel').$type<RefundChannel>().notNull(),
    description: text('description').notNull(),
    occurredAt: timestampCol('occurred_at').notNull(),
  },
  (table) => ({
    transactionRefIdx: uniqueIndex('transactions_ref_idx').on(table.transactionRef),
    customerIdx: index('transactions_customer_idx').on(table.customerId),
  }),
);

export const refundRequests = sqliteTable(
  'refund_requests',
  {
    id: text('id').primaryKey(),
    refundRef: text('refund_ref').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id),
    /** Minor units, so no floating point money. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    reasonCode: text('reason_code').$type<RefundReasonCode>().notNull(),
    channel: text('channel').$type<RefundChannel>().notNull(),
    status: text('status').$type<RefundStatus>().notNull(),
    requestedById: text('requested_by_id')
      .notNull()
      .references(() => users.id),
    firstApproverId: text('first_approver_id').references(() => users.id),
    secondApproverId: text('second_approver_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    createdAt: timestampCol('created_at').notNull(),
    modifiedAt: timestampCol('modified_at').notNull(),
  },
  (table) => ({
    refundRefIdx: uniqueIndex('refund_requests_ref_idx').on(table.refundRef),
    customerIdx: index('refund_requests_customer_idx').on(table.customerId),
    statusIdx: index('refund_requests_status_idx').on(table.status),
  }),
);

/** Refund timeline: workflow events, distinct from the platform-wide audit log. */
export const refundEvents = sqliteTable(
  'refund_events',
  {
    id: text('id').primaryKey(),
    refundId: text('refund_id')
      .notNull()
      .references(() => refundRequests.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<RefundEventType>().notNull(),
    fromStatus: text('from_status').$type<RefundStatus>(),
    toStatus: text('to_status').$type<RefundStatus>(),
    note: text('note'),
    createdAt: timestampCol('created_at').notNull(),
  },
  (table) => ({
    refundIdx: index('refund_events_refund_idx').on(table.refundId),
  }),
);

/** One flags table holding one row per flag per environment. */
export const featureFlags = sqliteTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    description: text('description').notNull(),
    environment: text('environment').$type<Environment>().notNull(),
    enabled: booleanCol('enabled').notNull(),
    updatedAt: timestampCol('updated_at').notNull(),
  },
  (table) => ({
    keyEnvIdx: uniqueIndex('feature_flags_key_env_idx').on(table.key, table.environment),
  }),
);

/** Append-only. Written only by lib/audit. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** JSON snapshots of the changed fields. */
    before: text('before'),
    after: text('after'),
    createdAt: timestampCol('created_at').notNull(),
  },
  (table) => ({
    entityIdx: index('audit_log_entity_idx').on(table.entityType, table.entityId),
  }),
);

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type KycCase = typeof kycCases.$inferSelect;
export type KycDocument = typeof kycDocuments.$inferSelect;
export type KycRiskFactor = typeof kycRiskFactors.$inferSelect;
export type KycCaseEvent = typeof kycCaseEvents.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type RefundRequest = typeof refundRequests.$inferSelect;
export type RefundEvent = typeof refundEvents.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;

export const schema = {
  users,
  customers,
  kycCases,
  kycDocuments,
  kycRiskFactors,
  kycCaseEvents,
  transactions,
  refundRequests,
  refundEvents,
  featureFlags,
  auditLog,
};
