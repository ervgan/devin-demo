import type { Metadata } from 'next';
import './globals.css';
import { NavShell } from '@/components/NavShell';
import { getCurrentActor, listUsers } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Internal Tools Platform',
  description: 'KYC review, refunds and feature flag administration.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [actor, users] = await Promise.all([getCurrentActor(), listUsers()]);

  return (
    <html lang="en">
      <body>
        <NavShell
          actor={actor}
          users={users.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
        />
        <main>{children}</main>
      </body>
    </html>
  );
}
