import { describe, expect, it } from 'vitest';
import { canViewAuditHistory } from '@/lib/rules/audit';
import type { Actor } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };
const admin: Actor = { id: 'usr_d', name: 'Dana Whitfield', role: 'admin' };

describe('canViewAuditHistory', () => {
  describe('KYC audit', () => {
    it('allows compliance analysts', () => {
      expect(canViewAuditHistory(analyst, { domain: 'kyc' }).allowed).toBe(true);
    });

    it('denies support agents, engineers and admins', () => {
      for (const actor of [agent, engineer, admin]) {
        const result = canViewAuditHistory(actor, { domain: 'kyc' });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('may not view the KYC audit history');
      }
    });
  });

  describe('refunds audit', () => {
    it('allows compliance analysts regardless of ownership', () => {
      expect(canViewAuditHistory(analyst, { domain: 'refunds', ownerId: 'usr_p' }).allowed).toBe(true);
      expect(canViewAuditHistory(analyst, { domain: 'refunds' }).allowed).toBe(true);
    });

    it('allows support agents only on records they own', () => {
      expect(canViewAuditHistory(agent, { domain: 'refunds', ownerId: agent.id }).allowed).toBe(true);

      const other = canViewAuditHistory(agent, { domain: 'refunds', ownerId: 'usr_a' });
      expect(other.allowed).toBe(false);
      expect(other.reason).toContain('own records');

      expect(canViewAuditHistory(agent, { domain: 'refunds' }).allowed).toBe(false);
      expect(canViewAuditHistory(agent, { domain: 'refunds', ownerId: null }).allowed).toBe(false);
    });

    it('denies engineers and admins even on records they own', () => {
      for (const actor of [engineer, admin]) {
        const result = canViewAuditHistory(actor, { domain: 'refunds', ownerId: actor.id });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('may not view the refunds audit history');
      }
    });
  });

  describe('flags audit', () => {
    it('allows compliance analysts, engineers and admins', () => {
      for (const actor of [analyst, engineer, admin]) {
        expect(canViewAuditHistory(actor, { domain: 'flags' }).allowed).toBe(true);
      }
    });

    it('denies support agents', () => {
      const result = canViewAuditHistory(agent, { domain: 'flags' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('may not view the feature flag audit history');
    });
  });
});
