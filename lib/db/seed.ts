import { recordAuditEntriesSync } from '@/lib/audit';
import type { DatabaseWriter } from './client';
import {
  customers,
  featureFlags,
  kycCaseEvents,
  kycCases,
  kycDocuments,
  kycRiskFactors,
  refundEvents,
  refundRequests,
  transactions,
  users,
} from './schema';
import type {
  CaseEventType,
  CaseStage,
  DocumentStatus,
  KycStatus,
  RefundChannel,
  RefundEventType,
  RefundReasonCode,
  RefundStatus,
  RiskRating,
  Role,
  SubjectType,
} from '@/lib/rules/types';

/** Fixed clock so seeded data is identical on every machine. */
const BASE = Date.UTC(2026, 7, 3, 9, 0, 0);
const HOUR = 60 * 60 * 1000;

function at(offsetHours: number): Date {
  return new Date(BASE + offsetHours * HOUR);
}

const USERS: { id: string; name: string; email: string; role: Role }[] = [
  { id: 'usr_amara', name: 'Amara Osei', email: 'amara.osei@example.com', role: 'compliance_analyst' },
  { id: 'usr_liu', name: 'Liu Chen', email: 'liu.chen@example.com', role: 'compliance_analyst' },
  { id: 'usr_priya', name: 'Priya Raman', email: 'priya.raman@example.com', role: 'support_agent' },
  { id: 'usr_tom', name: 'Tom Becker', email: 'tom.becker@example.com', role: 'engineer' },
  { id: 'usr_nadia', name: 'Nadia Faraj', email: 'nadia.faraj@example.com', role: 'admin' },
];

const INDIVIDUAL_DOCUMENTS = [
  'Government ID',
  'Proof of Address',
  'Selfie Verification',
  'Source of Funds',
];

const ORGANISATION_DOCUMENTS = [
  'Certificate of Incorporation',
  'Register of Directors',
  'Ultimate Beneficial Owner Declaration',
  'Proof of Business Address',
  'Source of Funds',
];

interface CaseFixture {
  ref: string;
  customerId: string;
  name: string;
  subjectType: SubjectType;
  country: string;
  identifier: string;
  stage: CaseStage;
  risk: RiskRating;
  reviewerId: string | null;
  /** Index of documents that are still missing; the rest are verified. */
  missingDocuments: number[];
  riskFactors: { factor: string; detail: string; weight: number }[];
  openedHoursAgo: number;
  modifiedHoursAgo: number;
  decisionReason?: string;
}

