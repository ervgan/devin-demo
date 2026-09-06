import { describe, expect, it } from 'vitest';
import {
  canAdvanceStage,
  canApproveCase,
  canAssignReviewer,
  canRejectCase,
  canRequestInformation,
  canReviewCases,
  canVerifyDocument,
  isTerminalStage,
  mayAssignReviewer,
  mayRejectCase,
  mayRequestInformation,
  missingDocuments,
  nextStage,
  type CaseSnapshot,
} from '@/lib/rules/kyc';
import type { Actor, CaseStage } from '@/lib/rules/types';

const analyst: Actor = { id: 'usr_a', name: 'Amara Osei', role: 'compliance_analyst' };
const otherAnalyst: Actor = { id: 'usr_l', name: 'Liu Chen', role: 'compliance_analyst' };
const agent: Actor = { id: 'usr_p', name: 'Priya Raman', role: 'support_agent' };
const engineer: Actor = { id: 'usr_t', name: 'Tom Becker', role: 'engineer' };

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    caseRef: 'KYC-2041',
    stage: 'capture',
    riskRating: 'low',
    assignedReviewerId: analyst.id,
    documents: [
      { documentType: 'Government ID', status: 'verified' },
      { documentType: 'Proof of Address', status: 'verified' },
    ],
    ...overrides,
  };
}

const READY_FOR_DECISION = snapshot({ stage: 'fulfilment' });

describe('isTerminalStage', () => {
  it('is true for decided cases', () => {
    expect(isTerminalStage('approved')).toBe(true);
    expect(isTerminalStage('rejected')).toBe(true);
  });

  it('is false for workflow stages', () => {
    expect(isTerminalStage('due_diligence')).toBe(false);
  });
});

describe('nextStage', () => {
  it('walks the workflow in order', () => {
    expect(nextStage('capture')).toBe('enrichment');
    expect(nextStage('enrichment')).toBe('due_diligence');
    expect(nextStage('due_diligence')).toBe('fulfilment');
  });

  it('has no successor at the end of the workflow or in a terminal stage', () => {
    expect(nextStage('fulfilment')).toBeNull();
    expect(nextStage('approved')).toBeNull();
  });
});

describe('missingDocuments', () => {
  it('returns nothing when the checklist is complete', () => {
    expect(missingDocuments(snapshot())).toEqual([]);
  });

  it('returns each missing document', () => {
    const missing = missingDocuments(
      snapshot({
        documents: [
          { documentType: 'Government ID', status: 'verified' },
          { documentType: 'Source of Funds', status: 'missing' },
        ],
      }),
    );
    expect(missing.map((document) => document.documentType)).toEqual(['Source of Funds']);
  });
});

