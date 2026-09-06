import { requireRole } from './roles';
import type { RuleResult } from './result';
import type { Actor } from './types';

/**
 * The audit log is a technical record of raw field changes, kept for support
 * and engineering. Case workers read the case timeline instead.
 */
const AUDIT_READER_ROLES = ['support_agent', 'engineer'] as const;

export function canViewAuditHistory(actor: Actor): RuleResult {
  return requireRole(actor, [...AUDIT_READER_ROLES], 'view the audit history');
}