const CASES: CaseFixture[] = [
  {
    ref: 'KYC-2041',
    customerId: 'cus_hartley',
    name: 'Eleanor Hartley',
    subjectType: 'individual',
    country: 'United Kingdom',
    identifier: '1984-03-11',
    stage: 'capture',
    risk: 'low',
    reviewerId: 'usr_amara',
    missingDocuments: [1, 2, 3],
    riskFactors: [
      { factor: 'Domestic residency', detail: 'Resident in a low-risk jurisdiction.', weight: 1 },
      { factor: 'Retail product', detail: 'Applying for a standard current account.', weight: 1 },
    ],
    openedHoursAgo: 6,
    modifiedHoursAgo: 2,
  },
  {
    ref: 'KYC-2042',
    customerId: 'cus_northwind',
    name: 'Northwind Logistics Ltd',
    subjectType: 'organisation',
    country: 'Ireland',
    identifier: 'IE-4471209',
    stage: 'capture',
    risk: 'medium',
    reviewerId: null,
    missingDocuments: [2, 3, 4],
    riskFactors: [
      { factor: 'Complex ownership', detail: 'Two corporate shareholders above 25%.', weight: 3 },
      { factor: 'Cross-border trade', detail: 'Freight settlement across six countries.', weight: 2 },
    ],
    openedHoursAgo: 30,
    modifiedHoursAgo: 5,
  },
  {
    ref: 'KYC-2043',
    customerId: 'cus_okafor',
    name: 'Chidi Okafor',
    subjectType: 'individual',
    country: 'Nigeria',
    identifier: '1991-11-02',
    stage: 'enrichment',
    risk: 'high',
    reviewerId: 'usr_liu',
    missingDocuments: [3],
    riskFactors: [
      { factor: 'High-risk jurisdiction', detail: 'Residency in an enhanced due diligence country.', weight: 4 },
      { factor: 'Cash-intensive employment', detail: 'Declared income from a cash trading business.', weight: 3 },
      { factor: 'Adverse media', detail: 'Unconfirmed name match in a 2023 press article.', weight: 2 },
    ],
    openedHoursAgo: 52,
    modifiedHoursAgo: 9,
  },
  {
    ref: 'KYC-2044',
    customerId: 'cus_bluepeak',
    name: 'Blue Peak Renewables SA',
    subjectType: 'organisation',
    country: 'Switzerland',
    identifier: 'CHE-118.244.901',
    stage: 'enrichment',
    risk: 'medium',
    reviewerId: 'usr_amara',
    missingDocuments: [4],
    riskFactors: [
      { factor: 'Politically exposed director', detail: 'One director is a former regional minister.', weight: 4 },
      { factor: 'Regulated sector', detail: 'Energy generation is licensed and supervised.', weight: 1 },
    ],
    openedHoursAgo: 74,
    modifiedHoursAgo: 12,
  },
  {
    ref: 'KYC-2045',
    customerId: 'cus_lindqvist',
    name: 'Marta Lindqvist',
    subjectType: 'individual',
    country: 'Sweden',
    identifier: '1978-06-24',
    stage: 'due_diligence',
    risk: 'medium',
    reviewerId: 'usr_liu',
    missingDocuments: [3],
    riskFactors: [
      { factor: 'Source of funds unclear', detail: 'Large inbound transfer from a private sale.', weight: 3 },
      { factor: 'Long-standing customer', detail: 'Nine years of settled activity.', weight: 1 },
    ],
    openedHoursAgo: 96,
    modifiedHoursAgo: 20,
  },
  {
    ref: 'KYC-2046',
    customerId: 'cus_meridian',
    name: 'Meridian Trading Group',
    subjectType: 'organisation',
    country: 'Singapore',
    identifier: 'SG-201844112C',
    stage: 'due_diligence',
    risk: 'high',
    reviewerId: 'usr_amara',
    missingDocuments: [],
    riskFactors: [
      { factor: 'Offshore holding structure', detail: 'Parent registered in a secrecy jurisdiction.', weight: 5 },
      { factor: 'High transaction velocity', detail: 'Forecast monthly volume above threshold.', weight: 3 },
    ],
    openedHoursAgo: 120,
    modifiedHoursAgo: 26,
  },
  {
    ref: 'KYC-2047',
    customerId: 'cus_darcy',
    name: 'Owen D’Arcy',
    subjectType: 'individual',
    country: 'Ireland',
    identifier: '1995-01-19',
    stage: 'due_diligence',
    risk: 'low',
    reviewerId: null,
    missingDocuments: [2],
    riskFactors: [
      { factor: 'Thin file', detail: 'Limited credit history for age band.', weight: 2 },
    ],
    openedHoursAgo: 140,
    modifiedHoursAgo: 33,
  },
  {
    ref: 'KYC-2048',
    customerId: 'cus_castille',
    name: 'Castille Interiors GmbH',
    subjectType: 'organisation',
    country: 'Germany',
    identifier: 'DE-HRB-99214',
    stage: 'fulfilment',
    risk: 'low',
    reviewerId: 'usr_liu',
    missingDocuments: [],
    riskFactors: [
      { factor: 'Transparent ownership', detail: 'Single natural person owns 100%.', weight: 1 },
    ],
    openedHoursAgo: 168,
    modifiedHoursAgo: 40,
  },
  {
    ref: 'KYC-2049',
    customerId: 'cus_navarro',
    name: 'Sofia Navarro',
    subjectType: 'individual',
    country: 'Spain',
    identifier: '1988-09-30',
    stage: 'fulfilment',
    risk: 'medium',
    reviewerId: 'usr_amara',
    missingDocuments: [],
    riskFactors: [
      { factor: 'Non-resident income', detail: 'Salary paid from a foreign employer.', weight: 2 },
      { factor: 'Verified identity', detail: 'Document and biometric checks both passed.', weight: 1 },
    ],
    openedHoursAgo: 190,
    modifiedHoursAgo: 48,
  },
  {
    ref: 'KYC-2050',
    customerId: 'cus_arclight',
    name: 'Arclight Media Ltd',
    subjectType: 'organisation',
    country: 'United Kingdom',
    identifier: 'GB-08812443',
    stage: 'fulfilment',
    risk: 'high',
    reviewerId: null,
    missingDocuments: [],
    riskFactors: [
      { factor: 'Sanctions proximity', detail: 'Supplier network includes a restricted region.', weight: 5 },
      { factor: 'Recent incorporation', detail: 'Registered eleven months ago.', weight: 2 },
    ],
    openedHoursAgo: 210,
    modifiedHoursAgo: 55,
  },
  {
    ref: 'KYC-2051',
    customerId: 'cus_petrov',
    name: 'Irina Petrova',
    subjectType: 'individual',
    country: 'Estonia',
    identifier: '1982-04-08',
    stage: 'approved',
    risk: 'low',
    reviewerId: 'usr_liu',
    missingDocuments: [],
    riskFactors: [
      { factor: 'Documented source of wealth', detail: 'Property sale evidenced by contract.', weight: 1 },
    ],
    openedHoursAgo: 260,
    modifiedHoursAgo: 70,
    decisionReason: 'All checks cleared, identity and source of funds evidenced.',
  },
  {
    ref: 'KYC-2052',
    customerId: 'cus_harbourline',
    name: 'Harbourline Freight BV',
    subjectType: 'organisation',
    country: 'Netherlands',
    identifier: 'NL-64229118',
    stage: 'approved',
    risk: 'medium',
    reviewerId: 'usr_amara',
    missingDocuments: [],
    riskFactors: [
      { factor: 'Established trading history', detail: 'Twelve years of filed accounts.', weight: 1 },
      { factor: 'Multi-jurisdiction operations', detail: 'Operations across four EU states.', weight: 2 },
    ],
    openedHoursAgo: 300,
    modifiedHoursAgo: 88,
    decisionReason: 'Enhanced due diligence completed, ownership fully evidenced.',
  },
  {
    ref: 'KYC-2053',
    customerId: 'cus_vaughn',
    name: 'Marcus Vaughn',
    subjectType: 'individual',
    country: 'United States',
    identifier: '1975-12-14',
    stage: 'rejected',
    risk: 'high',
    reviewerId: 'usr_amara',
    missingDocuments: [1, 3],
    riskFactors: [
      { factor: 'Confirmed sanctions match', detail: 'Exact match on a consolidated sanctions list.', weight: 5 },
      { factor: 'Unverifiable address', detail: 'Address documents failed authenticity checks.', weight: 4 },
    ],
    openedHoursAgo: 340,
    modifiedHoursAgo: 102,
    decisionReason: 'Confirmed sanctions list match; onboarding cannot proceed.',
  },
  {
    ref: 'KYC-2054',
    customerId: 'cus_solstice',
    name: 'Solstice Crypto Exchange',
    subjectType: 'organisation',
    country: 'Malta',
    identifier: 'MT-C-88104',
    stage: 'rejected',
    risk: 'high',
    reviewerId: 'usr_liu',
    missingDocuments: [2, 4],
    riskFactors: [
      { factor: 'Unlicensed activity', detail: 'No VASP licence held in the operating market.', weight: 5 },
      { factor: 'Opaque beneficial ownership', detail: 'UBO declaration incomplete after two requests.', weight: 4 },
    ],
    openedHoursAgo: 380,
    modifiedHoursAgo: 130,
    decisionReason: 'Beneficial ownership could not be established after two information requests.',
  },
];

