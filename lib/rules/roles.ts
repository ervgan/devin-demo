import { allow, deny, type RuleResult } from './result';
import { ROLE_LABELS, type Actor, type Role } from './types';

export function hasRole(actor: Actor, ...roles: Role[]): boolean {
  return roles.includes(actor.role);
}

/** Shared role gate so no module spells out its own role comparison. */
export function requireRole(actor: Actor, roles: Role[], activity: string): RuleResult {
  if (hasRole(actor, ...roles)) {
    return allow(`${ROLE_LABELS[actor.role]} may ${activity}.`);
  }
  const permitted = roles.map((role) => ROLE_LABELS[role]).join(' or ');
  return deny(`Only a ${permitted} may ${activity}. ${ROLE_LABELS[actor.role]} may not.`);
}

export function isComplianceAnalyst(actor: Actor): boolean {
  return hasRole(actor, 'compliance_analyst');
}
