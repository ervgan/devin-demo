import Link from 'next/link';
import { formatDateTime, RefundStatusPill } from '@/components/Pills';
import {
  AMOUNT_BANDS,
  listRefunds,
  summariseRefunds,
  REFUND_SORT_FIELDS,
  type AmountBand,
  type RefundFilters,
  type RefundSortField,
  type SortDirection,
} from '@/lib/refunds/queries';
import { formatMoney } from '@/lib/rules';
import {
  REFUND_REASON_CODES,
  REFUND_REASON_LABELS,
  REFUND_STATUSES,
  REFUND_STATUS_LABELS,
  type RefundReasonCode,
  type RefundStatus,
} from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  status?: string;
  reason?: string;
  band?: string;
  sort?: string;
  direction?: string;
}

function parseFilters(params: SearchParams): RefundFilters {
  const status = REFUND_STATUSES.find((value) => value === params.status);
  const reasonCode = REFUND_REASON_CODES.find((value) => value === params.reason);
  const band = (Object.keys(AMOUNT_BANDS) as AmountBand[]).find((value) => value === params.band);
  const sort = REFUND_SORT_FIELDS.find((value) => value === params.sort);
  return {
    search: params.q?.trim() || undefined,
    status: status as RefundStatus | undefined,
    reasonCode: reasonCode as RefundReasonCode | undefined,
    band,
    sort,
    direction: params.direction === 'asc' ? 'asc' : 'desc',
  };
}

function SortableHeader({
  field,
  label,
  params,
  filters,
  className,
}: {
  field: RefundSortField;
  label: string;
  params: SearchParams;
  filters: RefundFilters;
  className?: string;
}) {
  const active = (filters.sort ?? 'modified') === field;
  const nextDirection: SortDirection = active && filters.direction === 'asc' ? 'desc' : 'asc';
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.reason) query.set('reason', params.reason);
  if (params.band) query.set('band', params.band);
  query.set('sort', field);
  query.set('direction', nextDirection);

  return (
    <th className={className} aria-sort={active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link href={`/refunds?${query.toString()}`}>
        {label}
        {active ? (filters.direction === 'asc' ? ' ↑' : ' ↓') : ''}
      </Link>
    </th>
  );
}

export default async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(searchParams);
  const [totals, refunds] = await Promise.all([summariseRefunds(), listRefunds(filters)]);

  return (
    <>
      <h1>Refunds dashboard</h1>
      <p className="lede">Refund requests across every channel, ordered by most recently modified.</p>

      <section className="stage-counts">
        {REFUND_STATUSES.map((status) => (
          <div key={status} className="stage-count">
            <div className="label">{REFUND_STATUS_LABELS[status]}</div>
            <div className="value">{totals.counts[status]}</div>
          </div>
        ))}
        <div className="stage-count">
          <div className="label">Value pending</div>
          <div className="value">{formatMoney(totals.pendingValueCents, totals.currency)}</div>
        </div>
      </section>

      <form className="filters" method="get">
        <label className="field">
          Search
          <input
            type="search"
            name="q"
            placeholder="Reference or customer"
            defaultValue={searchParams.q ?? ''}
          />
        </label>
        <label className="field">
          State
          <select name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">All states</option>
            {REFUND_STATUSES.map((status) => (
              <option key={status} value={status}>
                {REFUND_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Reason
          <select name="reason" defaultValue={searchParams.reason ?? ''}>
            <option value="">All reasons</option>
            {REFUND_REASON_CODES.map((reason) => (
              <option key={reason} value={reason}>
                {REFUND_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Amount
          <select name="band" defaultValue={searchParams.band ?? ''}>
            <option value="">Any amount</option>
            {(Object.keys(AMOUNT_BANDS) as AmountBand[]).map((band) => (
              <option key={band} value={band}>
                {AMOUNT_BANDS[band].label}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="sort" value={filters.sort ?? 'modified'} />
        <input type="hidden" name="direction" value={filters.direction ?? 'desc'} />
        <button type="submit" className="primary">
          Apply
        </button>
        <Link href="/refunds">Reset</Link>
      </form>

      <table>
        <thead>
          <tr>
            <SortableHeader field="reference" label="Refund" params={searchParams} filters={filters} />
            <SortableHeader field="customer" label="Customer" params={searchParams} filters={filters} />
            <SortableHeader field="amount" label="Amount" params={searchParams} filters={filters} className="numeric" />
            <th>Reason</th>
            <th>Channel</th>
            <SortableHeader field="status" label="State" params={searchParams} filters={filters} />
            <th>Requested by</th>
            <SortableHeader field="modified" label="Modified" params={searchParams} filters={filters} />
          </tr>
        </thead>
        <tbody>
          {refunds.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
                No refunds match these filters.
              </td>
            </tr>
          ) : (
            refunds.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/refunds/${item.id}`}>{item.refundRef}</Link>
                </td>
                <td>{item.customerName}</td>
                <td className="numeric">{formatMoney(item.amountCents, item.currency)}</td>
                <td className="muted">{REFUND_REASON_LABELS[item.reasonCode]}</td>
                <td className="muted">{item.channel.replace('_', ' ')}</td>
                <td>
                  <RefundStatusPill status={item.status} />
                  {item.awaitingSecondApproval ? (
                    <>
                      {' '}
                      <span className="pill">Awaiting 2nd approval</span>
                    </>
                  ) : null}
                </td>
                <td className="muted">{item.requestedByName}</td>
                <td className="muted">{formatDateTime(item.modifiedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