describe('canAdvanceStage', () => {
  it('allows a compliance analyst to advance an open case', () => {
    const result = canAdvanceStage(analyst, snapshot());
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Enrichment');
  });

  it('denies a support agent, who works refunds rather than KYC', () => {
    const result = canAdvanceStage(agent, snapshot());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Support Agent may not');
  });

  it('denies an engineer', () => {
    const result = canAdvanceStage(engineer, snapshot());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Engineer may not');
  });

  it('denies advancing a decided case', () => {
    const result = canAdvanceStage(analyst, snapshot({ stage: 'approved' }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('approved');
  });

  it('denies advancing past Fulfilment', () => {
    const result = canAdvanceStage(analyst, READY_FOR_DECISION);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('approve or reject');
  });

  it('denies leaving Due Diligence with missing documents', () => {
    const result = canAdvanceStage(
      analyst,
      snapshot({
        stage: 'due_diligence',
        documents: [{ documentType: 'Source of Funds', status: 'missing' }],
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Source of Funds');
  });

  it('allows leaving Due Diligence once documents are verified', () => {
    expect(canAdvanceStage(analyst, snapshot({ stage: 'due_diligence' })).allowed).toBe(true);
  });

  it('allows leaving Capture with missing documents', () => {
    const result = canAdvanceStage(
      analyst,
      snapshot({ documents: [{ documentType: 'Source of Funds', status: 'missing' }] }),
    );
    expect(result.allowed).toBe(true);
  });
});

describe('mayRequestInformation', () => {
  it('allows a compliance analyst on an open case', () => {
    expect(mayRequestInformation(analyst, snapshot()).allowed).toBe(true);
  });

  it('denies a support agent', () => {
    expect(mayRequestInformation(agent, snapshot()).allowed).toBe(false);
  });

  it('denies an engineer', () => {
    expect(mayRequestInformation(engineer, snapshot()).allowed).toBe(false);
  });
});

describe('canRequestInformation', () => {
  it('allows with a reason', () => {
    const result = canRequestInformation(analyst, snapshot(), 'Address document is illegible');
    expect(result.allowed).toBe(true);
  });

  it('denies without a reason', () => {
    const result = canRequestInformation(analyst, snapshot(), '');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('A reason is required');
  });

  it('denies an engineer even with a reason', () => {
    const result = canRequestInformation(engineer, snapshot(), 'Address document is illegible');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Engineer may not');
  });

  it('denies on a decided case', () => {
    const result = canRequestInformation(
      analyst,
      snapshot({ stage: 'rejected' }),
      'Address document is illegible',
    );
    expect(result.allowed).toBe(false);
  });
});

describe('mayAssignReviewer', () => {
  it('allows a compliance analyst on an open case', () => {
    expect(mayAssignReviewer(analyst, snapshot()).allowed).toBe(true);
  });

  it('denies a support agent', () => {
    expect(mayAssignReviewer(agent, snapshot()).allowed).toBe(false);
  });

  it('denies on a decided case', () => {
    expect(mayAssignReviewer(analyst, snapshot({ stage: 'approved' })).allowed).toBe(false);
  });
});

describe('canAssignReviewer', () => {
  it('allows assigning to a compliance analyst', () => {
    const result = canAssignReviewer(analyst, snapshot(), otherAnalyst);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Liu Chen');
  });

  it('denies assigning to a non-analyst', () => {
    const result = canAssignReviewer(analyst, snapshot(), engineer);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not a compliance analyst');
  });

  it('denies a support agent doing the assigning', () => {
    const result = canAssignReviewer(agent, snapshot(), otherAnalyst);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Support Agent may not');
  });

  it('denies an engineer doing the assigning', () => {
    const result = canAssignReviewer(engineer, snapshot(), analyst);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Engineer may not');
  });
});

describe('canReviewCases', () => {
  it('allows a compliance analyst', () => {
    expect(canReviewCases(analyst).allowed).toBe(true);
  });

  it('denies support agents and engineers', () => {
    expect(canReviewCases(agent).allowed).toBe(false);
    expect(canReviewCases(engineer).allowed).toBe(false);
  });
});

describe('canVerifyDocument', () => {
  const missing = { documentType: 'Source of Funds', status: 'missing' } as const;

  it('allows a compliance analyst to verify a missing document on an open case', () => {
    const result = canVerifyDocument(analyst, snapshot({ documents: [missing] }), missing);
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Source of Funds');
  });

  it('denies a support agent', () => {
    const result = canVerifyDocument(agent, snapshot({ documents: [missing] }), missing);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Support Agent may not');
  });

  it('denies an engineer', () => {
    expect(canVerifyDocument(engineer, snapshot({ documents: [missing] }), missing).allowed).toBe(
      false,
    );
  });

  it('denies a document that is already verified', () => {
    const verified = { documentType: 'Government ID', status: 'verified' } as const;
    const result = canVerifyDocument(analyst, snapshot(), verified);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('already verified');
  });

  it('denies on a decided case', () => {
    const result = canVerifyDocument(
      analyst,
      snapshot({ stage: 'rejected', documents: [missing] }),
      missing,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('can no longer have documents verified');
  });
});

describe('canApproveCase', () => {
  it('allows a compliance analyst on a complete case at Fulfilment', () => {
    expect(canApproveCase(analyst, READY_FOR_DECISION).allowed).toBe(true);
  });

  it('denies a support agent', () => {
    const result = canApproveCase(agent, READY_FOR_DECISION);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Only a Compliance Analyst may approve a KYC case. Support Agent may not.',
    );
  });

  it('denies an engineer', () => {
    expect(canApproveCase(engineer, READY_FOR_DECISION).allowed).toBe(false);
  });

  it('denies before Fulfilment', () => {
    const result = canApproveCase(analyst, snapshot({ stage: 'due_diligence' }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('must reach Fulfilment');
  });

  it('denies with missing documents', () => {
    const result = canApproveCase(
      analyst,
      snapshot({
        stage: 'fulfilment',
        documents: [{ documentType: 'Source of Funds', status: 'missing' }],
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Source of Funds');
  });

  it('denies without an assigned reviewer', () => {
    const result = canApproveCase(analyst, snapshot({ stage: 'fulfilment', assignedReviewerId: null }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('assigned reviewer');
  });

  it('denies a case that is already decided', () => {
    expect(canApproveCase(analyst, snapshot({ stage: 'approved' })).allowed).toBe(false);
  });
});

describe('mayRejectCase', () => {
  it('allows a compliance analyst on an open case', () => {
    expect(mayRejectCase(analyst, snapshot()).allowed).toBe(true);
  });

  it('denies a support agent', () => {
    expect(mayRejectCase(agent, snapshot()).allowed).toBe(false);
  });
});

describe('canRejectCase', () => {
  it('allows a compliance analyst with a reason at any open stage', () => {
    const result = canRejectCase(analyst, snapshot(), 'Confirmed sanctions list match');
    expect(result.allowed).toBe(true);
  });

  it('denies without a reason', () => {
    const result = canRejectCase(analyst, snapshot(), '   ');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('A reason is required');
  });

  it('denies a support agent even with a reason', () => {
    const result = canRejectCase(agent, snapshot(), 'Confirmed sanctions list match');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Support Agent may not');
  });

  it('denies a case that is already decided', () => {
    const result = canRejectCase(
      analyst,
      snapshot({ stage: 'rejected' }),
      'Confirmed sanctions list match',
    );
    expect(result.allowed).toBe(false);
  });
});

describe('stage coverage', () => {
  const stages: CaseStage[] = ['capture', 'enrichment', 'due_diligence', 'fulfilment'];

  it('lets an analyst act on every open workflow stage', () => {
    for (const stage of stages) {
      expect(mayRejectCase(analyst, snapshot({ stage })).allowed).toBe(true);
    }
  });
});
