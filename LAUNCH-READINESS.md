# Launch readiness: data preservation first

The live Railway `web` service has no persistent volume configured (verified October 15, 2026). The app defaults to SQLite at `database/hub.db` when `DB_PATH` is unset. **Do not simply attach an empty volume and change `DB_PATH` without checking and preserving existing records.**

## Safe steps before touching production

1. Confirm whether real agency, temp, client, or shift records have been entered. Treat existing data as valuable until verified otherwise.
2. Take a transactionally consistent backup of the existing SQLite database (including WAL state if enabled). Verify tables and row counts, and test restoring the backup to an isolated environment. Do not publish this backup to GitHub.
3. Decide between a mounted SQLite database for one replica (quick pilot) or managed PostgreSQL for scaling. A durable database is recommended long term.
4. Provision Railway persistent volume mounted at `/data` **on the actual backend service** and configure `DB_PATH=/data/hub.db` only after a migration/restore plan exists. Check that the host region and replicas permit single-writer SQLite.
5. Restore the database onto the durable path, validate tenant ownership and record counts, then redeploy and confirm the data survives an additional controlled restart.
6. Configure tested encrypted backups, access controls, monitoring and an incident/restore runbook.
7. Replace express-session's default in-memory store with a shared persistent session store; secure cookies behind Railway's proxy and verify login/session behavior.
8. Run `node scripts/launch-preflight.js` in the production-like environment, then run integration tests, test multi-tenant isolation and mobile workflows, and only then enroll pilot customers.

## Guardrails

- Never move or expose users' existing personnel records without a verified backup and rollback plan.
- This branch changes **no production database connection or Railway variable**.
- The scanner is read-only and intentionally fails if no DB_PATH or sufficiently strong SESSION_SECRET is configured. A passing scan is **not** a certification of deployment readiness.
- Stripe live subscriptions, SMS/email delivery, photo-storage security, privacy terms, and supervisory approval still require independent testing.
