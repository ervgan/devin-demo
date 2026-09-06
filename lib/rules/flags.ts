import { requireRole } from './roles';
import { all, allow, deny, type RuleResult } from './result';
import { ENVIRONMENT_LABELS, type Actor, type Environment } from './types';

/** The projection of a flag value the rules need. Deliberately not a database row. */
export interface FlagValueSnapshot {
  key: string;
  environment: Environment;
  enabled: boolean;
}

/** Flag values are administrator-only, whichever team owns the behaviour behind them. */
const FLAG_EDITOR_ROLES = ['admin'] as const;

export function flagStateLabel(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

/** Whether the actor may edit flag values at all, ignoring the value asked for. */
export function mayEditFlags(actor: Actor): RuleResult {
  return requireRole(actor, [...FLAG_EDITOR_ROLES], 'change a feature flag value');
}

export function canSetFlagValue(
  actor: Actor,
  snapshot: FlagValueSnapshot,
  enabled: boolean,
): RuleResult {
  const base = mayEditFlags(actor);
  if (!base.allowed) return base;

  if (snapshot.enabled === enabled) {
    return deny(
      `${snapshot.key} is already ${flagStateLabel(enabled)} in ${ENVIRONMENT_LABELS[snapshot.environment]}.`,
    );
  }

  return all(
    base,
    allow(
      `${snapshot.key} may be turned ${flagStateLabel(enabled)} in ${ENVIRONMENT_LABELS[snapshot.environment]}.`,
    ),
  );
}
