import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase, type AppDatabase } from '@/lib/db/client';
import { seedDatabase } from '@/lib/db/seed';
import { customers, kycCases, refundEvents, refundRequests } from '@/lib/db/schema';
import { listAuditEntriesForEntity } from '@/lib/audit';
import { setFlagValue } from '@/lib/flags/service';
import { currentEnvironment } from '@/lib/flags/queries';
import { approveCase } from '@/lib/kyc/service';
import { REQUIRE_KYC_APPROVAL_FLAG } from '@/lib/rules';
import {
  addRefundNote,
  approveRefund,
  rejectRefund,
  requestRefundInformation,
} from '@/lib/refunds/service';
import { REFUND_ENTITY_TYPE } from '@/lib/refunds/queries';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_amara', name: 'Amara Osei', role: 'compliance_analyst' };
const otherAnalyst: Actor = { id: 'usr_liu', name: 'Liu Chen', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_priya', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_tom', name: 'Tom Becker', role: 'engineer' };
const admin: Actor = { id: 'usr_nadia', name: 'Nadia Faraj', role: 'admin' };

let db: AppDatabase;

async function refundIdByRef(ref: string): Promise<string> {
  const [row] = await db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.refundRef, ref))
    .limit(1);
  if (!row) throw new Error(`Fixture refund ${ref} is missing`);
  return row.id;
}

async function refundByRef(ref: string) {
  const [row] = await db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.refundRef, ref))
    .limit(1);
  return row!;
}

async function auditCount(refundId: string): Promise<number> {
  return (await listAuditEntriesForEntity(db, REFUND_ENTITY_TYPE, refundId)).length;
}

beforeEach(() => {
  db = createInMemoryDatabase();
  seedDatabase(db);
});

describe('seed fixtures', () => {
  it('covers every refund state and both sides of the second-approver threshold', async () => {
    const rows = await db.select().from(refundRequests);
    expect(new Set(rows.map((row) => row.status))).toEqual(
      new Set(['requested', 'under_review', 'approved', 'settled', 'rejected']),
    );
    expect(rows.some((row) => row.amountCents >= 100_000)).toBe(true);
    expect(rows.some((row) => row.amountCents < 100_000)).toBe(true);
    expect(
      rows.some((row) => row.firstApproverId !== null && row.secondApproverId === null),
    ).toBe(true);
    expect(rows.every((row) => row.transactionId.length > 0)).toBe(true);
  });
});

describe('approveRefund', () => {
  it('approves a refund below the threshold on a single approval', async () => {
    const refundId = await refundIdByRef('RFD-5001');
    const before = await auditCount(refundId);

    const result = await approveRefund(db, agent, refundId);

    expect(result.allowed).toBe(true);
    const row = await refundByRef('RFD-5001');
    expect(row.status).toBe('approved');
    expect(row.firstApproverId).toBe(agent.id);
    expect(await auditCount(refundId)).toBe(before + 1);
  });

  it('records only the first approval above the threshold, then completes on a different approver', async () => {
    const refundId = await refundIdByRef('RFD-5013');

    const first = await approveRefund(db, analyst, refundId);
    expect(first.allowed).toBe(true);
    let row = await refundByRef('RFD-5013');
    expect(row.status).toBe('under_review');
    expect(row.firstApproverId).toBe(analyst.id);
    expect(row.secondApproverId).toBeNull();

    const sameUser = await approveRefund(db, analyst, refundId);
    expect(sameUser.allowed).toBe(false);
    expect(sameUser.reason).toContain('a different approver must complete it');
    row = await refundByRef('RFD-5013');
    expect(row.status).toBe('under_review');

    const second = await approveRefund(db, otherAnalyst, refundId);
    expect(second.allowed).toBe(true);
    row = await refundByRef('RFD-5013');
    expect(row.status).toBe('approved');
    expect(row.secondApproverId).toBe(otherAnalyst.id);

    const events = await db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.refundId, refundId));
    expect(events.some((event) => event.type === 'first_approval_recorded')).toBe(true);
    expect(events.some((event) => event.type === 'refund_approved')).toBe(true);
  });

  it('writes nothing when the rule denies', async () => {
    const refundId = await refundIdByRef('RFD-5001');
    const before = await auditCount(refundId);

    const result = await approveRefund(db, engineer, refundId);

    expect(result.allowed).toBe(false);
    expect((await refundByRef('RFD-5001')).status).toBe('requested');
    expect(await auditCount(refundId)).toBe(before);
  });
});

