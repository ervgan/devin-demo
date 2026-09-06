import { and, desc, eq } from 'drizzle-orm';
import { auditLog } from '@/lib/db/schema';
import type { AppDatabase } from '@/lib/db/client';
import type { Actor } from '@/lib/rules/types';

/**
 * The only writer of the audit table. There is no update or delete path here
 * by design: audit rows are append-only.
 */

export interface AuditEntryInput {
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  at?: Date;
}

export interface AuditEntryView {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
}

function serialise(value: Record<string, unknown> | null | undefined): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function parse(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function buildRow(input: AuditEntryInput) {
  return {
    id: `aud_${crypto.randomUUID()}`,
    actorId: input.actor.id,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: serialise(input.before),
    after: serialise(input.after),
    createdAt: input.at ?? new Date(),
  };
}

export async function recordAuditEntry(
  db: AppDatabase,
  input: AuditEntryInput,
): Promise<AuditEntryView> {
  const row = buildRow(input);
  await db.insert(auditLog).values(row);
  return { ...row, before: parse(row.before), after: parse(row.after) };
}

/** Fixture loading path. Still the only place the audit table is written. */
export function recordAuditEntriesSync(db: AppDatabase, inputs: AuditEntryInput[]): void {
  if (inputs.length === 0) return;
  db.insert(auditLog).values(inputs.map(buildRow)).run();
}

export async function listAuditEntriesForEntity(
  db: AppDatabase,
  entityType: string,
  entityId: string,
): Promise<AuditEntryView[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt));

  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: parse(row.before),
    after: parse(row.after),
    createdAt: row.createdAt,
  }));
}