const CASE_KYC_STATUS: Record<CaseStage, KycStatus> = {
  capture: 'in_review',
  enrichment: 'in_review',
  due_diligence: 'in_review',
  fulfilment: 'in_review',
  approved: 'approved',
  rejected: 'rejected',
};

interface RefundFixture {
  ref: string;
  customerId: string;
  amountCents: number;
  reasonCode: RefundReasonCode;
  channel: RefundChannel;
  status: RefundStatus;
  requestedById: string;
  firstApproverId: string | null;
  secondApproverId: string | null;
  rejectionReason: string | null;
  createdHoursAgo: number;
  /** What the customer originally paid; never less than the refund. */
  transactionAmountCents: number;
  transactionDescription: string;
}

const REFUNDS: RefundFixture[] = [
  { ref: 'RFD-5001', customerId: 'cus_hartley', amountCents: 2450, reasonCode: 'duplicate_charge', channel: 'card', status: 'requested', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 4, transactionAmountCents: 2450, transactionDescription: 'Monthly account fee' },
  { ref: 'RFD-5002', customerId: 'cus_navarro', amountCents: 18900, reasonCode: 'service_not_received', channel: 'card', status: 'requested', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 9, transactionAmountCents: 24900, transactionDescription: 'Premium support subscription' },
  { ref: 'RFD-5003', customerId: 'cus_petrov', amountCents: 125000, reasonCode: 'fraud', channel: 'card', status: 'under_review', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 14, transactionAmountCents: 125000, transactionDescription: 'Card payment to unrecognised merchant' },
  { ref: 'RFD-5004', customerId: 'cus_harbourline', amountCents: 640000, reasonCode: 'service_not_received', channel: 'bank_transfer', status: 'under_review', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: null, rejectionReason: null, createdHoursAgo: 18, transactionAmountCents: 640000, transactionDescription: 'Freight settlement, cancelled sailing' },
  { ref: 'RFD-5005', customerId: 'cus_castille', amountCents: 512000, reasonCode: 'price_adjustment', channel: 'bank_transfer', status: 'under_review', requestedById: 'usr_priya', firstApproverId: 'usr_liu', secondApproverId: null, rejectionReason: null, createdHoursAgo: 22, transactionAmountCents: 1280000, transactionDescription: 'Quarterly fit-out invoice' },
  { ref: 'RFD-5006', customerId: 'cus_petrov', amountCents: 7300, reasonCode: 'goodwill', channel: 'wallet', status: 'approved', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: null, rejectionReason: null, createdHoursAgo: 30, transactionAmountCents: 7300, transactionDescription: 'Expedited transfer fee' },
  { ref: 'RFD-5007', customerId: 'cus_harbourline', amountCents: 98000, reasonCode: 'duplicate_charge', channel: 'direct_debit', status: 'approved', requestedById: 'usr_priya', firstApproverId: 'usr_liu', secondApproverId: null, rejectionReason: null, createdHoursAgo: 36, transactionAmountCents: 98000, transactionDescription: 'Duplicated monthly haulage direct debit' },
  { ref: 'RFD-5008', customerId: 'cus_petrov', amountCents: 750000, reasonCode: 'fraud', channel: 'bank_transfer', status: 'approved', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: 'usr_liu', rejectionReason: null, createdHoursAgo: 44, transactionAmountCents: 750000, transactionDescription: 'Disputed outbound transfer' },
  { ref: 'RFD-5009', customerId: 'cus_harbourline', amountCents: 1250, reasonCode: 'goodwill', channel: 'card', status: 'settled', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: null, rejectionReason: null, createdHoursAgo: 60, transactionAmountCents: 6250, transactionDescription: 'Late payment charge' },
  { ref: 'RFD-5010', customerId: 'cus_petrov', amountCents: 43200, reasonCode: 'price_adjustment', channel: 'card', status: 'settled', requestedById: 'usr_priya', firstApproverId: 'usr_liu', secondApproverId: null, rejectionReason: null, createdHoursAgo: 72, transactionAmountCents: 216000, transactionDescription: 'Annual plan, mid-term downgrade' },
  { ref: 'RFD-5011', customerId: 'cus_harbourline', amountCents: 880000, reasonCode: 'service_not_received', channel: 'bank_transfer', status: 'settled', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: 'usr_liu', rejectionReason: null, createdHoursAgo: 96, transactionAmountCents: 880000, transactionDescription: 'Undelivered warehousing contract' },
  { ref: 'RFD-5012', customerId: 'cus_vaughn', amountCents: 26000, reasonCode: 'fraud', channel: 'card', status: 'rejected', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: 'Chargeback already recovered the full amount from the acquirer.', createdHoursAgo: 110, transactionAmountCents: 26000, transactionDescription: 'Card payment disputed by the cardholder' },
  { ref: 'RFD-5013', customerId: 'cus_solstice', amountCents: 410000, reasonCode: 'duplicate_charge', channel: 'wallet', status: 'requested', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 12, transactionAmountCents: 410000, transactionDescription: 'Duplicated wallet top-up' },
  { ref: 'RFD-5014', customerId: 'cus_okafor', amountCents: 9900, reasonCode: 'goodwill', channel: 'wallet', status: 'requested', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 16, transactionAmountCents: 9900, transactionDescription: 'Cross-border transfer fee' },
  { ref: 'RFD-5015', customerId: 'cus_navarro', amountCents: 305000, reasonCode: 'price_adjustment', channel: 'bank_transfer', status: 'rejected', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: 'Adjustment already applied on the original invoice.', createdHoursAgo: 130, transactionAmountCents: 915000, transactionDescription: 'Relocation services invoice' },
  { ref: 'RFD-5016', customerId: 'cus_castille', amountCents: 62000, reasonCode: 'service_not_received', channel: 'direct_debit', status: 'under_review', requestedById: 'usr_priya', firstApproverId: null, secondApproverId: null, rejectionReason: null, createdHoursAgo: 20, transactionAmountCents: 62000, transactionDescription: 'Showroom installation call-out' },
  { ref: 'RFD-5017', customerId: 'cus_okafor', amountCents: 240000, reasonCode: 'fraud', channel: 'card', status: 'under_review', requestedById: 'usr_priya', firstApproverId: 'usr_amara', secondApproverId: null, rejectionReason: null, createdHoursAgo: 26, transactionAmountCents: 240000, transactionDescription: 'Disputed card-not-present payment' },
];

