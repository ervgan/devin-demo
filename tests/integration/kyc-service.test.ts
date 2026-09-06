import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createInMemoryDatabase, type AppDatabase } from '@/lib/db/client';
import { seedDatabase } from '@/lib/db/seed';
import {
  auditLog,
  customers,
  kycCaseEvents,
  kycCases,
  kycDocuments,
  users,
} from '@/lib/db/schema';
import { listAuditEntriesForEntity } from '@/lib/audit';
import {
  advanceCase,
  approveCase,
  assignReviewer,
  rejectCase,
  requestInformation,
  verifyDocument,
} from '@/lib/kyc/service';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_amara', name: 'Amara Osei', role: 'compliance_analyst' };
const otherAnalyst: Actor = { id: 'usr_liu', name: 'Liu Chen', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_priya', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_tom', name: 'Tom Becker', role: 'engineer' };

let db: AppDatabase;

async function caseIdByRef(ref: string): Promise<string> {
  const [row] = await db.select().from(kycCases).where(eq(kycCases.caseRef, ref)).limit(1);
  if (!row) throw new Error(`Fixture case ${ref} is missing`);
  return row.id;
}

async function stageOf(caseId: string): Promise<string> {
  const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
  return row!.stage;
}

async function auditCount(caseId: string): Promise<number> {
  return (await listAuditEntriesForEntity(db, 'kyc_case', caseId)).length;
}

beforeEach(() => {
  db = createInMemoryDatabase();
  seedDatabase(db);
});

describe('seed fixtures', () => {
  it('covers every stage, both subject types and every risk rating', async () => {
    const rows = await db.select().from(kycCases);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(new Set(rows.map((row) => row.stage))).toEqual(
      new Set(['capture', 'enrichment', 'due_diligence', 'fulfilment', 'approved', 'rejected']),
    );
    expect(new Set(rows.map((row) => row.riskRating))).toEqual(new Set(['low', 'medium', 'high']));

    const subjects = await db.select().from(customers);
    expect(new Set(subjects.map((row) => row.subjectType))).toEqual(
      new Set(['individual', 'organisation']),
    );

    const documents = await db.select().from(kycDocuments);
    expect(new Set(documents.map((row) => row.status))).toEqual(new Set(['verified', 'missing']));
  });
});

describe('advanceCase', () => {
  it('moves an open case forward, records a timeline event and an audit entry', async () => {
    const caseId = await caseIdByRef('KYC-2041');
    const before = await auditCount(caseId);

    const result = await advanceCase(db, analyst, caseId);

    expect(result.allowed).toBe(true);
    expect(await stageOf(caseId)).toBe('enrichment');
    expect(await auditCount(caseId)).toBe(before + 1);

    const events = await db.select().from(kycCaseEvents).where(eq(kycCaseEvents.caseId, caseId));
    expect(events.some((event) => event.type === 'stage_advanced' && event.toStage === 'enrichment')).toBe(
      true,
    );
  });

  it('leaves the case untouched when the rule denies', async () => {
    const caseId = await caseIdByRef('KYC-2041');
    const before = await auditCount(caseId);

    const result = await advanceCase(db, engineer, caseId);

    expect(result.allowed).toBe(false);
    expect(await stageOf(caseId)).toBe('capture');
    expect(await auditCount(caseId)).toBe(before);
  });

  it('denies advancing out of Due Diligence while documents are missing', async () => {
    const caseId = await caseIdByRef('KYC-2047');
    const result = await advanceCase(db, analyst, caseId);
    expect(result.allowed).toBe(false);
    expect(await stageOf(caseId)).toBe('due_diligence');
  });
});

describe('requestInformation', () => {
  it('records the reason on the timeline', async () => {
    const caseId = await caseIdByRef('KYC-2043');
    const result = await requestInformation(
      db,
      analyst,
      caseId,
      'Source of funds evidence missing',
    );

    expect(result.allowed).toBe(true);
    const events = await db.select().from(kycCaseEvents).where(eq(kycCaseEvents.caseId, caseId));
    expect(
      events.some(
        (event) =>
          event.type === 'information_requested' &&
          event.note === 'Source of funds evidence missing',
      ),
    ).toBe(true);
  });

  it('denies and writes nothing when no reason is given', async () => {
    const caseId = await caseIdByRef('KYC-2043');
    const before = await auditCount(caseId);

    const result = await requestInformation(db, analyst, caseId, '');

    expect(result.allowed).toBe(false);
    expect(await auditCount(caseId)).toBe(before);
  });
});

