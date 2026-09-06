import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlagToggle } from '@/components/FlagToggle';
import { FlagStatePill, formatDateTime } from '@/components/Pills';
import { getFlagDetail } from '@/lib/flags/queries';
import { getCurrentActor, listUsers } from '@/lib/session';
import { canViewAuditHistory, flagStateLabel, mayEditFlags } from '@/lib/rules';
import { ENVIRONMENT_LABELS, ENVIRONMENTS, type Environment } from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { flagKey: string };
  searchParams: { status?: string; notice?: string };
}

/** Audit snapshots are stored as JSON, so read them back defensively. */
function readEnvironment(snapshot: Record<string, unknown> | null): Environment | null {
  const value = snapshot?.environment;
  return ENVIRONMENTS.find((environment) => environment === value) ?? null;
}

function readEnabled(snapshot: Record<string, unknown> | null): boolean | null {
  const value = snapshot?.enabled;
  return typeof value === 'boolean' ? value : null;
}

function describeValue(value: boolean | null): string {
  return value === null ? '—' : flagStateLabel(value);
}

export default async function FlagDetailPage({ params, searchParams }: PageProps) {
  const key = decodeURIComponent(params.flagKey);
  const [actor, users] = await Promise.all([getCurrentActor(), listUsers()]);
  const flag = await getFlagDetail(key, actor);

  if (!flag) notFound();

  const editing = mayEditFlags(actor);
  const auditAccess = canViewAuditHistory(actor);
  const returnTo = `/flags/${encodeURIComponent(flag.key)}`;

  return (
    <>
      <p className="muted">
        <Link href="/flags">← Back to flags</Link>
      </p>

      {searchParams.notice ? (
        <div className={`notice ${searchParams.status === 'allowed' ? 'allowed' : 'denied'}`}>
          {searchParams.notice}
        </div>
      ) : null}

      <div className="between">
        <div>
          <h1>
            <code>{flag.key}</code>
          </h1>
          <p className="lede">{flag.description}</p>
        </div>
        <div className="row">
          {flag.values.map((value) => (
            <span key={value.id} className="row">
              <span className="muted">{ENVIRONMENT_LABELS[value.environment]}</span>
              <FlagStatePill enabled={value.enabled} />
            </span>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <h2>Values</h2>
            <table>
              <thead>
                <tr>
                  <th>Environment</th>
                  <th>Value</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {flag.values.map((value) => (
                  <tr key={value.id}>
                    <td>{ENVIRONMENT_LABELS[value.environment]}</td>
                    <td>
                      <FlagToggle
                        flagKey={flag.key}
                        environment={value.environment}
                        enabled={value.enabled}
                        editable={editing.allowed}
                        reason={editing.reason}
                        returnTo={returnTo}
                      />
                    </td>
                    <td className="muted">{formatDateTime(value.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {auditAccess.allowed ? (
          <section className="card">
            <h2>Change history</h2>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Environment</th>
                  <th>Old → new</th>
                </tr>
              </thead>
              <tbody>
                {flag.history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No changes recorded yet.
                    </td>
                  </tr>
                ) : (
                  flag.history.map((entry) => {
                    const environment = readEnvironment(entry.after) ?? readEnvironment(entry.before);
                    return (
                      <tr key={entry.id}>
                        <td className="muted">{formatDateTime(entry.createdAt)}</td>
                        <td>
                          {users.find((user) => user.id === entry.actorId)?.name ?? entry.actorId}
                        </td>
                        <td>{environment ? ENVIRONMENT_LABELS[environment] : '—'}</td>
                        <td>
                          {describeValue(readEnabled(entry.before))} →{' '}
                          {describeValue(readEnabled(entry.after))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
          ) : null}
        </div>

        <section className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>Key</dt>
            <dd>
              <code>{flag.key}</code>
            </dd>
            <dt>Owner</dt>
            <dd>{flag.owner}</dd>
            <dt>Description</dt>
            <dd>{flag.description}</dd>
            <dt>Last updated</dt>
            <dd className="muted">{formatDateTime(flag.updatedAt)}</dd>
          </dl>
          <p className="deny-reason">
            Acting as {actor.name}. {editing.reason}
          </p>
        </section>
      </div>
    </>
  );
}
