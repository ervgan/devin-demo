import Link from 'next/link';
import { FlagToggle } from '@/components/FlagToggle';
import { formatDateTime } from '@/components/Pills';
import { listFlags } from '@/lib/flags/queries';
import { getCurrentActor } from '@/lib/session';
import { mayEditFlags } from '@/lib/rules';
import { ENVIRONMENTS, ENVIRONMENT_LABELS } from '@/lib/rules/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { status?: string; notice?: string };
}

export default async function FlagsPage({ searchParams }: PageProps) {
  const [flags, actor] = await Promise.all([listFlags(), getCurrentActor()]);
  const editing = mayEditFlags(actor);

  return (
    <>
      <h1>Feature flags</h1>
      <p className="lede">
        One value per environment. Every change is written to the audit log; open a flag for its
        change history.
      </p>

      {searchParams.notice ? (
        <div className={`notice ${searchParams.status === 'allowed' ? 'allowed' : 'denied'}`}>
          {searchParams.notice}
        </div>
      ) : null}

      <p className="muted">
        Acting as {actor.name}. {editing.reason}
      </p>

      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>Description</th>
            <th>Owner</th>
            {ENVIRONMENTS.map((environment) => (
              <th key={environment}>{ENVIRONMENT_LABELS[environment]}</th>
            ))}
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <tr key={flag.key}>
              <td>
                <Link href={`/flags/${encodeURIComponent(flag.key)}`}>
                  <code>{flag.key}</code>
                </Link>
              </td>
              <td className="muted">{flag.description}</td>
              <td>{flag.owner}</td>
              {flag.values.map((value) => (
                <td key={value.id}>
                  <FlagToggle
                    flagKey={flag.key}
                    environment={value.environment}
                    enabled={value.enabled}
                    editable={editing.allowed}
                    reason={editing.reason}
                    returnTo="/flags"
                  />
                </td>
              ))}
              <td className="muted">{formatDateTime(flag.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