describe('rejectRefund', () => {
  it('rejects with a reason and stores it on the refund', async () => {
    const refundId = await refundIdByRef('RFD-5002');
    const result = await rejectRefund(db, agent, refundId, 'Service was delivered and signed for.');

    expect(result.allowed).toBe(true);
    const row = await refundByRef('RFD-5002');
    expect(row.status).toBe('rejected');
    expect(row.rejectionReason).toBe('Service was delivered and signed for.');
  });

  it('denies rejection without a reason and writes nothing', async () => {
    const refundId = await refundIdByRef('RFD-5002');
    const before = await auditCount(refundId);

    const result = await rejectRefund(db, agent, refundId, '');

    expect(result.allowed).toBe(false);
    expect((await refundByRef('RFD-5002')).status).toBe('requested');
    expect(await auditCount(refundId)).toBe(before);
  });
});

describe('requestRefundInformation', () => {
  it('lets the second approver ask before completing a high-value approval', async () => {
    const refundId = await refundIdByRef('RFD-5004');
    const result = await requestRefundInformation(
      db,
      otherAnalyst,
      refundId,
      'Please attach the merchant receipt.',
    );

    expect(result.allowed).toBe(true);
    expect((await refundByRef('RFD-5004')).status).toBe('under_review');
    const events = await db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.refundId, refundId));
    expect(
      events.some(
        (event) =>
          event.type === 'information_requested' &&
          event.note === 'Please attach the merchant receipt.',
      ),
    ).toBe(true);
  });

  it('denies an empty request', async () => {
    const refundId = await refundIdByRef('RFD-5004');
    const result = await requestRefundInformation(db, otherAnalyst, refundId, '');
    expect(result.allowed).toBe(false);
  });

  it('denies a refund that needs only one approval', async () => {
    const refundId = await refundIdByRef('RFD-5001');
    const result = await requestRefundInformation(db, agent, refundId, 'Any receipt?');

    expect(result.allowed).toBe(false);
    expect((await refundByRef('RFD-5001')).status).toBe('requested');
  });

  it('denies the approver who recorded the first approval', async () => {
    const refundId = await refundIdByRef('RFD-5004');
    const result = await requestRefundInformation(db, analyst, refundId, 'Any receipt?');

    expect(result.allowed).toBe(false);
  });
});

describe('the seeded refund timelines', () => {
  it('records a first approval only where two approvals are needed', async () => {
    const lowValue = await refundIdByRef('RFD-5006');
    const highValue = await refundIdByRef('RFD-5008');

    const typesFor = async (refundId: string) =>
      (await db.select().from(refundEvents).where(eq(refundEvents.refundId, refundId))).map(
        (event) => event.type,
      );

    expect(await typesFor(lowValue)).not.toContain('first_approval_recorded');
    expect(await typesFor(lowValue)).toContain('refund_approved');
    expect(await typesFor(highValue)).toContain('first_approval_recorded');
    expect(await typesFor(highValue)).toContain('refund_approved');
  });
});

describe('addRefundNote', () => {
  it('appends an internal note without changing the state', async () => {
    const refundId = await refundIdByRef('RFD-5003');
    const result = await addRefundNote(db, analyst, refundId, 'Customer called to chase this.');

    expect(result.allowed).toBe(true);
    expect((await refundByRef('RFD-5003')).status).toBe('under_review');
    const events = await db
      .select()
      .from(refundEvents)
      .where(eq(refundEvents.refundId, refundId));
    expect(events.some((event) => event.type === 'note_added')).toBe(true);
  });

  it('denies a note from someone who may not work refunds', async () => {
    const refundId = await refundIdByRef('RFD-5003');
    const result = await addRefundNote(db, engineer, refundId, 'Looks fine to me.');
    expect(result.allowed).toBe(false);
  });
});

