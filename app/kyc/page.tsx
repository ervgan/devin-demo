import Link from 'next/link';
import { formatDateTime, RiskPill, StagePill } from '@/components/Pills';
import { countCasesByStage, listCases, type CaseFilters } from '@/lib/kyc/queries';
import { listUsers } from '@/lib/session';
import { toActor } from '@/lib/actors';
import { canReviewCases } from '@/lib/rules';
import {
  CASE_STAGES,
  RISK_RATINGS,
  STAGE_LABELS,
  type CaseStage,
  type RiskRating,
} from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  stage?: string;
  risk?: string;
  assignee?: string;
}

function parseFilters(params: SearchParams): CaseFilters {
  const stage = CASE_STAGES.find((value) => value === params.stage);
  const risk = RISK_RATINGS.find((value) => value === params.risk);
  return {
    search: params.q?.trim() || undefined,
    stage: stage as CaseStage | undefined,
    risk: risk as RiskRating | undefined,
    assigneeId:
      params.assignee && params.assignee !== 'unassigned' ? params.assignee : undefined,
    unassigned: params.assignee === 'unassigned',
  };
}

export default async function KycQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(searchParams);
  const [counts, cases, users] = await Promise.all([
    countCasesByStage(),
    listCases(filters),
    listUsers(),
  ]);

  const reviewers = users.filter((user) => canReviewCases(toActor(user)).allowed);

  return (
    <>
      <h1>KYC review queue</h1>
      <p className="lede">Cases awaiting review, ordered by most recently modified.</p>

      <section className="stage-counts">
        {CASE_STAGES.map((stage) => (
          <div key={stage} className="stage-count">
            <div className="label">{STAGE_LABELS[stage]}</div>
            <div className="value">{counts[stage]}</div>
          </div>
        ))}
      </section>

      <form className="filters" method="get">
        <label className="field">
          Search
          <input
            type="search"
            name="q"
            placeholder="Case ID or name"
            defaultValue={searchParams.q ?? ''}
          />
        </label>
        <label className="field">
          Stage
          <select name="stage" defaultValue={searchParams.stage ?? ''}>
            <option value="">All stages</option>
            {CASE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Risk
          <select name="risk" defaultValue={searchParams.risk ?? ''}>
            <option value="">All ratings</option>
            {RISK_RATINGS.map((risk) => (
              <option key={risk} value={risk}>
                {risk.charAt(0).toUpperCase() + risk.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Assignee
          <select name="assignee" defaultValue={searchParams.assignee ?? ''}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {reviewers.map((reviewer) => (
              <option key={reviewer.id} value={reviewer.id}>
                {reviewer.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary">
          Apply
        </button>
        <Link href="/kyc">Reset</Link>
      </form>

      <table>
        <thead>
          <tr>
            <th>Case</th>
            <th>Subject</th>
            <th>Type</th>
            <th>Stage</th>
            <th>Risk</th>
            <th>Reviewer</th>
            <th>Modified</th>
          </tr>
        </thead>
        <tbody>
          {cases.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No cases match these filters.
              </td>
            </tr>
          ) : (
            cases.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/kyc/${item.id}`}>{item.caseRef}</Link>
                </td>
                <td>{item.subjectName}</td>
                <td className="muted">
                  {item.subjectType === 'individual' ? 'Individual' : 'Organisation'}
                </td>
                <td>
                  <StagePill stage={item.stage} />
                </td>
                <td>
                  <RiskPill risk={item.riskRating} />
                </td>
                <td className={item.reviewerName ? undefined : 'muted'}>
                  {item.reviewerName ?? 'Unassigned'}
                </td>
                <td className="muted">{formatDateTime(item.modifiedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
