import { allow, deny, type RuleResult } from './result';

export const MIN_REASON_LENGTH = 10;

/**
 * Shared by every action that must record why it happened. Kept here so no
 * module invents its own idea of what counts as a reason.
 */
export function requireReason(reason: string | null | undefined, activity: string): RuleResult {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) {
    return deny(`A reason is required to ${activity}.`);
  }
  if (trimmed.length < MIN_REASON_LENGTH) {
    return deny(
      `The reason to ${activity} must be at least ${MIN_REASON_LENGTH} characters so the audit trail is meaningful.`,
    );
  }
  return allow(`Reason supplied for ${activity}.`);
}
