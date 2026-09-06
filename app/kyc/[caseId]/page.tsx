import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocumentStatusPill, RiskPill, StagePill, formatDateTime } from '@/components/Pills';
import {
  advanceStageAction,
  approveCaseAction,
  assignReviewerAction,
  rejectCaseAction,
  requestInformationAction,
  verifyDocumentAction,
} from '@/app/kyc/actions';
import { getCaseDetail } from '@/lib/kyc/queries';
import { getCurrentActor, listUsers } from '@/lib/session';
import { toActor } from '@/lib/actors';
import {
  canAdvanceStage,
  canApproveCase,
  canReviewCases,
  canVerifyDocument,
  canViewAuditHistory,
  mayAssignReviewer,
  mayRejectCase,
  mayRequestInformation,
  nextStage,
} from '@/lib/rules';
import { STAGE_LABELS, type CaseEventType } from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<CaseEventType, string> = {
  case_opened: 'Case opened',
  stage_advanced: 'Stage advanced',
  information_requested: 'Information requested',
  reviewer_assigned: 'Reviewer assigned',
  document_verified: 'Document verified',
  case_approved: 'Case approved',
  case_rejected: 'Case rejected',
};

interface PageProps {
  params: { caseId: string };
  searchParams: { status?: string; notice?: string };
}

