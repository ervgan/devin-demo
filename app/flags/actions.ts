'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { setFlagValue } from '@/lib/flags/service';
import { getCurrentActor } from '@/lib/session';
import { deny, type RuleResult } from '@/lib/rules';
import { ENVIRONMENTS } from '@/lib/rules/types';

export async function setFlagValueAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key'));
  const environment = ENVIRONMENTS.find((value) => value === formData.get('environment'));
  const enabled = formData.get('enabled') === 'on';
  const returnTo = String(formData.get('returnTo') ?? '/flags');

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
