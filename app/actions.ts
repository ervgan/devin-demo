'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ACTOR_COOKIE } from '@/lib/session';

/** Development-only actor switch. Authentication is stubbed; roles are real. */
export async function switchActor(actorId: string): Promise<void> {
  cookies().set(ACTOR_COOKIE, actorId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
  revalidatePath('/', 'layout');
}
