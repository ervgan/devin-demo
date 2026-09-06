import { asc } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { featureFlags } from '@/lib/db/schema';
import { listAuditEntriesForEntity, type AuditEntryView } from '@/lib/audit';
import { ENVIRONMENTS, type Environment } from '@/lib/rules/types';
import type { FlagValueSnapshot } from '@/lib/rules';

export const FLAG_ENTITY_TYPE = 'feature_flag';

export interface FlagEnvironmentValue {
  id: string;
  environment: Environment;
  enabled: boolean;
  updatedAt: Date;
  /** The projection the rules operate on, built once here. */
  snapshot: FlagValueSnapshot;
}

export interface FlagListItem {
  key: string;
  description: string;
  owner: string;
  values: FlagEnvironmentValue[];
  updatedAt: Date;
}

export interface FlagDetail extends FlagListItem {
  history: AuditEntryView[];
}

function groupByKey(rows: (typeof featureFlags.$inferSelect)[]): FlagListItem[] {
  const byKey = new Map<string, FlagListItem>();

  for (const row of rows) {
    const flag = byKey.get(row.key) ?? {
      key: row.key,
      description: row.description,
      owner: row.owner,
      values: [],
      updatedAt: row.updatedAt,
    };
    flag.values.push({
      id: row.id,
      environment: row.environment,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
      snapshot: { key: row.key, environment: row.environment, enabled: row.enabled },
    });
    if (row.updatedAt > flag.updatedAt) flag.updatedAt = row.updatedAt;
    byKey.set(row.key, flag);
  }

  for (const flag of byKey.values()) {
    flag.values.sort(
      (left, right) =>
        ENVIRONMENTS.indexOf(left.environment) - ENVIRONMENTS.indexOf(right.environment),
    );
  }

  return [...byKey.values()];
}

export async function listFlags(): Promise<FlagListItem[]> {
  const rows = await getDb().select().from(featureFlags).orderBy(asc(featureFlags.key));
  return groupByKey(rows);
}

export async function getFlagDetail(key: string): Promise<FlagDetail | null> {
  const db = getDb();
  const rows = await db.select().from(featureFlags).orderBy(asc(featureFlags.key));
  const flag = groupByKey(rows).find((candidate) => candidate.key === key);
  if (!flag) return null;

  const history = await listAuditEntriesForEntity(db, FLAG_ENTITY_TYPE, key);
  return { ...flag, history };
}