const FLAGS: {
  key: string;
  description: string;
  owner: string;
  values: Record<'dev' | 'staging' | 'prod', boolean>;
}[] = [
  {
    key: 'kyc.enhanced_due_diligence',
    description: 'Route high-risk cases through the enhanced due diligence checklist.',
    owner: 'Compliance',
    values: { dev: true, staging: true, prod: false },
  },
  {
    key: 'kyc.bulk_assignment',
    description: 'Allow reviewers to be assigned to several cases at once.',
    owner: 'Compliance',
    values: { dev: true, staging: false, prod: false },
  },
  {
    key: 'refunds.second_approver',
    description: 'Require a second approver above the refund threshold.',
    owner: 'Payments',
    values: { dev: true, staging: true, prod: true },
  },
  {
    key: 'refunds.require_kyc_approval',
    description: 'Require an approved KYC case on the customer before a refund is approved.',
    owner: 'Compliance',
    values: { dev: false, staging: false, prod: false },
  },
  {
    key: 'platform.dev_user_switcher',
    description: 'Expose the development-only actor switcher in the nav shell.',
    owner: 'Platform',
    values: { dev: true, staging: false, prod: false },
  },
];

interface RefundEventRow {
  id: string;
  refundId: string;
  actorId: string;
  type: RefundEventType;
  fromStatus: RefundStatus | null;
  toStatus: RefundStatus | null;
  note: string | null;
  createdAt: Date;
}

