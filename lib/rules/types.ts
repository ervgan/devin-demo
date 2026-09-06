/**
 * Domain vocabulary shared by the rules, the database schema and the UI.
 * Values are the exact strings persisted in the database.
 */

export const ROLES = ['compliance_analyst', 'support_agent', 'engineer'] as const;
export type Role = (typeof ROLES)[number];

export const WORKFLOW_STAGES = ['capture', 'enrichment', 'due_diligence', 'fulfilment'] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const TERMINAL_STAGES = ['approved', 'rejected'] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export const CASE_STAGES = [...WORKFLOW_STAGES, ...TERMINAL_STAGES] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const RISK_RATINGS = ['low', 'medium', 'high'] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

export const SUBJECT_TYPES = ['individual', 'organisation'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const DOCUMENT_STATUSES = ['verified', 'missing'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const KYC_STATUSES = ['not_started', 'in_review', 'approved', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const REFUND_STATUSES = [
  'requested',
  'under_review',
  'approved',
  'settled',
  'rejected',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_REASON_CODES = [
  'duplicate_charge',
  'service_not_received',
  'fraud',
  'goodwill',
  'price_adjustment',
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const REFUND_CHANNELS = ['card', 'bank_transfer', 'wallet', 'direct_debit'] as const;
export type RefundChannel = (typeof REFUND_CHANNELS)[number];

export const REFUND_EVENT_TYPES = [
  'refund_requested',
  'review_started',
  'information_requested',
  'note_added',
  'first_approval_recorded',
  'refund_approved',
  'refund_rejected',
  'refund_settled',
] as const;
export type RefundEventType = (typeof REFUND_EVENT_TYPES)[number];

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const CASE_EVENT_TYPES = [
  'case_opened',
  'stage_advanced',
  'information_requested',
  'reviewer_assigned',
  'case_approved',
  'case_rejected',
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

/** The minimum an actor needs to be authorised. Never a database row type. */
export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export const STAGE_LABELS: Record<CaseStage, string> = {
  capture: 'Capture',
  enrichment: 'Enrichment',
  due_diligence: 'Due Diligence',
  fulfilment: 'Fulfilment',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: 'Requested',
  under_review: 'Under Review',
  approved: 'Approved',
  settled: 'Settled',
  rejected: 'Rejected',
};

export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  duplicate_charge: 'Duplicate charge',
  service_not_received: 'Service not received',
  fraud: 'Fraud',
  goodwill: 'Goodwill',
  price_adjustment: 'Price adjustment',
};

export const REFUND_CHANNEL_LABELS: Record<RefundChannel, string> = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  wallet: 'Wallet',
  direct_debit: 'Direct debit',
};

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  not_started: 'Not started',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const ROLE_LABELS: Record<Role, string> = {
  compliance_analyst: 'Compliance Analyst',
  support_agent: 'Support Agent',
  engineer: 'Engineer',
};
