# Internal Tools Platform (prototype)

Replacement for three Power Apps internal tools: a KYC review queue, a refunds
dashboard and a feature-flag admin panel.

See `Context.md` for the target architecture.

## What the prototype is

A fintech runs three internal tools as separate Microsoft Power Apps. Each app
re-implements the same business rules (who may approve what, when a customer's
KYC blocks a refund, which roles may read the audit trail) with no compiler and
no shared tests, so the rules drift apart. This prototype rebuilds the three
tools as one Next.js app on one SQLite database to show a different shape: every
business rule is a pure function in `lib/rules`, tested once, and imported by
whichever screen needs it.

It is a working prototype, not a production system. Authentication is stubbed
(a dev-only actor switcher in the nav picks one of the seeded users), while
authorization is real and enforced by `lib/rules`. Real SSO, KYC vendor
integrations, notifications and deployment are deliberately out of scope.

## What it does

The seeded database contains four roles — two compliance analysts, a support
agent, an engineer and an admin — plus enough customers, KYC cases, refunds and
flags that every rule below can be exercised without editing data first. Every
state change in every module is written to one append-only `audit_log` table.

**KYC review queue** (`/kyc`) — compliance analysts work cases through
Capture → Enrichment → Due Diligence → Fulfilment, then approve or reject them.

- Only compliance analysts may advance, assign, verify documents on, or decide a
  case; support agents never touch KYC.
- A case cannot leave Due Diligence, and cannot be approved, while any checklist
  document is still missing.
- Approval also requires the case to have reached Fulfilment and to have an
  assigned reviewer; rejection and information requests require a written reason.
- Approved and rejected cases are immutable.

**Refunds dashboard** (`/refunds`) — support agents and compliance analysts
review refund requests through Requested → Under Review → Approved → Settled
(or Rejected).

- Refunds of €1,000 and above need two approvals, and the second approver must
  be a different person from the first.
- Only the pending second approver may ask the requester for more information.
- When the `refunds.require_kyc_approval` flag is on, a refund can only be
  approved if the customer's KYC case is approved. The block is derived on every
  read, so it lifts as soon as the case is approved or the flag is turned off.
- Rejections and internal notes require text; settled and rejected refunds can
  no longer be decided, though internal notes may still be added.

**Feature-flag admin** (`/flags`) — flags hold one value per environment
(dev / staging / prod), have an owner, and are editable by admins only. No
module consumes a flag unless a rule explicitly asks for it (currently only the
KYC gate on refund approval).

**Audit history** — each record's page shows its audit trail, gated per module:
compliance analysts see everything, support agents see only the refunds they
own, and engineers and admins see flag changes only.

Every denied action surfaces the rule's own reason text in the UI, so the
message a user sees is the same string the unit tests assert on.

## Running

```bash
npm install
npm run dev
```

The SQLite database is created, migrated and seeded automatically on first
request, at `data/app.db`. Delete that file to reset to the fixtures.

There is no authentication. The nav shell has a dev-only actor switcher; the
selected user's role drives every permission check.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the app |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, strict mode |
| `npm test` | Vitest unit and integration tests |
| `npm run db:generate` | Regenerate migrations after a schema change |

## Layout

```
app/            Routes: kyc, refunds and flags
components/     Shared UI
lib/rules/      All business logic. Pure functions returning allowed/denied + reason
lib/db/         Drizzle schema, migrations, seed fixtures
lib/audit/      The only writer of the append-only audit_log table
lib/kyc/        KYC queries and transition service (loads state, applies lib/rules, persists)
lib/refunds/    Refund queries and decision service (same shape as lib/kyc)
lib/flags/      Flag queries and value-change service (same shape as lib/kyc)
tests/          Unit tests per rule module, integration tests per cross-module behaviour
```

Business rules live only in `lib/rules`. UI and service code import them and
render the reason they receive; no module re-implements a rule, and nothing
outside `lib/audit` writes the audit table.