describe('refunds.require_kyc_approval', () => {
  async function turnFlagOn(): Promise<void> {
    const result = await setFlagValue(db, admin, REQUIRE_KYC_APPROVAL_FLAG, currentEnvironment(), true);
    expect(result.allowed).toBe(true);
  }

  it('approves regardless of KYC state while the flag is off', async () => {
    const refundId = await refundIdByRef('RFD-5001');
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, 'cus_hartley'))
      .limit(1);
    expect(customer!.kycStatus).not.toBe('approved');

    const result = await approveRefund(db, agent, refundId);
    expect(result.allowed).toBe(true);
    expect((await refundByRef('RFD-5001')).status).toBe('approved');
  });

  it('blocks approval for a customer whose KYC is not approved, writing nothing', async () => {
    await turnFlagOn();
    const refundId = await refundIdByRef('RFD-5001');
    const before = await auditCount(refundId);

    const result = await approveRefund(db, agent, refundId);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("the customer's KYC is");
    expect(result.reason).toContain(REQUIRE_KYC_APPROVAL_FLAG);
    expect((await refundByRef('RFD-5001')).status).toBe('requested');
    expect(await auditCount(refundId)).toBe(before);
  });

  it('unblocks the moment the customer KYC case is approved, with no stored state', async () => {
    await turnFlagOn();
    const refundId = await refundIdByRef('RFD-5002');
    const [kycCase] = await db
      .select()
      .from(kycCases)
      .where(eq(kycCases.caseRef, 'KYC-2049'))
      .limit(1);

    expect((await approveRefund(db, agent, refundId)).allowed).toBe(false);
    expect((await approveCase(db, analyst, kycCase!.id)).allowed).toBe(true);

    const result = await approveRefund(db, agent, refundId);
    expect(result.allowed).toBe(true);
    expect((await refundByRef('RFD-5002')).status).toBe('approved');
  });

  it('approves an already-KYC-approved customer while the flag is on', async () => {
    await turnFlagOn();
    const refundId = await refundIdByRef('RFD-5003');
    expect((await approveRefund(db, analyst, refundId)).allowed).toBe(true);
  });
});

describe('KYC and refunds share one customer record', () => {
  it('shows a KYC approval on the refund customer with no sync step, and audits both actions', async () => {
    const [kycCase] = await db
      .select()
      .from(kycCases)
      .where(eq(kycCases.caseRef, 'KYC-2049'))
      .limit(1);
    const customerId = kycCase!.customerId;

    const refundRows = await db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.customerId, customerId));
    expect(refundRows.length).toBeGreaterThan(0);
    const refund = refundRows.find((row) => row.status === 'requested')!;

    const [before] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    expect(before!.kycStatus).not.toBe('approved');

    const kycDecision = await approveCase(db, analyst, kycCase!.id);
    expect(kycDecision.allowed).toBe(true);

    // Refunds reads the same customers row, so the decision is visible at once.
    const [customerRow] = await db
      .select({ kycStatus: customers.kycStatus })
      .from(refundRequests)
      .innerJoin(customers, eq(refundRequests.customerId, customers.id))
      .where(eq(refundRequests.id, refund.id))
      .limit(1);
    expect(customerRow!.kycStatus).toBe('approved');

    const refundDecision = await approveRefund(db, analyst, refund.id);
    expect(refundDecision.allowed).toBe(true);

    const kycAudit = await listAuditEntriesForEntity(db, 'kyc_case', kycCase!.id);
    const refundAudit = await listAuditEntriesForEntity(db, REFUND_ENTITY_TYPE, refund.id);
    expect(kycAudit.some((entry) => entry.action === 'kyc.case.approved')).toBe(true);
    expect(
      refundAudit.some(
        (entry) => entry.action === 'refund.approved' || entry.action === 'refund.first_approval_recorded',
      ),
    ).toBe(true);
  });
});
