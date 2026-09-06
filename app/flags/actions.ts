'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { setFlagValue } from '@/lib/flags/service';
import { getCurrentActor } from '@/lib/session';
import { deny, type RuleResult } from '@/lib/rules';
import { ENVIRONMENTS } from '@/lib/rules/types';

/** Only flag screens are valid return targets, so a crafted form cannot redirect off-site. */
function safeReturnTo(value: FormDataEntryValue | null, key: string): string {
  const candidate = typeof value === 'string' ? value : '';
  const detail = `/flags/${encodeURIComponent(key)}`;
  return candidate === detail || candidate === '/flags' ? candidate : '/flags';
}

export async function setFlagValueAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key'));
  const environment = ENVIRONMENTS.find((value) => value === formData.get('environment'));
  const enabled = formData.get('enabled') === 'on';
  const returnTo = safeReturnTo(formData.get('returnTo'), key);

  let result: RuleResult;
  if (!environment) {
    result = deny('Unknown environment.');
  } else {
    result = await setFlagValue(getDb(), await getCurrentActor(), key, environment, enabled);
  }

  revalidatePath('/flags');
  revalidatePath(`/flags/${encodeURIComponent(key)}`);
  redirect(
    `${returnTo}?status=${result.allowed ? 'allowed' : 'denied'}&notice=${encodeURIComponent(result.reason)}`,
  );
}
