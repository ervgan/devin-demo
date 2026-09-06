import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { schema, users } from './schema';
import { seedDatabase } from './seed';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** The database or an open transaction on it. Writers accept either. */
export type DatabaseWriter =
  | AppDatabase
  | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');

function applyMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** A migrated, empty in-memory database. Used by tests. */
export function createInMemoryDatabase(): AppDatabase {
  const db = drizzle(new Database(':memory:'), { schema });
  applyMigrations(db);
  return db;
}

let cached: AppDatabase | null = null;

/**
 * The application database. Migrated on first use and seeded when empty so
 * `npm run dev` is the only command needed to get a working environment.
 */
export function getDb(): AppDatabase {
  if (cached) return cached;

  const file = process.env.DATABASE_URL ?? path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = drizzle(new Database(file), { schema });
  applyMigrations(db);

  const existing = db.select({ id: users.id }).from(users).limit(1).all();
  if (existing.length === 0) {
    db.transaction((tx) => {
      seedDatabase(tx);
    });
  }

  cached = db;
  return db;
}