/** Rebuilds the history that would have produced a refund fixture's current state. */
function refundTimelineFor(fixture: RefundFixture, refundId: string): RefundEventRow[] {
  const events: RefundEventRow[] = [];
  let previous: RefundStatus = 'requested';
  let hoursAgo = fixture.createdHoursAgo;

  function push(
    actorId: string,
    type: RefundEventType,
    toStatus: RefundStatus | null,
    note: string | null,
  ): void {
    events.push({
      id: `rev_${refundId}_${events.length + 1}`,
      refundId,
      actorId,
      type,
      fromStatus: events.length === 0 ? null : previous,
      toStatus,
      note,
      createdAt: at(-hoursAgo),
    });
    if (toStatus) previous = toStatus;
    hoursAgo = Math.max(hoursAgo - 2, 0);
  }

  push(fixture.requestedById, 'refund_requested', 'requested', 'Raised from a customer contact.');

  if (fixture.status !== 'requested') {
    push(fixture.firstApproverId ?? fixture.requestedById, 'review_started', 'under_review', null);
  }

  if (fixture.firstApproverId) {
    push(fixture.firstApproverId, 'first_approval_recorded', null, 'First approval recorded.');
  }

  if (fixture.status === 'approved' || fixture.status === 'settled') {
    const approver = fixture.secondApproverId ?? fixture.firstApproverId;
    if (approver) push(approver, 'refund_approved', 'approved', null);
  }

  if (fixture.status === 'settled') {
    push(fixture.firstApproverId ?? fixture.requestedById, 'refund_settled', 'settled', 'Funds returned to the customer.');
  }

  if (fixture.status === 'rejected') {
    push(fixture.firstApproverId ?? 'usr_amara', 'refund_rejected', 'rejected', fixture.rejectionReason);
  }

  return events;
}

