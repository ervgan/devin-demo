import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createInMemoryDatabase, type AppDatabase } from '@/lib/db/client';
import { seedDatabase } from '@/lib/db/seed';
import { featureFlags } from '@/lib/db/schema';
import { listAuditEntriesForEntity } from '@/lib/audit';
import { setFlagValue, FLAG_VALUE_CHANGED_ACTION } from '@/lib/flags/service';
import { FLAG_ENTITY_TYPE } from '@/lib/flags/queries';
import type { Actor, Environment } from '@/lib/rules/types';

const engineer: Actor = { id: 'usr_tom', name: 'Tom Becker', role: 'engineer' };
const analyst: Actor = { id: 'usr_amara', name: 'Amara Osei', role: 'compliance_analyst' };

const KYC_APPROVAL_FLAG = 'refunds.require_kyc_approval';

let db: AppDatabase;

async function valueOf(key: string, environment: Environment): Promise<boolean> {
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.key, key), eq(featureFlags.environment, environment)))
    .limit(1);
  if (!row) throw new Error(`Fixture flag ${key} is missing in ${environment}`);
  return row.enabled;
}

async function historyOf(key: string) {
  return listAuditEntriesForEntity(db, FLAG_ENTITY_TYPE, key);
}

beforeEach(() => {
  db = createInMemoryDatabase();
  seedDatabase(db);
});

describe('seed fixtures', () => {
  it('carries an owner and a value per environment for every flag', async () => {
    const rows = await db.select().from(featureFlags);
    const byKey = new Map<string, string[]>();
    for (const row of rows) {
      expect(row.owner).not.toBe('');
      byKey.set(row.key, [...(byKey.get(row.key) ?? []), row.environment]);
    }
    for (const environments of byKey.values()) {
      expect(new Set(environments)).toEqual(new Set(['dev', 'staging', 'prod']));
    }
  });

  it('ships refunds.require_kyc_approval off everywhere, owned by compliance', async () => {
    const rows = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, KYC_APPROVAL_FLAG));

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.enabled === false)).toBe(true);
    expect(new Set(rows.map((row) => row.owner))).toEqual(new Set(['Compliance']));
  });
});

describe('setFlagValue', () => {
  it('persists the new value and records one audit entry with both values', async () => {
    const result = await setFlagValue(db, engineer, KYC_APPROVAL_FLAG, 'staging', true);

    expect(result.allowed).toBe(true);
    expect(await valueOf(KYC_APPROVAL_FLAG, 'staging')).toBe(true);

    const history = await historyOf(KYC_APPROVAL_FLAG);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: engineer.id,
      action: FLAG_VALUE_CHANGED_ACTION,
      entityType: FLAG_ENTITY_TYPE,
      entityId: KYC_APPROVAL_FLAG,
      before: { environment: 'staging', enabled: false },
      after: { environment: 'staging', enabled: true },
    });
  });

  it('leaves the other environments untouched', async () => {
    await setFlagValue(db, engineer, KYC_APPROVAL_FLAG, 'dev', true);

    expect(await valueOf(KYC_APPROVAL_FLAG, 'staging')).toBe(false);
    expect(await valueOf(KYC_APPROVAL_FLAG, 'prod')).toBe(false);
  });

  it('accumulates one history entry per change on the same flag', async () => {
    await setFlagValue(db, engineer, KYC_APPROVAL_FLAG, 'dev', true);
    await setFlagValue(db, engineer, KYC_APPROVAL_FLAG, 'dev', false);

    const history = await historyOf(KYC_APPROVAL_FLAG);
    expect(history).toHaveLength(2);
    expect(await valueOf(KYC_APPROVAL_FLAG, 'dev')).toBe(false);
  });

  it('denies a role that may not edit flags and writes nothing', async () => {
    const result = await setFlagValue(db, analyst, KYC_APPROVAL_FLAG, 'prod', true);

    expect(result.allowed).toBe(false);
    expect(await valueOf(KYC_APPROVAL_FLAG, 'prod')).toBe(false);
    expect(await historyOf(KYC_APPROVAL_FLAG)).toHaveLength(0);
  });

  it('denies a no-op change and writes nothing', async () => {
    const result = await setFlagValue(db, engineer, KYC_APPROVAL_FLAG, 'prod', false);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already off');
    expect(await historyOf(KYC_APPROVAL_FLAG)).toHaveLength(0);
  });

  it('denies an unknown flag', async () => {
    const result = await setFlagValue(db, engineer, 'nope.not_a_flag', 'dev', true);
    expect(result.allowed).toBe(false);
  });
});
