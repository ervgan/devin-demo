import { and, eq } from 'drizzle-orm';
import { recordAuditEntriesSync } from '@/lib/audit';
import type { AppDatabase } from '@/lib/db/client';
import { featureFlags } from '@/lib/db/schema';
import { canSetFlagValue, deny, type RuleResult } from '@/lib/rules';
import type { Actor, Environment } from '@/lib/rules/types';
import { FLAG_ENTITY_TYPE } from './queries';

/**
 * Applies feature flag edits. Every decision here is delegated to lib/rules;
 * this module only loads state, persists the outcome and writes the audit entry.
 */

const FLAG_NOT_FOUND = 'That flag does not exist in this environment.';
const FLAG_CHANGED =
  'This flag changed while you were working on it. Reload the page and try again.';

export const FLAG_VALUE_CHANGED_ACTION = 'flags.value.changed';

export async function setFlagValue(
  db: AppDatabase,
  actor: Actor,
  key: string,
  environment: Environment,
  enabled: boolean,
): Promise<RuleResult> {
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.key, key), eq(featureFlags.environment, environment)))
    .limit(1);

  if (!row) return deny(FLAG_NOT_FOUND);

  const decision = canSetFlagValue(
    actor,
    { key: row.key, environment: row.environment, enabled: row.enabled },
    enabled,
  );
  if (!decision.allowed) return decision;

  // The value write and its audit entry share one transaction, and the row is
  // updated only while it still matches the state the rule was evaluated against.
  return db.transaction((tx) => {
    const now = new Date();
    const updated = tx
      .update(featureFlags)
      .set({ enabled, updatedAt: now })
      .where(
        and(
          eq(featureFlags.id, row.id),
          eq(featureFlags.enabled, row.enabled),
          eq(featureFlags.updatedAt, row.updatedAt),
        ),
      )
      .run();

    if (updated.changes === 0) return deny(FLAG_CHANGED);

    recordAuditEntriesSync(tx, [
      {
        actor,
        action: FLAG_VALUE_CHANGED_ACTION,
        entityType: FLAG_ENTITY_TYPE,
        entityId: row.key,
        before: { environment: row.environment, enabled: row.enabled },
        after: { environment: row.environment, enabled },
        at: now,
      },
    ]);

    return decision;
  });
}
