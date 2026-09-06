import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

/**
 * The refunds migration runs against databases that already hold refund rows
 * from the KYC release, so it has to backfill the new required columns rather
 * than add them in place.
 */

const MIGRATIONS = path.join(process.cwd(), 'lib', 'db', 'migrations');

function apply(db: Database.Database, file: string): void {
  const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) db.exec(statement);
}

function migrationTags(): string[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => `${entry.tag}.sql`);
}

describe('the refunds migration', () => {
  it('upgrades a populated database and keeps its refunds', () => {
    const tags = migrationTags();
    const refundsMigration = tags[tags.length - 1];
    const db = new Database(':memory:');
    for (const tag of tags.slice(0, -1)) apply(db, tag);

    db.exec(
      `INSERT INTO customers (id, name, subject_type, email, country, kyc_status, created_at)
       VALUES ('cus_1', 'Existing Customer', 'individual', 'a@example.com', 'IE', 'approved', 1)`,
    );
    db.exec(
      `INSERT INTO users (id, name, email, role, created_at)
       VALUES ('usr_1', 'Priya Raman', 'p@example.com', 'support_agent', 1)`,
    );
    db.exec(
      `INSERT INTO refund_requests
         (id, refund_ref, customer_id, amount_cents, currency, reason_code, status, requested_by_id, created_at, modified_at)
       VALUES ('rfd_1', 'RFD-9001', 'cus_1', 2450, 'EUR', 'fraud', 'requested', 'usr_1', 1, 1)`,
    );

    apply(db, refundsMigration);

    const refund = db
      .prepare('SELECT refund_ref, customer_id, transaction_id, channel FROM refund_requests')
      .get() as { refund_ref: string; customer_id: string; transaction_id: string; channel: string };
    expect(refund.refund_ref).toBe('RFD-9001');
    expect(refund.customer_id).toBe('cus_1');
    expect(refund.channel).toBe('card');

    const transaction = db
      .prepare('SELECT customer_id, amount_cents FROM transactions WHERE id = ?')
      .get(refund.transaction_id) as { customer_id: string; amount_cents: number };
    expect(transaction.customer_id).toBe('cus_1');
    expect(transaction.amount_cents).toBe(2450);

    db.close();
  });
});
