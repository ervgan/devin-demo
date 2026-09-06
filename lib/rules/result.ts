/**
 * Every rule returns one of these. Business denials are values, not exceptions,
 * so the UI can render `reason` without knowing why the rule said no.
 */
export type RuleResult =
  | { readonly allowed: true; readonly reason: string }
  | { readonly allowed: false; readonly reason: string };

export function allow(reason = 'Allowed'): RuleResult {
  return { allowed: true, reason };
}

export function deny(reason: string): RuleResult {
  return { allowed: false, reason };
}

/** First denial wins; otherwise the last allow reason is kept. */
export function all(...results: RuleResult[]): RuleResult {
  for (const result of results) {
    if (!result.allowed) return result;
  }
  return results[results.length - 1] ?? allow();
}
