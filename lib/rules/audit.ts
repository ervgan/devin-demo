import { allow, deny, type RuleResult } from './result';
import { ROLE_LABELS, type Actor, type Role } from './types';

/**
 * Which audit log an actor is asking to read. Each module's audit history is
 * scoped separately because the readership differs per module.
 */
export const AUDIT_DOMAINS = ['kyc', 'refunds', 'flags'] as const;
export type AuditDomain = (typeof AUDIT_DOMAINS)[number];

export const AUDIT_DOMAIN_LABELS: Record<AuditDomain, string> = {
  kyc: 'KYC',
  refunds: 'refunds',
  flags: 'feature flag',
};

type AuditAccess = 'full' | 'own_records' | 'none';

/**
 * Compliance officers oversee every module. Support agents may only see the
 * audit trail of refunds they own. Engineers and admins see flag changes only;
 * they have no business reading customer-facing KYC or refunds records.
 */
const AUDIT_ACCESS: Record<AuditDomain, Record<Role, AuditAccess>> = {
  kyc: { compliance_analyst: 'full', support_agent: 'none', engineer: 'none', admin: 'none' },
  refunds: {
    compliance_analyst: 'full',
    support_agent: 'own_records',
    engineer: 'none',
    admin: 'none',
  },
  flags: { compliance_analyst: 'full', support_agent: 'none', engineer: 'full', admin: 'full' },
};

export interface AuditHistoryContext {
  domain: AuditDomain;
  /** Actor id of whoever owns the record whose history is being read, if any. */
  ownerId?: string | null;
}

export function canViewAuditHistory(actor: Actor, context: AuditHistoryContext): RuleResult {
  const access = AUDIT_ACCESS[context.domain][actor.role];
  const role = ROLE_LABELS[actor.role];
  const label = AUDIT_DOMAIN_LABELS[context.domain];

  switch (access) {
    case 'full':
      return allow(`${role} may view the ${label} audit history.`);
    case 'own_records':
      if (context.ownerId !== undefined && context.ownerId !== null && context.ownerId === actor.id) {
        return allow(`${role} may view the ${label} audit history of their own records.`);
      }
      return deny(
        `${role} may only view the ${label} audit history of their own records. This record is not theirs.`,
      );
    case 'none':
      return deny(`${role} may not view the ${label} audit history.`);
  }
}
