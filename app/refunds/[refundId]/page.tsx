import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime, KycStatusPill, RefundStatusPill } from '@/components/Pills';
import {
  addRefundNoteAction,
  approveRefundAction,
  rejectRefundAction,
  requestRefundInformationAction,
} from '@/app/refunds/actions';
import { getRefundDetail } from '@/lib/refunds/queries';
import { getCurrentActor, listUsers } from '@/lib/session';
import {
  canApproveRefund,
  canViewAuditHistory,
  formatMoney,
  isAwaitingSecondApproval,
  mayAddRefundNote,
  mayRejectRefund,
  mayRequestRefundInformation,
  requiresSecondApproval,
} from '@/lib/rules';
import {
  REFUND_CHANNEL_LABELS,
  REFUND_REASON_LABELS,
  REFUND_STATUS_LABELS,
  STAGE_LABELS,
  type RefundEventType,
} from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<RefundEventType, string> = {
  refund_requested: 'Refund requested',
  review_started: 'Review started',
  information_requested: 'Information requested',
  note_added: 'Internal note added',
  first_approval_recorded: 'First approval recorded',
  refund_approved: 'Refund approved',
  refund_rejected: 'Refund rejected',
  refund_settled: 'Refund settled',
};

interface PageProps {
  params: { refundId: string };
  searchParams: { status?: string; notice?: string };
}

