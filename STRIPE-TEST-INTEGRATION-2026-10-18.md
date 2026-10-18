# Twanova agency-only billing sandbox integration — October 18, 2026

Development branch ONLY: `launch-hardening-2026-10-18`. Not live. No test keys or Stripe prices are configured, no charges have been made.

## Confirmed business policy
Agency pays; temp workers and client supervisors pay nothing.
Starter $149/mo (25 active workers), Growth $399/mo (100), Professional $799/mo (250), Enterprise negotiated.

## Staged implementation
- `services/pricingCatalog.js`: fixed USD monthly plans.
- `services/stripeTest.js`: refuses payment setup unless `ENABLE_STRIPE_TEST_CHECKOUT=true`, a key beginning `sk_test_`, signed webhook secret, and all three test Price IDs.
- `routes/billing.js`: agency-admin-only read-only status and plans; authenticated POST `/api/billing/test-checkout` for a server-side allowlisted Price ID; derives agency from the session, not browser data.
- `routes/billingWebhook.js`: signed, test-event-only Stripe webhooks, no session required; handled before JSON parsing at `/api/billing/test-webhook`; event-ID ledger for duplicate suppression.
- `database/schema.sql`: agency subscriptions and event ledger.
- `public/manager/billing-preview.html`: currently informational; no enabled checkout.
- `package.json`: Stripe SDK dependency; ensure lockfile/dependency installation works before merging.

## Environment vars needed on an isolated TEST deployment
`ENABLE_STRIPE_TEST_CHECKOUT=true`
`STRIPE_TEST_SECRET_KEY=sk_test_...`
`STRIPE_TEST_WEBHOOK_SECRET=whsec_...`
`STRIPE_TEST_PRICE_STARTER=price_...`
`STRIPE_TEST_PRICE_GROWTH=price_...`
`STRIPE_TEST_PRICE_PROFESSIONAL=price_...`
`BILLING_TEST_RETURN_ORIGIN=https://your-isolated-test-domain.example`
`SESSION_SECRET=<random >=32 characters>`
`NODE_ENV=production`

Do not put secrets in GitHub, notes or ChatGPT. The connected TWANOVA Stripe session is currently LIVE; do not generate test credentials from that live session or enable live checkout. Use an isolated Stripe sandbox.

## Required before merge
- Fix and test webhook event ordering and subscription-change transitions against Stripe's exact current schema. `checkout.session.completed` must not prematurely grant paid entitlements; fetch authoritative subscription state from Stripe or await signed subscription status events.
- Verify event mapping for all Stripe lifecycle states and a customer/agency association resistant to forged account references and duplicate subscriptions.
- Add database constraints and tests for duplicate subscriptions, retries, failed payments, cancellation and renewal.
- Review current server's cookie-session and MemoryStore risks; add durable sessions, CSRF protections, rate limiting and login session rotation.
- Confirm session secret exists before merging production fail-closed configuration.
- Test that no client/worker endpoints are gated by unpaid billing.
- Verify database migration and restoration on throwaway SQLite database and backup before deploying.
- Reconcile package lockfile, CI/syntax tests, create test mode Stripe products/prices, and verify webhook signatures in integration tests.
- Conduct previously deferred three-role pilot before public launch.

**Status:** code scaffold staged. No test checkout has been exercised, webhook correctness is NOT verified, production release blocked.
