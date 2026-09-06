import { describe, expect, it } from 'vitest';
import { canSetFlagValue, flagStateLabel, mayEditFlags } from '@/lib/rules/flags';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };
const admin: Actor = { id: 'usr_n', name: 'Nadia Faraj', role: 'admin' };

const flagOff = { key: 'refunds.require_kyc_approval', environment: 'prod', enabled: false } as const;

describe('flagStateLabel', () => {
  it('names both states', () => {
    expect(flagStateLabel(true)).toBe('on');
    expect(flagStateLabel(false)).toBe('off');
  });
});

describe('mayEditFlags', () => {
  it('allows an admin', () => {
    expect(mayEditFlags(admin).allowed).toBe(true);
  });

  it('denies every other role, engineers included, and says who may', () => {
    const result = mayEditFlags(engineer);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Only an Admin may change a feature flag value. Engineer may not.',
    );
    expect(mayEditFlags(analyst).allowed).toBe(false);
    expect(mayEditFlags(agent).allowed).toBe(false);
  });
});

describe('canSetFlagValue', () => {
  it('allows an admin to change a value and names the environment', () => {
    const result = canSetFlagValue(admin, flagOff, true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('refunds.require_kyc_approval may be turned on in Prod.');
  });

  it('denies a role that may not edit flags before looking at the value', () => {
    const result = canSetFlagValue(engineer, flagOff, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('change a feature flag value');
  });

  it('denies setting the value it already has', () => {
    const result = canSetFlagValue(admin, flagOff, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('refunds.require_kyc_approval is already off in Prod.');
  });
});
