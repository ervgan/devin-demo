'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { switchActor } from '@/app/actions';
import { ROLE_LABELS, type Actor } from '@/lib/rules/types';

const NAV_ITEMS = [
  { href: '/kyc', label: 'KYC Review' },
  { href: '/refunds', label: 'Refunds' },
  { href: '/flags', label: 'Feature Flags' },
];

export function NavShell({ actor, users }: { actor: Actor; users: Actor[] }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="brand">Internal Tools</span>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? 'active' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="switcher">
        <span className="badge">dev only</span>
        <label htmlFor="actor">Acting as</label>
        <select
          id="actor"
          value={actor.id}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            startTransition(() => {
              void switchActor(next);
            });
          }}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} — {ROLE_LABELS[user.role]}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
