import { setFlagValueAction } from '@/app/flags/actions';
import type { Environment } from '@/lib/rules/types';

/** Inline editor for one flag value. The rule decides whether it is usable. */
export function FlagToggle({
  flagKey,
  environment,
  enabled,
  editable,
  reason,
  returnTo,
}: {
  flagKey: string;
  environment: Environment;
  enabled: boolean;
  editable: boolean;
  reason: string;
  returnTo: string;
}) {
  return (
    <form action={setFlagValueAction} className="flag-toggle">
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="environment" value={environment} />
      <input type="hidden" name="enabled" value={enabled ? 'off' : 'on'} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className={enabled ? 'toggle on' : 'toggle off'}
        disabled={!editable}
        title={editable ? `Turn ${enabled ? 'off' : 'on'}` : reason}
      >
        {enabled ? 'On' : 'Off'}
      </button>
    </form>
  );
}
