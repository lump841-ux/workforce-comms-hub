# Next local preview: recovery and session lifecycle

Scope approved by coordinator from user's release-preparation request; no production changes or messages.

## Existing contracts inspected
- `routes/auth.js`: login and temp/client invitation acceptance populate the same session ID. Invitations are stored as plaintext tokens, with pending/accepted/revoked state but no expiry. Acceptance is several independent writes. Client signup likewise sets a session directly.
- `routes/agencySignup.js`: creates agency and owner, sets session directly.
- `middleware/auth.js`: trusts session user role, without rechecking current user or selected client organization link.
- `/dev/reset-password` requires an environment secret but has no session revocation.
- `/manager/team/invite` creates an active account and returns a temporary password; changing that contract is a separate checkpoint.
- No customer forgot-password flow exists. No verified mail provider/credentials are available.

## Bounded implementation proposal
1. Add user auth_version and reset-token table; no live migration. Hashed cryptographically random reset tokens, short expiry, single use. Generic request response independent of account existence, bounded throttling.
2. Explicit local/test mock outbox, private in-process access for tests only; never HTTP-accessible tokens. Outside explicit test delivery mode return honest service-unavailable response for everyone, not a misleading "email sent". No external sender integration.
3. Canonical URL from explicit validated configuration, never request Host. Password reset atomically claims token, changes hash, increments auth_version and audits; all old sessions lose authorization.
4. Regenerate sessions on login and signup/acceptance. Check current active/unarchived principal, current role and agency; for client_hr preserve selected agency only if active relationship remains. Do not silently grant a different agency when one is revoked.
5. Atomic existing temp/client invitation acceptance, preserving existing token lookup contract in this batch. A future versioned token migration will add hashed/expiring invitations only after mapping pending-link/list UI compatibility. Never invalidate real pending records silently.
6. Tests: unknown/inactive email equivalence, unavailable delivery, bounds/throttle, reset expiry/replay/failure rollback, revoked sessions/roles, client relationship switching/revocation, successful session regeneration, legacy invitation acceptance, duplicate account and atomicity failures.

## Explicit remaining boundaries
No SMTP/Gmail setup, external invitations, production configuration, deployment, or real records. Persistent session store, cookie deployment configuration, comprehensive CSRF policy and team-account invitation redesign require separate review. Current forms/API request patterns need inspection before adding global CSRF behavior.