export default async function RefundDetailPage({ params, searchParams }: PageProps) {
  const [detail, actor, users] = await Promise.all([
    getRefundDetail(params.refundId),
    getCurrentActor(),
    listUsers(),
  ]);

  if (!detail) notFound();

  // The one approval decision. The button state and the message both come from
  // this result; nothing here re-derives eligibility.
  const approve = canApproveRefund(actor, detail.snapshot);
  const reject = mayRejectRefund(actor, detail.snapshot);
  const information = mayRequestRefundInformation(actor, detail.snapshot);
  const note = mayAddRefundNote(actor);
  const awaitingSecondApproval = isAwaitingSecondApproval(detail.snapshot);
  const auditAccess = canViewAuditHistory(actor);
  const needsTwoApprovals = requiresSecondApproval(detail.snapshot);

  return (
    <>
      <p className="muted">
        <Link href="/refunds">← Back to refunds</Link>
      </p>

      {searchParams.notice ? (
        <div className={`notice ${searchParams.status === 'allowed' ? 'allowed' : 'denied'}`}>
          {searchParams.notice}
        </div>
      ) : null}

      <div className="between">
        <div>
          <h1>
            {detail.refundRef} — {detail.customer.name}
          </h1>
          <p className="lede">
            {formatMoney(detail.amountCents, detail.currency)} ·{' '}
            {REFUND_REASON_LABELS[detail.reasonCode]} · Requested {formatDateTime(detail.createdAt)}{' '}
            · Modified {formatDateTime(detail.modifiedAt)}
          </p>
        </div>
        <div className="row">
          <RefundStatusPill status={detail.status} />
          {awaitingSecondApproval ? <span className="pill">Awaiting 2nd approval</span> : null}
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <h2>Customer</h2>
            <dl className="facts">
              <dt>Name</dt>
              <dd>{detail.customer.name}</dd>
              <dt>Type</dt>
              <dd>{detail.customer.subjectType === 'individual' ? 'Individual' : 'Organisation'}</dd>
              <dt>Email</dt>
              <dd>{detail.customer.email}</dd>
              <dt>Country</dt>
              <dd>{detail.customer.country}</dd>
              <dt>KYC status</dt>
              <dd>
                <KycStatusPill status={detail.customer.kycStatus} />
              </dd>
              <dt>KYC case</dt>
              <dd>
                {detail.customer.kycCase ? (
                  <>
                    <Link href={`/kyc/${detail.customer.kycCase.caseId}`}>
                      {detail.customer.kycCase.caseRef}
                    </Link>{' '}
                    <span className="muted">
                      at {STAGE_LABELS[detail.customer.kycCase.stage]}
                    </span>
                  </>
                ) : (
                  <span className="muted">No case</span>
                )}
              </dd>
            </dl>
            <p className="muted">
              KYC is shown for information only; no refund decision depends on it.
            </p>
          </section>

          <section className="card">
            <h2>Original transaction</h2>
            <dl className="facts">
              <dt>Reference</dt>
              <dd>{detail.transaction.transactionRef}</dd>
              <dt>Description</dt>
              <dd>{detail.transaction.description}</dd>
              <dt>Paid</dt>
              <dd>{formatMoney(detail.transaction.amountCents, detail.transaction.currency)}</dd>
              <dt>Channel</dt>
              <dd>{REFUND_CHANNEL_LABELS[detail.transaction.channel]}</dd>
              <dt>Occurred</dt>
              <dd>{formatDateTime(detail.transaction.occurredAt)}</dd>
              <dt>Refund requested by</dt>
              <dd>{detail.requestedByName}</dd>
              <dt>Approvals</dt>
              <dd className={detail.firstApproverName ? undefined : 'muted'}>
                {detail.firstApproverName ?? 'None yet'}
                {detail.secondApproverName ? ` · ${detail.secondApproverName}` : ''}
                {needsTwoApprovals ? (
                  <span className="muted"> (two approvals required)</span>
                ) : null}
              </dd>
              {detail.rejectionReason ? (
                <>
                  <dt>Rejection reason</dt>
                  <dd>{detail.rejectionReason}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <h2>Customer refund history</h2>
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th className="numeric">Amount</th>
                  <th>Reason</th>
                  <th>State</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {detail.customerRefunds.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No other refunds for this customer.
                    </td>
                  </tr>
                ) : (
                  detail.customerRefunds.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/refunds/${item.id}`}>{item.refundRef}</Link>
                      </td>
                      <td className="numeric">{formatMoney(item.amountCents, item.currency)}</td>
                      <td className="muted">{REFUND_REASON_LABELS[item.reasonCode]}</td>
                      <td>
                        <RefundStatusPill status={item.status} />
                      </td>
                      <td className="muted">{formatDateTime(item.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>Refund timeline</h2>
            <ul className="plain">
              {detail.timeline.map((entry) => (
                <li key={entry.id} className="timeline-item">
                  <div>
                    <strong>{EVENT_LABELS[entry.type]}</strong>
                    {entry.toStatus ? ` → ${REFUND_STATUS_LABELS[entry.toStatus]}` : ''} ·{' '}
                    {entry.actorName}
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
          <h2>Decision</h2>
          <p className="muted">
            Acting as {actor.name}. Availability is decided by <code>lib/rules</code>.
          </p>

          <form className="action-form" action={approveRefundAction}>
            <input type="hidden" name="refundId" value={detail.id} />
            <button type="submit" className="primary" disabled={!approve.allowed}>
              {awaitingSecondApproval ? 'Give second approval' : 'Approve refund'}
            </button>
            <span className={approve.allowed ? 'muted' : 'deny-reason'}>{approve.reason}</span>
          </form>

          <form className="action-form" action={requestRefundInformationAction}>
            <input type="hidden" name="refundId" value={detail.id} />
            <label className="field">
              Request more information (reason required)
              <textarea name="reason" disabled={!information.allowed} />
            </label>
            <button type="submit" disabled={!information.allowed}>
              Request information
            </button>
            {information.allowed ? null : <span className="deny-reason">{information.reason}</span>}
          </form>

          <form className="action-form" action={addRefundNoteAction}>
            <input type="hidden" name="refundId" value={detail.id} />
            <label className="field">
              Internal note
              <textarea name="note" disabled={!note.allowed} />
            </label>
            <button type="submit" disabled={!note.allowed}>
              Add note
            </button>
            {note.allowed ? null : <span className="deny-reason">{note.reason}</span>}
          </form>

          <form className="action-form" action={rejectRefundAction}>
            <input type="hidden" name="refundId" value={detail.id} />
            <label className="field">
              Rejection reason (required)
              <textarea name="reason" disabled={!reject.allowed} />
            </label>
            <button type="submit" className="danger" disabled={!reject.allowed}>
              Reject refund
            </button>
            {reject.allowed ? null : <span className="deny-reason">{reject.reason}</span>}
          </form>
        </section>
      </div>
    </>
  );
}
