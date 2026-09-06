'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import {
  addRefundNote,
  approveRefund,
  rejectRefund,
  requestRefundInformation,
} from '@/lib/refunds/service';
import { getCurrentActor } from '@/lib/session';
import type { RuleResult } from '@/lib/rules';

async function run(
  refundId: string,
  decision: (
    db: ReturnType<typeof getDb>,
    actor: Awaited<ReturnType<typeof getCurrentActor>>,
  ) => Promise<RuleResult>,
): Promise<never> {
  const actor = await getCurrentActor();
  const result = await decision(getDb(), actor);
  revalidatePath(`/refunds/${refundId}`);
  revalidatePath('/refunds');
  redirect(
    `/refunds/${refundId}?status=${result.allowed ? 'allowed' : 'denied'}&notice=${encodeURIComponent(result.reason)}`,
  );
}

export async function approveRefundAction(formData: FormData): Promise<void> {
  const refundId = String(formData.get('refundId'));
  await run(refundId, (db, actor) => approveRefund(db, actor, refundId));
}

export async function rejectRefundAction(formData: FormData): Promise<void> {
  const refundId = String(formData.get('refundId'));
  const reason = String(formData.get('reason') ?? '');
  await run(refundId, (db, actor) => rejectRefund(db, actor, refundId, reason));
}

export async function requestRefundInformationAction(formData: FormData): Promise<void> {
  const refundId = String(formData.get('refundId'));
  const reason = String(formData.get('reason') ?? '');
  await run(refundId, (db, actor) => requestRefundInformation(db, actor, refundId, reason));
}

export async function addRefundNoteAction(formData: FormData): Promise<void> {
  const refundId = String(formData.get('refundId'));
  const note = String(formData.get('note') ?? '');
  await run(refundId, (db, actor) => addRefundNote(db, actor, refundId, note));
}
