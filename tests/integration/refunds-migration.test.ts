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

function migrationFile(prefix: string): string {
  const file = fs.readdirSync(MIGRATIONS).find((name) => name.startsWith(prefix));
  if (!file) throw new Error(`No migration starting with ${prefix}`);
  return file;
}

describe('0001 refunds migration', () => {
  it('upgrades a populated database and keeps its refunds', () => {
    const db = new Database(':memory:');
    apply(db, migrationFile('0000'));

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

    apply(db, migrationFile('0001'));

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
