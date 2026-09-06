import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createInMemoryDatabase, type AppDatabase } from "@/lib/db/client";
import { seedDatabase } from "@/lib/db/seed";
import { kycCaseEvents, kycCases, kycDocuments } from "@/lib/db/schema";
import { listAuditEntriesForEntity } from "@/lib/audit";
import type { Actor } from "@/lib/rules/types";

/**
 * Document verification evaluates its rule against a case snapshot loaded
 * before the write, so a decision that commits in that window must not be
 * followed by a verification. The hook below stands in for that window: it
 * fires between the rule check and the transaction, closing the case exactly
 * as a rejection does (SQLite writes serially, so the two cannot truly
 * overlap in-process).
 */
const interleaved = vi.hoisted(() => ({ run: null as null | (() => void) }));

vi.mock("@/lib/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rules")>();
  return {
    ...actual,
    canVerifyDocument: (
      ...args: Parameters<typeof actual.canVerifyDocument>
    ) => {
      const result = actual.canVerifyDocument(...args);
      interleaved.run?.();
      return result;
    },
  };
});

const { verifyDocument } = await import("@/lib/kyc/service");

const analyst: Actor = {
  id: "usr_amara",
  name: "Amara Osei",
  role: "compliance_analyst",
};

let db: AppDatabase;

beforeEach(() => {
  db = createInMemoryDatabase();
  seedDatabase(db);
  interleaved.run = null;
});

describe("verifyDocument racing a case decision", () => {
  it("denies the verification and leaves the closed case untouched", async () => {
    const [openCase] = await db
      .select()
      .from(kycCases)
      .where(eq(kycCases.caseRef, "KYC-2045"))
      .limit(1);
    const caseId = openCase!.id;

    const documents = await db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.caseId, caseId));
    const document = documents.find((row) => row.status === "missing")!;
    const auditsBefore = (
      await listAuditEntriesForEntity(db, "kyc_case", caseId)
    ).length;
    const eventsBefore = (
      await db
        .select()
        .from(kycCaseEvents)
        .where(eq(kycCaseEvents.caseId, caseId))
    ).length;
    const decidedAt = new Date(openCase!.modifiedAt.getTime() + 1000);

    interleaved.run = () => {
      db.update(kycCases)
        .set({
          stage: "rejected",
          decisionReason: "Confirmed sanctions list match",
          modifiedAt: decidedAt,
        })
        .where(eq(kycCases.id, caseId))
        .run();
    };

    const result = await verifyDocument(db, analyst, caseId, document.id);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("changed while you were working on it");

    const [row] = await db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.id, document.id))
      .limit(1);
    expect(row!.status).toBe("missing");

    const [after] = await db
      .select()
      .from(kycCases)
      .where(eq(kycCases.id, caseId))
      .limit(1);
    expect(after!.stage).toBe("rejected");
    expect(after!.modifiedAt.getTime()).toBe(decidedAt.getTime());

    const events = await db
      .select()
      .from(kycCaseEvents)
      .where(eq(kycCaseEvents.caseId, caseId));
    expect(events.length).toBe(eventsBefore);
    expect(
      (await listAuditEntriesForEntity(db, "kyc_case", caseId)).length,
    ).toBe(auditsBefore);
  });
});