describe('assignReviewer', () => {
  it('assigns a compliance analyst', async () => {
    const caseId = await caseIdByRef('KYC-2042');
    const result = await assignReviewer(db, analyst, caseId, otherAnalyst.id);

    expect(result.allowed).toBe(true);
    const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    expect(row!.assignedReviewerId).toBe(otherAnalyst.id);
  });

  it('denies assigning a case to someone who is not a compliance analyst', async () => {
    const caseId = await caseIdByRef('KYC-2042');
    const result = await assignReviewer(db, analyst, caseId, engineer.id);

    expect(result.allowed).toBe(false);
    const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    expect(row!.assignedReviewerId).toBeNull();
  });
});

describe('approveCase', () => {
  it('approves a complete case at Fulfilment and updates the shared customer record', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    const result = await approveCase(db, analyst, caseId);

    expect(result.allowed).toBe(true);
    expect(await stageOf(caseId)).toBe('approved');

    const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, row!.customerId))
      .limit(1);
    expect(customer!.kycStatus).toBe('approved');
  });

  it('denies approval by a support agent', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    const result = await approveCase(db, agent, caseId);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Support Agent may not');
    expect(await stageOf(caseId)).toBe('fulfilment');
  });

  it('denies approval of an unassigned case', async () => {
    const caseId = await caseIdByRef('KYC-2050');
    const result = await approveCase(db, analyst, caseId);

    expect(result.allowed).toBe(false);
    expect(await stageOf(caseId)).toBe('fulfilment');
  });
});

describe('rejectCase', () => {
  it('rejects with a reason and stores it on the case', async () => {
    const caseId = await caseIdByRef('KYC-2046');
    const result = await rejectCase(db, analyst, caseId, 'Offshore structure could not be evidenced');

    expect(result.allowed).toBe(true);
    const [row] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    expect(row!.stage).toBe('rejected');
    expect(row!.decisionReason).toBe('Offshore structure could not be evidenced');
  });

  it('denies rejection without a reason', async () => {
    const caseId = await caseIdByRef('KYC-2046');
    const result = await rejectCase(db, analyst, caseId, '');

    expect(result.allowed).toBe(false);
    expect(await stageOf(caseId)).toBe('due_diligence');
  });

  it('denies rejection by an engineer', async () => {
    const caseId = await caseIdByRef('KYC-2046');
    const result = await rejectCase(db, engineer, caseId, 'Not comfortable with this customer');

    expect(result.allowed).toBe(false);
    expect(await stageOf(caseId)).toBe('due_diligence');
  });

  it('denies acting on an already decided case', async () => {
    const caseId = await caseIdByRef('KYC-2053');
    const result = await rejectCase(db, analyst, caseId, 'Duplicate rejection attempt');
    expect(result.allowed).toBe(false);
  });
});

describe('verifyDocument', () => {
  async function missingDocumentOf(caseId: string) {
    const rows = await db.select().from(kycDocuments).where(eq(kycDocuments.caseId, caseId));
    const document = rows.find((row) => row.status === 'missing');
    if (!document) throw new Error('Fixture case has no missing document');
    return document;
  }

  it('verifies a document, stamping the verifier and recording history', async () => {
    const caseId = await caseIdByRef('KYC-2045');
    const document = await missingDocumentOf(caseId);
    const audits = await auditCount(caseId);

    const result = await verifyDocument(db, analyst, caseId, document.id);

    expect(result.allowed).toBe(true);
    const [row] = await db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.id, document.id))
      .limit(1);
    expect(row!.status).toBe('verified');
    expect(row!.verifiedById).toBe(analyst.id);
    expect(row!.verifiedAt).not.toBeNull();
    expect(await auditCount(caseId)).toBe(audits + 1);

    const events = await db.select().from(kycCaseEvents).where(eq(kycCaseEvents.caseId, caseId));
    expect(events.some((event) => event.type === 'document_verified')).toBe(true);
  });

  it('unblocks advancing out of Due Diligence once the checklist is complete', async () => {
    const caseId = await caseIdByRef('KYC-2045');
    expect((await advanceCase(db, analyst, caseId)).allowed).toBe(false);

    const document = await missingDocumentOf(caseId);
    await verifyDocument(db, analyst, caseId, document.id);

    expect((await advanceCase(db, analyst, caseId)).allowed).toBe(true);
    expect(await stageOf(caseId)).toBe('fulfilment');
  });

  it('denies a support agent and leaves the document missing', async () => {
    const caseId = await caseIdByRef('KYC-2045');
    const document = await missingDocumentOf(caseId);
    const audits = await auditCount(caseId);

    const result = await verifyDocument(db, agent, caseId, document.id);

    expect(result.allowed).toBe(false);
    const [row] = await db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.id, document.id))
      .limit(1);
    expect(row!.status).toBe('missing');
    expect(await auditCount(caseId)).toBe(audits);
  });

  it('denies verifying twice', async () => {
    const caseId = await caseIdByRef('KYC-2045');
    const document = await missingDocumentOf(caseId);
    await verifyDocument(db, analyst, caseId, document.id);

    const result = await verifyDocument(db, analyst, caseId, document.id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already verified');
  });

  it('denies a document belonging to another case', async () => {
    const caseId = await caseIdByRef('KYC-2045');
    const otherCaseId = await caseIdByRef('KYC-2043');
    const document = await missingDocumentOf(otherCaseId);

    const result = await verifyDocument(db, analyst, caseId, document.id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Document not found');
  });

  it('denies verifying on a decided case', async () => {
    const caseId = await caseIdByRef('KYC-2054');
    const document = await missingDocumentOf(caseId);

    const result = await verifyDocument(db, analyst, caseId, document.id);
    expect(result.allowed).toBe(false);
  });
});

