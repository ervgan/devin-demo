import type { User } from '@/lib/db/schema';
import type { Actor } from '@/lib/rules/types';

/** Narrows a stored user to the shape the rules accept. */
export function toActor(user: User): Actor {
  return { id: user.id, name: user.name, role: user.role };
}
