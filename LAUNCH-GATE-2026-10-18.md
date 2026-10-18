# Twanova Workforce Communications Hub — Agency, Billing & Security Launch Gate
**Date:** 2026-10-18
**Decision:** NOT READY FOR PUBLIC LAUNCH. Private prototypes and existing operational app remain available.
**Scope:** Stage preparations without executing the deferred three-role scenario test.

## 1. Agency design integration
- Approved static mockup: staffing-ai-manager branch twanova-workforce-hub-test, path twanova-workforce-test/agency.html (large, mock/localStorage; no live API fetch).
- Existing operational panel: public/manager/dashboard.html, /api/manager endpoints (overview, temps, clients, sites, shifts, messages, attendance, replacements, escalations, archive, reports, team and offices).
- Next build: port *presentation layer* section-by-section into authenticated operational origin. Bind requests to actual API; remove demo localStorage mutations and sample records, confirm permissions and empty/error states. Preserve operational dashboard until each new module passes review.
- Client prototype client.html is also static; keep its integration as a separate workstream.
- Acceptance: agency roles see agency-scoped production data; create/invite/assign/replace/archive workflows persist; cross-tenant access denied; phone and desktop layout work.

## 2. Stripe & commercial launch
- Connected Stripe session shows 'TWANOVA.' account in LIVE mode. DO NOT create real prices, subscriptions, trials, or charges until owner approves final plans and test environment is set up.
- No verified automated Stripe Billing integration or webhook activation in repo inspected. Do not treat prior proposed tiers or $1,999 setup as approved pricing.
- Choose commercial terms in writing: each tier's included active workers/sites/offices, monthly rate, setup fee, trial duration, limits, add-on fees, cancellation/refund policy, tax handling, whether agency owner pays and client/worker remain free.
- Implement: per-agency Stripe customer; Checkout/Billing subscription setup; webhook signature verification with raw body; idempotent subscription status updates; trial and payment failure/dunning handling; Customer Portal; billing access restricted to owner/admin; local tenant entitlements and feature gates; server-side lifecycle handling.
- Stage sandbox first with success, failure, cancellation, expiration, refunds and duplicate/out-of-order webhook events. Never assume redirect means payment succeeded.
- Live activation requires owner's explicit confirmation.

## 3. Security hardening findings
- server.js currently permits fallback session secret and default in-memory session store: unacceptable for public launch or multi-instance reliable login. On separate branch launch-hardening-2026-10-18, staged production-only requirement for >=32 char SESSION_SECRET, secure/sameSite session cookies and Railway reverse proxy trust. NOT DEPLOYED to production; cannot merge until actual Railway secret/environment values are confirmed.
- Before launch, replace MemoryStore with durable shared session storage suitable for the deployment, and implement session renewal/rotation on authentication.
- CSRF protection for state-changing cookie-authenticated endpoints has not been verified; implement CSRF token or robust Origin/Fetch-Metadata checks. SameSite=Lax alone is not sufficient.
- Validate invites expiration and token hashing, login/signup throttling, safe password reset, secure media uploads and antivirus/file-type/size restrictions; do not trust user-supplied photo data URLs.
- Confirm multi-tenant and site scope on *each* manager/client/worker read/write API, least-privileged recruiter/admin roles, and archived/inactive users cannot log in.
- Publish privacy policy, terms and data retention/deletion rules, access logs, incident response and employee location/photo consent where relevant. Consult counsel on staffing/payroll, messaging, and privacy duties.
- Database uses SQLite on a Railway volume; verify encrypted backup schedule, tested restore, maintenance and rollback. Health 200 is not evidence of recoverability.
- Background no-show and escalation scanners act every minute. Isolate fake test shifts and verify no inadvertent notifications to actual workers.

## 4. Release gate (deferred tests)
- Agency UI feature completeness — OPEN
- Client UI integration — OPEN
- Billing sandbox checkout/webhooks — NOT TESTED
- Security review & tenant isolation — NOT TESTED
- Session secret / shared session store — OPEN
- Backups / restore and migration rollback — NOT TESTED
- Load, mobile, accessibility checks — NOT TESTED
- Three-role end-to-end pilot — DEFERRED BY OWNER, REQUIRED BEFORE PUBLIC LAUNCH
- Signed commercial terms and policies — OPEN
**Public launch authorization: BLOCKED**

## Safe next steps
1. Owner reviews the approved agency prototype and commercial pricing/tiers.
2. Wire Agency mockup to operational APIs in an isolated branch, beginning Overview / Workers / Shifts / Clients, then remaining tabs.
3. Build Stripe integration in test mode and stage billing UI without exposing live checkout.
4. Merge security improvements only after environmental prerequisites are verified, with a rollback plan.
5. Conduct final private acceptance suite, including the deferred three-person test, before enabling paid production signup.