export default async function KycCasePage({ params, searchParams }: PageProps) {
  const [detail, actor, users] = await Promise.all([
    getCaseDetail(params.caseId),
    getCurrentActor(),
    listUsers(),
  ]);

  if (!detail) notFound();

  const reviewers = users.filter((user) => canReviewCases(toActor(user)).allowed);
  const advance = canAdvanceStage(actor, detail.snapshot);
  const approve = canApproveCase(actor, detail.snapshot);
  const reject = mayRejectCase(actor, detail.snapshot);
  const information = mayRequestInformation(actor, detail.snapshot);
  const assignment = mayAssignReviewer(actor, detail.snapshot);
  const auditAccess = canViewAuditHistory(actor);
  const upcoming = nextStage(detail.stage);

  return (
    <>
      <p className="muted">
        <Link href="/kyc">← Back to queue</Link>
      </p>

      {searchParams.notice ? (
        <div className={`notice ${searchParams.status === 'allowed' ? 'allowed' : 'denied'}`}>
          {searchParams.notice}
        </div>
      ) : null}

      <div className="between">
        <div>
          <h1>
            {detail.caseRef} — {detail.subject.name}
          </h1>
          <p className="lede">
            Opened {formatDateTime(detail.openedAt)} · Modified {formatDateTime(detail.modifiedAt)}
          </p>
        </div>
        <div className="row">
          <StagePill stage={detail.stage} />
          <RiskPill risk={detail.riskRating} />
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <h2>Subject</h2>
            <dl className="facts">
              <dt>Name</dt>
              <dd>{detail.subject.name}</dd>
              <dt>Type</dt>
              <dd>{detail.subject.subjectType === 'individual' ? 'Individual' : 'Organisation'}</dd>
              <dt>Email</dt>
              <dd>{detail.subject.email}</dd>
              <dt>Country</dt>
              <dd>{detail.subject.country}</dd>
              {detail.subject.dateOfBirth ? (
                <>
                  <dt>Date of birth</dt>
                  <dd>{detail.subject.dateOfBirth}</dd>
                </>
              ) : null}
              {detail.subject.registrationNumber ? (
                <>
                  <dt>Registration number</dt>
                  <dd>{detail.subject.registrationNumber}</dd>
                </>
              ) : null}
              <dt>Assigned reviewer</dt>
              <dd className={detail.reviewerName ? undefined : 'muted'}>
                {detail.reviewerName ?? 'Unassigned'}
              </dd>
              {detail.decisionReason ? (
                <>
                  <dt>Decision reason</dt>
                  <dd>{detail.decisionReason}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <h2>Document checklist</h2>
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.documents.map((document) => {
                  const verification = canVerifyDocument(actor, detail.snapshot, document);
                  return (
                    <tr key={document.id}>
                      <td>{document.documentType}</td>
                      <td>
                        <DocumentStatusPill status={document.status} />
                      </td>
                      <td className="muted">
                        {document.verifiedAt ? formatDateTime(document.verifiedAt) : '—'}
                      </td>
                      <td>
                        {document.status === 'verified' ? null : (
                          <form action={verifyDocumentAction}>
                            <input type="hidden" name="caseId" value={detail.id} />
                            <input type="hidden" name="documentId" value={document.id} />
                            <button type="submit" disabled={!verification.allowed}>
                              Verify
                            </button>
                            {verification.allowed ? null : (
                              <span className="deny-reason">{verification.reason}</span>
                            )}
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>
              Risk rating: <RiskPill risk={detail.riskRating} />
            </h2>
            <h3>Contributing factors</h3>
            <ul className="plain">
              {detail.riskFactors.map((factor) => (
                <li key={factor.id}>
                  <strong>{factor.factor}</strong> <span className="pill">weight {factor.weight}</span>
                  <div className="muted">{factor.detail}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Case timeline</h2>
            <ul className="plain">
              {detail.timeline.map((entry) => (
                <li key={entry.id} className="timeline-item">
                  <div>
                    <strong>{EVENT_LABELS[entry.type]}</strong>
                    {entry.toStage ? ` → ${STAGE_LABELS[entry.toStage]}` : ''} · {entry.actorName}
                  </div>
                  {entry.note ? <div className="muted">{entry.note}</div> : null}
                  <div className="when">{formatDateTime(entry.createdAt)}</div>
                </li>
              ))}
            </ul>
          </section>

          {auditAccess.allowed ? (
          <section className="card">
            <h2>Audit history</h2>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Before → after</th>
                </tr>
              </thead>
              <tbody>
                {detail.auditHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No audit entries yet.
                    </td>
                  </tr>
                ) : (
                  detail.auditHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td className="muted">{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.action}</td>
                      <td>{users.find((user) => user.id === entry.actorId)?.name ?? entry.actorId}</td>
                      <td>
                        <code className="snapshot">
                          {JSON.stringify(entry.before)} → {JSON.stringify(entry.after)}
                        </code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
          ) : null}
        </div>

        <section className="card">
          <h2>Actions</h2>
          <p className="muted">
            Acting as {actor.name}. Availability is decided by <code>lib/rules</code>.
          </p>

          <form className="action-form" action={advanceStageAction}>
            <input type="hidden" name="caseId" value={detail.id} />
            <button type="submit" className="primary" disabled={!advance.allowed}>
              {upcoming ? `Advance to ${STAGE_LABELS[upcoming]}` : 'Advance stage'}
            </button>
            {advance.allowed ? null : <span className="deny-reason">{advance.reason}</span>}
          </form>

          <form className="action-form" action={requestInformationAction}>
            <input type="hidden" name="caseId" value={detail.id} />
            <label className="field">
              Request more information (reason required)
              <textarea name="reason" disabled={!information.allowed} />
            </label>
            <button type="submit" disabled={!information.allowed}>
              Request information
            </button>
            {information.allowed ? null : <span className="deny-reason">{information.reason}</span>}
          </form>

          <form className="action-form" action={assignReviewerAction}>
            <input type="hidden" name="caseId" value={detail.id} />
            <label className="field">
              Assign to reviewer
              <select
                name="reviewerId"
                defaultValue={detail.reviewerId ?? reviewers[0]?.id ?? ''}
                disabled={!assignment.allowed}
              >
                {reviewers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!assignment.allowed}>
              Assign
            </button>
            {assignment.allowed ? null : <span className="deny-reason">{assignment.reason}</span>}
          </form>

          <form className="action-form" action={approveCaseAction}>
            <input type="hidden" name="caseId" value={detail.id} />
            <button type="submit" className="primary" disabled={!approve.allowed}>
              Approve case
            </button>
            {approve.allowed ? null : <span className="deny-reason">{approve.reason}</span>}
          </form>

          <form className="action-form" action={rejectCaseAction}>
            <input type="hidden" name="caseId" value={detail.id} />
            <label className="field">
              Rejection reason (required)
              <textarea name="reason" disabled={!reject.allowed} />
            </label>
            <button type="submit" className="danger" disabled={!reject.allowed}>
              Reject case
            </button>
            {reject.allowed ? null : <span className="deny-reason">{reject.reason}</span>}
          </form>
        </section>
      </div>
    </>
  );
}
