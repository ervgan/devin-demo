import { integer } from 'drizzle-orm/sqlite-core';

/**
 * Single place where the timestamp storage choice lives.
 *
 * Timestamps are stored as epoch milliseconds and always surfaced as `Date`.
 * Swapping to Postgres means changing this helper to `timestamp(name, { withTimezone: true })`
 * and nothing else in the schema or the queries.
 */
export function timestampCol(name: string) {
  return integer(name, { mode: 'timestamp_ms' });
}

/** Booleans are stored as integers in SQLite and surfaced as `boolean`. */
export function booleanCol(name: string) {
  return integer(name, { mode: 'boolean' });
}
