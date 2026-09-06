# Internal Tools Platform (prototype)

Replacement for three Power Apps internal tools. This repository currently contains
the platform scaffold and the KYC review queue; refunds and feature flags are
seeded in the database but their screens are not built yet.

See `Context.md` for the target architecture.

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
app/            Routes: kyc (built), refunds and flags (placeholders)
components/     Shared UI
lib/rules/      All business logic. Pure functions returning allowed/denied + reason
lib/db/         Drizzle schema, migrations, seed fixtures
lib/audit/      The only writer of the append-only audit_log table
lib/kyc/        KYC queries and transition service (loads state, applies lib/rules, persists)
tests/          Unit tests per rule module, integration tests per cross-module behaviour
```

Business rules live only in `lib/rules`. UI and service code import them and
render the reason they receive; no module re-implements a rule, and nothing
outside `lib/audit` writes the audit table.
