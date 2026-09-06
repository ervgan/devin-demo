import { describe, expect, it } from 'vitest';
import { canViewAuditHistory } from '@/lib/rules/audit';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };

describe('canViewAuditHistory', () => {
  it('allows support agents and engineers', () => {
    expect(canViewAuditHistory(agent).allowed).toBe(true);
    expect(canViewAuditHistory(engineer).allowed).toBe(true);
  });

  it('denies compliance analysts, who work from the case timeline', () => {
    const result = canViewAuditHistory(analyst);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('view the audit history');
  });
});
