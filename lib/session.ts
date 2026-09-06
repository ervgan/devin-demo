import { cookies } from 'next/headers';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { users, type User } from '@/lib/db/schema';
import { toActor } from '@/lib/actors';
import type { Actor } from '@/lib/rules/types';

export const ACTOR_COOKIE = 'devtools_actor_id';

export async function listUsers(): Promise<User[]> {
  return getDb().select().from(users).orderBy(asc(users.name));
}

/**
 * Authentication is stubbed: the current actor comes from a dev-only cookie set
 * by the user switcher. Authorization is real and lives in lib/rules.
 */
export async function getCurrentActor(): Promise<Actor> {
  const db = getDb();
  const selected = cookies().get(ACTOR_COOKIE)?.value;

  if (selected) {
    const [user] = await db.select().from(users).where(eq(users.id, selected)).limit(1);
    if (user) return toActor(user);
  }

  const [fallback] = await db.select().from(users).orderBy(asc(users.name)).limit(1);
  if (!fallback) {
    throw new Error('No seeded users found; the database has not been initialised.');
  }
  return toActor(fallback);
}