function documentTypesFor(subjectType: SubjectType): string[] {
  return subjectType === 'individual' ? INDIVIDUAL_DOCUMENTS : ORGANISATION_DOCUMENTS;
}

/** Deterministic fixture load. Assumes an empty, migrated database. */
export function seedDatabase(db: DatabaseWriter): void {
  db.insert(users)
    .values(USERS.map((user) => ({ ...user, createdAt: at(-720) })))
    .run();

  db.insert(customers)
    .values(
      CASES.map((fixture) => ({
        id: fixture.customerId,
        name: fixture.name,
        subjectType: fixture.subjectType,
        email: `${fixture.customerId.replace('cus_', '')}@example.com`,
        country: fixture.country,
        dateOfBirth: fixture.subjectType === 'individual' ? fixture.identifier : null,
        registrationNumber: fixture.subjectType === 'organisation' ? fixture.identifier : null,
        kycStatus: CASE_KYC_STATUS[fixture.stage],
        createdAt: at(-fixture.openedHoursAgo - 24),
      })),
    )
    .run();

  db.insert(kycCases)
    .values(
      CASES.map((fixture, index) => ({
        id: `kyc_${index + 1}`,
        caseRef: fixture.ref,
        customerId: fixture.customerId,
        stage: fixture.stage,
        riskRating: fixture.risk,
        assignedReviewerId: fixture.reviewerId,
        decisionReason: fixture.decisionReason ?? null,
        openedAt: at(-fixture.openedHoursAgo),
        modifiedAt: at(-fixture.modifiedHoursAgo),
      })),
    )
    .run();

  const documentRows = CASES.flatMap((fixture, caseIndex) =>
    documentTypesFor(fixture.subjectType).map((documentType, documentIndex) => {
      const status: DocumentStatus = fixture.missingDocuments.includes(documentIndex)
        ? 'missing'
        : 'verified';
      return {
        id: `doc_${caseIndex + 1}_${documentIndex + 1}`,
        caseId: `kyc_${caseIndex + 1}`,
        documentType,
        status,
        verifiedAt: status === 'verified' ? at(-fixture.modifiedHoursAgo - 1) : null,
        verifiedById: status === 'verified' ? (fixture.reviewerId ?? 'usr_amara') : null,
      };
    }),
  );
  db.insert(kycDocuments).values(documentRows).run();

  const riskFactorRows = CASES.flatMap((fixture, caseIndex) =>
    fixture.riskFactors.map((factor, factorIndex) => ({
      id: `rsk_${caseIndex + 1}_${factorIndex + 1}`,
      caseId: `kyc_${caseIndex + 1}`,
      factor: factor.factor,
      detail: factor.detail,
      weight: factor.weight,
    })),
  );
  db.insert(kycRiskFactors).values(riskFactorRows).run();

  const eventRows = CASES.flatMap((fixture, caseIndex) => {
    const caseId = `kyc_${caseIndex + 1}`;
    const actorId = fixture.reviewerId ?? 'usr_amara';
    const events: {
      id: string;
      caseId: string;
      actorId: string;
      type: CaseEventType;
      fromStage: CaseStage | null;
      toStage: CaseStage | null;
      note: string | null;
      createdAt: Date;
    }[] = [
      {
        id: `evt_${caseId}_1`,
        caseId,
        actorId: 'usr_priya',
        type: 'case_opened',
        fromStage: null,
        toStage: 'capture',
        note: 'Case opened from the onboarding application.',
        createdAt: at(-fixture.openedHoursAgo),
      },
    ];

    if (fixture.reviewerId) {
      events.push({
        id: `evt_${caseId}_2`,
        caseId,
        actorId: 'usr_priya',
        type: 'reviewer_assigned',
        fromStage: null,
        toStage: null,
        note: 'Assigned during intake triage.',
        createdAt: at(-fixture.openedHoursAgo + 1),
      });
    }

    if (fixture.stage !== 'capture') {
      events.push({
        id: `evt_${caseId}_3`,
        caseId,
        actorId,
        type: 'stage_advanced',
        fromStage: 'capture',
        toStage: 'enrichment',
        note: null,
        createdAt: at(-fixture.modifiedHoursAgo - 6),
      });
    }

    if (fixture.missingDocuments.length > 0 && fixture.stage !== 'capture') {
      events.push({
        id: `evt_${caseId}_4`,
        caseId,
        actorId,
        type: 'information_requested',
        fromStage: null,
        toStage: null,
        note: 'Outstanding documents requested from the subject.',
        createdAt: at(-fixture.modifiedHoursAgo - 3),
      });
    }

    if (fixture.stage === 'approved' || fixture.stage === 'rejected') {
      events.push({
        id: `evt_${caseId}_5`,
        caseId,
        actorId,
        type: fixture.stage === 'approved' ? 'case_approved' : 'case_rejected',
        fromStage: 'fulfilment',
        toStage: fixture.stage,
        note: fixture.decisionReason ?? null,
        createdAt: at(-fixture.modifiedHoursAgo),
      });
    }

    return events;
  });
  db.insert(kycCaseEvents).values(eventRows).run();

  db.insert(transactions)
    .values(
      REFUNDS.map((fixture, index) => ({
        id: `txn_${index + 1}`,
        transactionRef: `TXN-${8100 + index}`,
        customerId: fixture.customerId,
        amountCents: fixture.transactionAmountCents,
        currency: 'EUR',
        channel: fixture.channel,
        description: fixture.transactionDescription,
        occurredAt: at(-fixture.createdHoursAgo - 48),
      })),
    )
    .run();

  const refundEventRows = REFUNDS.flatMap((fixture, index) =>
    refundTimelineFor(fixture, `rfd_${index + 1}`),
  );

  db.insert(refundRequests)
    .values(
      REFUNDS.map((fixture, index) => ({
        id: `rfd_${index + 1}`,
        refundRef: fixture.ref,
        customerId: fixture.customerId,
        transactionId: `txn_${index + 1}`,
        amountCents: fixture.amountCents,
        currency: 'EUR',
        reasonCode: fixture.reasonCode,
        channel: fixture.channel,
        status: fixture.status,
        requestedById: fixture.requestedById,
        firstApproverId: fixture.firstApproverId,
        secondApproverId: fixture.secondApproverId,
        rejectionReason: fixture.rejectionReason,
        createdAt: at(-fixture.createdHoursAgo),
        modifiedAt:
          refundEventRows
            .filter((event) => event.refundId === `rfd_${index + 1}`)
            .at(-1)?.createdAt ?? at(-fixture.createdHoursAgo),
      })),
    )
    .run();

  db.insert(refundEvents).values(refundEventRows).run();

  db.insert(featureFlags)
    .values(
      FLAGS.flatMap((flag, flagIndex) =>
        (['dev', 'staging', 'prod'] as const).map((environment, envIndex) => ({
          id: `flg_${flagIndex + 1}_${envIndex + 1}`,
          key: flag.key,
          description: flag.description,
          owner: flag.owner,
          environment,
          enabled: flag.values[environment],
          updatedAt: at(-24),
        })),
      ),
    )
    .run();

  const actorById = new Map(USERS.map((user) => [user.id, user] as const));
  recordAuditEntriesSync(
    db,
    eventRows
      .filter((event) => event.type !== 'case_opened')
      .map((event) => ({
        actor: actorById.get(event.actorId) ?? USERS[0],
        action: `kyc.${event.type}`,
        entityType: 'kyc_case',
        entityId: event.caseId,
        before: event.fromStage === null ? null : { stage: event.fromStage },
        after: event.toStage === null ? { note: event.note } : { stage: event.toStage, note: event.note },
        at: event.createdAt,
      })),
  );

  recordAuditEntriesSync(
    db,
    refundEventRows
      .filter((event) => event.type !== 'refund_requested')
      .map((event) => ({
        actor: actorById.get(event.actorId) ?? USERS[0],
        action: `refund.${event.type}`,
        entityType: 'refund_request',
        entityId: event.refundId,
        before: event.fromStatus === null ? null : { status: event.fromStatus },
        after:
          event.toStatus === null
            ? { note: event.note }
            : { status: event.toStatus, note: event.note },
        at: event.createdAt,
      })),
  );
}
