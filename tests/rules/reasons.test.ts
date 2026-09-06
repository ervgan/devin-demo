import { describe, expect, it } from 'vitest';
import { MIN_REASON_LENGTH, requireReason } from '@/lib/rules/reasons';

describe('requireReason', () => {
  it('allows a reason of sufficient length', () => {
    const result = requireReason('Sanctions match confirmed by screening', 'reject the case');
    expect(result.allowed).toBe(true);
  });

  it('denies a missing reason', () => {
    const result = requireReason(null, 'reject the case');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('A reason is required to reject the case.');
  });

  it('denies a whitespace-only reason', () => {
    expect(requireReason('    ', 'reject the case').allowed).toBe(false);
  });

  it('denies a reason shorter than the minimum', () => {
    const result = requireReason('x'.repeat(MIN_REASON_LENGTH - 1), 'reject the case');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(`${MIN_REASON_LENGTH} characters`);
  });
});