describe('audit log', () => {
  it('appends rather than replaces, keeping earlier entries intact', async () => {
    const caseId = await caseIdByRef('KYC-2041');
    await advanceCase(db, analyst, caseId);
    await advanceCase(db, analyst, caseId);

    const entries = await listAuditEntriesForEntity(db, 'kyc_case', caseId);
    const advances = entries.filter((entry) => entry.action === 'kyc.case.advanced');
    expect(advances).toHaveLength(2);
    expect(advances.map((entry) => (entry.after as { stage: string }).stage).sort()).toEqual([
      'due_diligence',
      'enrichment',
    ]);
  });

  it('records the acting user and the before and after state', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    await approveCase(db, otherAnalyst, caseId);

    const [latest] = await listAuditEntriesForEntity(db, 'kyc_case', caseId);
    expect(latest!.actorId).toBe(otherAnalyst.id);
    expect(latest!.before).toMatchObject({ stage: 'fulfilment' });
    expect(latest!.after).toMatchObject({ stage: 'approved' });
  });

  it('never writes audit rows for a denied transition', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    const before = (await db.select().from(auditLog)).length;

    await approveCase(db, engineer, caseId);

    expect((await db.select().from(auditLog)).length).toBe(before);
  });
});

describe('transactional writes', () => {
  it('lets only one of two competing decisions on the same case succeed', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    const auditBefore = await auditCount(caseId);

    const [approval, rejection] = await Promise.all([
      approveCase(db, analyst, caseId),
      rejectCase(db, otherAnalyst, caseId, 'Competing rejection decision'),
    ]);

    expect([approval.allowed, rejection.allowed].filter(Boolean)).toHaveLength(1);

    const stage = await stageOf(caseId);
    expect(stage).toBe(approval.allowed ? 'approved' : 'rejected');

    const events = await db.select().from(kycCaseEvents).where(eq(kycCaseEvents.caseId, caseId));
    const decisions = events.filter(
      (event) => event.type === 'case_approved' || event.type === 'case_rejected',
    );
    expect(decisions).toHaveLength(1);
    expect(await auditCount(caseId)).toBe(auditBefore + 1);
  });

  it('rolls back the case and customer when the audit write fails', async () => {
    const caseId = await caseIdByRef('KYC-2049');
    const [before] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    db.run(sql`DROP TABLE audit_log`);

    await expect(approveCase(db, analyst, caseId)).rejects.toThrow();

    const [after] = await db.select().from(kycCases).where(eq(kycCases.id, caseId)).limit(1);
    expect(after!.stage).toBe(before!.stage);
    expect(after!.modifiedAt).toEqual(before!.modifiedAt);

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, before!.customerId))
      .limit(1);
    expect(customer!.kycStatus).not.toBe('approved');

    const events = await db.select().from(kycCaseEvents).where(eq(kycCaseEvents.caseId, caseId));
    expect(events.some((event) => event.type === 'case_approved')).toBe(false);
  });

  it('leaves no partial fixtures when seeding fails part-way', () => {
    const fresh = createInMemoryDatabase();
    fresh.run(sql`DROP TABLE feature_flags`);

    expect(() => fresh.transaction((tx) => seedDatabase(tx))).toThrow();
    expect(fresh.select().from(users).all()).toHaveLength(0);
    expect(fresh.select().from(kycCases).all()).toHaveLength(0);
  });
});
