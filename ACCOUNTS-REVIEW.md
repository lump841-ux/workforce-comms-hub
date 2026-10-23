# Account recovery/session local preview — 2026-10-23

Based on combined review566ac61. No production migration, deployment, messages, credential setup or remote publication.

## Implemented
- Password recovery request/reset endpoints with generic eligible-account response, IP and hashed-email throttles,32-byte random tokens stored only as SHA-256 digests,30-minute expiry, supersession and single-use transactional reset.
- Explicit `NODE_ENV=test` plus `RECOVERY_DELIVERY=mock` is the only supported delivery adapter. Private bounded process-memory test outbox; no public token-return endpoint. **Recovery remains unavailable503 outside explicit test mode. No real email integration is finished.**
- Validated canonical `APP_BASE_URL` origin; token links use URL fragment, reset page removes fragment immediately and has no-referrer policy. New recovery mutations require JSON and reject foreign Origin/cross-site Fetch Metadata. This is not comprehensive application CSRF protection.
- Session ID regenerated and saved after login, agency/client signup and invitation acceptance. User auth_version increments on password reset, revoking old sessions. Every API request rechecks current active/unarchived user, role, agency/client organization and selected active client relationship.
- Selected client agency remains selected if authorized; a revoked selected relationship invalidates session rather than silently selecting another. Login/switcher exclude archived or incorrectly scoped clients.
- Legacy temp/client invitation acceptance now transactional with rollback and replay checks. Existing plaintext invite token URLs and status contracts remain compatible. No expiry/hashed invitation migration in this batch.
- Login recovery link implemented and unsupported “40+” customer/SLA claims removed in preview. Recovery pages state delivery must be configured.
- Old developer reset now unavailable in production, and nonproduction reset also revokes old sessions.

## Verification
Final aggregate: **479 Node checks passed, zero failed in the initial full run**:142smoke+50critical+54CSV+141messaging API+26rendering+19practice+47accounts. See `evidence/accounts-full-tests.txt`. New cases cover generic/disabled delivery, token secrecy, expiry/replay/supersession, throttle, reset/invite rollback, archived accounts/relationships, session rotation/revocation and CSV draft invalidation. Account tests use disposable local SQLite and private test outbox only. An additional four signup session-rotation checks then passed (51 account checks total); `evidence/final-integrated-tests.txt` is the final integrated run. No browser/device UI acceptance claim.

Existing stale-session tests now expect401 rather than403 because invalidation occurs before the route-level permission guard. CSV tests obtain a fresh login before each independently mutated principal case. Earlier403-only baseline evidence remains preserved.

## Migration and release limits
- Additive auth_version column and reset-token table tested only on local disposable DBs. Existing legacy sessions lack auth_version and will need to sign in again after a reviewed rollout. No live database was opened or migrated.
- Deployment still uses express-session MemoryStore and lacks reviewed persistent store, Secure/SameSite/proxy settings. Existing broad CSRF protection is unresolved; new route checks do not solve legacy forms. These remain release gates.
- Tokens for existing invitations remain plaintext/nonexpiring until a separately reviewed versioned migration; internal team invitation still creates an account with temporary password and needs redesign.
- Mail delivery credentials/provider, sender verification, delivery retry/failure UX and actual customer reset journey remain blocked. No Gmail/SMTP connection was made.
- Mock throttle/outbox are process-local and not a production multi-instance rate limiter or queue. Real delivery enablement must replace these after review; simply setting production mode cannot activate mock delivery.
