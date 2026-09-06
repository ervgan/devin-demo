import { describe, expect, it } from 'vitest';
import { all, allow, deny } from '@/lib/rules/result';

describe('result', () => {
  it('allows with a default reason', () => {
    expect(allow()).toEqual({ allowed: true, reason: 'Allowed' });
  });

  it('denies with the supplied reason', () => {
    expect(deny('no')).toEqual({ allowed: false, reason: 'no' });
  });

  it('combines allows into the last allow', () => {
    expect(all(allow('first'), allow('second'))).toEqual({ allowed: true, reason: 'second' });
  });

  it('returns the first denial when combining', () => {
    expect(all(allow('first'), deny('blocked'), deny('later'))).toEqual({
      allowed: false,
      reason: 'blocked',
    });
  });

  it('allows when nothing is combined', () => {
    expect(all().allowed).toBe(true);
  });
});
