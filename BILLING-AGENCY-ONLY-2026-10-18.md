# Twanova Workforce Communications Hub — Agency-only Billing Decision
Decision date: 2026-10-18
Decision owner: Twanova
Mode: planning / development branch only; NO LIVE CHARGES.

## Who pays
- **Staffing agencies are the only paying customers.**
- **Temp workers are always free to access their authorized workflow.**
- **Client supervisors / client HR users are always free to access their authorized workflow.**
- Agency owners/admins manage the agency subscription; workers and client_hr cannot open billing admin API.
- Plan limits must apply to agency usage (offices, active workers, locations or monthly volume), not require an individual worker or client to pay.

## Changes staged in branch `launch-hardening-2026-10-18`
- `services/billingPolicy.js`: agency-only role policy, statuses.
- `database/schema.sql`: `agency_billing` row scoped by agency, nullable Stripe IDs and subscription metadata.
- `routes/billing.js`: authenticated, owner/admin-only **read-only** GET /api/billing/status, with `checkout_enabled:false`.
- `server.js`: mounts the billing route and stages stronger production session cookie/secret configuration.
- `test/billing-policy.js`: assertions for agency/worker/client privileges.
- No Stripe Checkout sessions, products, payment links, invoices, trials, subscriptions, webhooks or charges were created.

## Plan pricing (NOT APPROVED)
Agency tiers, setup fees, trial duration, inclusive worker/site caps and overages are **not yet selected**. Avoid representing earlier brainstorming ($1,999 setup, six tiers, etc.) as contracted pricing.

## Required next engineering work
1. Verify production SESSION_SECRET and deployed NODE_ENV before deploying the staged production fail-closed configuration. Use a shared session store before scaling to multiple replicas. Never read/print secrets into chat.
2. Add state-changing request CSRF protection, signup/login rate limits, session rotation after sign-in, verified email, audit logging and tenant-scope tests.
3. Choose Stripe TEST MODE access; create catalog prices only when approved and in test mode. Never switch to live mode implicitly.
4. Build agency-only Stripe Checkout, customer portal, subscription webhook with signature verification, idempotency and out-of-order event handling; server-derived agency IDs only.
5. Enforce agency entitlements without locking workers or client supervisors out of critical existing-shift communications during billing problems.
6. Complete billing tests: checkout, failed payment, paused/canceled, trials, duplicate webhooks, unauthorized account attempts, refunds and data retention.
7. Wire an Agency Billing page to read-only status initially; remove any mock “pay now” button until Stripe test mode works.
8. Merge and deploy only after tests and review, with a rollback plan.

## Launch status
**Not approved for public release**. Three-account integration test is deferred at owner's request, not waived. Security, restoration, billing and agency UI integration tests remain outstanding.
