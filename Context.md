# Internal Tools Platform — Context

## How to use this document
This describes the target architecture for the whole platform.
Build only what the current task asks for. Do not build ahead of
the request, even where this document describes behaviour you
have not been asked to implement yet.

## What this is
A prototype replacement for a fintech's three Microsoft Power Apps
internal tools: a KYC review queue, a refunds dashboard, and a
feature-flag admin panel. Users are internal staff: compliance
analysts, support agents, engineers. The engineers will eventually
build 10 more of these apps.

## The one architectural constraint that matters
Business rules live in ONE place: `lib/rules`. UI modules import
them. No module may re-implement or inline a business rule, and no
UI module may read the flags table or the audit table directly —
those go through `lib/rules` and `lib/audit`.

This is the entire point of the prototype. If the same condition 
would appear in two modules, stop and extract it instead.

## Stack
- Next.js (App Router), TypeScript strict mode
- SQLite via Drizzle ORM, seeded with fixture data
- Vitest for unit and integration tests
- One process: `npm run dev` runs everything
- No auth provider. A dev-only user switcher sets the current
  user and role from a seeded users table.

## Folder structure
app/
  kyc/          KYC review queue
  refunds/      Refunds dashboard
  flags/        Feature flag admin
  layout.tsx    Shared nav shell across all three
lib/
  rules/        ALL business logic. Pure functions, no UI imports.
  db/           Schema, migrations, seed
  audit/        Append-only audit log writer
components/     Shared UI
tests/

## Data model
One customers table shared by KYC and refunds, not per-module
copies. One users table. One flags table with a value per
environment (dev/staging/prod). One append-only audit_log table
(actor, action, entity, before, after, timestamp) written by every
state change in every module.

Audit rows are append-only: no update or delete paths exist in
lib/audit, and nothing outside lib/audit writes to that table.

Flags are stored and editable, but no module consumes a flag
value unless a task explicitly asks for it.

## How rules signal denial
Rules in lib/rules return a result object indicating allowed or
denied with a human-readable reason. They do not throw for
business denials and do not render UI. The UI renders the reason
it receives. This keeps denial messages testable without mounting
components.

## Seed data
Seed at least 8 customers spanning every KYC state (pending,
approved, rejected) and both risk levels, and refund requests
attached to customers on both sides of the KYC line — so the allow
path and the deny path are both demonstrable without editing data
first. Seed 3 users: a compliance analyst, a support agent, an
engineer.

## Database portability
SQLite is a prototype choice; production would be Postgres. Write
the schema and all queries so the swap is a dialect and driver
change only. Use Drizzle's query builder — no raw SQL, no
SQLite-specific functions, no reliance on SQLite type coercion.
Store timestamps consistently and keep the choice in one place so
the Postgres column type maps cleanly.

## Testing rules
Every function in lib/rules has unit tests covering both the allow
and the deny path. Every cross-module behaviour has an integration
test. CI runs lint, typecheck and tests. A PR with failing CI is
not ready.

## Dependencies
Ask before adding any dependency not already listed in Stack.
Prefer the standard library and what is already installed.

## PR conventions
- One PR per logical change. Never push to main.
- Title: `<module>: <what changed>`
- Body states: the business requirement in one sentence, which
  files in lib/rules changed, and which tests cover it.
- If a change alters a business rule, say so explicitly in the
  body — a reviewer must see rule changes without reading the diff.

## Out of scope — do not build
Real auth/SSO, real KYC vendor integrations, deployment,
email/notifications, mobile layouts, design polish beyond clean
and legible. Time is the binding constraint. If unsure whether
something is in scope, ask before building it.