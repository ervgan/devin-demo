'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import {
  advanceCase,
  approveCase,
  assignReviewer,
  rejectCase,
  requestInformation,
  verifyDocument,
} from '@/lib/kyc/service';
import { getCurrentActor } from '@/lib/session';
import type { RuleResult } from '@/lib/rules';

async function run(
  caseId: string,
  transition: (
    db: ReturnType<typeof getDb>,
    actor: Awaited<ReturnType<typeof getCurrentActor>>,
  ) => Promise<RuleResult>,
): Promise<never> {
  const actor = await getCurrentActor();
  const result = await transition(getDb(), actor);
  revalidatePath(`/kyc/${caseId}`);
  revalidatePath('/kyc');
  redirect(
    `/kyc/${caseId}?status=${result.allowed ? 'allowed' : 'denied'}&notice=${encodeURIComponent(result.reason)}`,
  );
}

export async function advanceStageAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  await run(caseId, (db, actor) => advanceCase(db, actor, caseId));
}

export async function requestInformationAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  const reason = String(formData.get('reason') ?? '');
  await run(caseId, (db, actor) => requestInformation(db, actor, caseId, reason));
}

export async function assignReviewerAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  const reviewerId = String(formData.get('reviewerId') ?? '');
  await run(caseId, (db, actor) => assignReviewer(db, actor, caseId, reviewerId));
}

export async function verifyDocumentAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  const documentId = String(formData.get('documentId') ?? '');
  await run(caseId, (db, actor) => verifyDocument(db, actor, caseId, documentId));
}

export async function approveCaseAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  await run(caseId, (db, actor) => approveCase(db, actor, caseId));
}

export async function rejectCaseAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get('caseId'));
  const reason = String(formData.get('reason') ?? '');
  await run(caseId, (db, actor) => rejectCase(db, actor, caseId, reason));
}
