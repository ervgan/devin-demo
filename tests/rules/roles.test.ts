import { describe, expect, it } from 'vitest';
import { hasRole, isComplianceAnalyst, requireRole } from '@/lib/rules/roles';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };

describe('hasRole', () => {
  it('is true for a listed role', () => {
    expect(hasRole(agent, 'support_agent', 'engineer')).toBe(true);
  });

  it('is false for an unlisted role', () => {
    expect(hasRole(agent, 'compliance_analyst')).toBe(false);
  });
});

describe('requireRole', () => {
  it('allows a permitted role', () => {
    const result = requireRole(analyst, ['compliance_analyst'], 'approve a KYC case');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('Compliance Analyst may approve a KYC case.');
  });

  it('denies a role outside the list and names both roles', () => {
    const result = requireRole(engineer, ['compliance_analyst'], 'approve a KYC case');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Only a Compliance Analyst may approve a KYC case. Engineer may not.',
    );
  });

  it('lists every permitted role in the denial', () => {
    const result = requireRole(engineer, ['compliance_analyst', 'support_agent'], 'advance a case');
    expect(result.reason).toContain('Compliance Analyst or Support Agent');
  });
});

describe('isComplianceAnalyst', () => {
  it('is true for an analyst', () => {
    expect(isComplianceAnalyst(analyst)).toBe(true);
  });

  it('is false for everyone else', () => {
    expect(isComplianceAnalyst(agent)).toBe(false);
  });
});
