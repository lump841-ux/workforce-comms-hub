# Session storage and CSRF — local security preview

Base `55ab55b`; isolated branch `review/session-csrf-preview-2026-10-23`. No live configuration, migration, secret provisioning, deployment, remote publication, messages or charges.

## Inspected architecture and changes
- All operational mutation callers use JavaScript JSON APIs: shared `public/app.js`, worker mobile inline API helper, and recovery UI. Existing HTML forms prevent native submission. Read-only invitation fetches unchanged. The separate Bun public prototype is not the operational authenticated backend.
- Existing `node:sqlite` database now backs an express-session Store with get/set/touch/destroy callbacks. No new dependency. Sessions survive restart with the same configured signing secret/database volume. Seven-day absolute server lifetime; expiry is checked on read. Activity-triggered cleanup redacts expired session content and removes ID-only tombstones after a retention window. Tombstones and carried immutable issue times prevent delayed writes reviving logged-out/expired sessions, including after cleanup. Conditional SQL prevents a racing save from replacing revoked tombstone content.
- Cookies explicitly HttpOnly/SameSite=Lax, Secure for HTTPS canonical origin. Production configuration fails closed unless HTTPS `APP_BASE_URL` and a >=32-byte `SESSION_SECRET` (known former fallback rejected) are supplied. Unconfigured development uses a fresh ephemeral process secret, so restart deliberately requires login; no fixed fallback secret. Local canonical default is exactly `http://localhost:4400`; other ports/origins require explicit `APP_BASE_URL` override.
- Proxy trust remains disabled by default. Only explicitly supplied IP/CIDR values through `SESSION_TRUST_PROXY` are accepted, not booleans, hop counts, hostnames or all-address `/0`. HTTPS cookie behavior does not silently trust forwarded headers. A trusted proxy deployment must be verified before configuring its actual range.
- Every unsafe `/api` method requires `application/json` and public custom header `X-Twanova-CSRF: 1`, rejects foreign/null Origin and cross-site/same-site Fetch Metadata. Exact canonical origin only; no reflected Host/Origin. Missing Origin is allowed only with the non-simple header/JSON requirements; no CORS permission exists. This is a **custom-header/preflight defense**, not a secret synchronizer token. Cross-origin attacker JavaScript cannot send the marker without a permitted CORS preflight. The marker is not authentication and does not defend against XSS.
- Audit identified one business mutation on GET: conversation read status. GET is now read-only; authorized POST `/conversations/:id/read` handles acknowledgement, called explicitly by the three dashboards. Reply POST retains its existing atomic sender acknowledgement.
- Operational API test helpers now send the same public header as real callers. No test bypass of CSRF, origin or session checks was added.

## Verification
- New session/CSRF suite:89 checks passed, zero failed (88 independently rerun before the final known-fallback-secret assertion).
- Existing1156 regression checks passed with actual CSRF header enforcement enabled. Final combined execution:1245 Node checks and21 Bun HTTP checks passed; see `evidence/final-security-integrated-tests.txt` and `evidence/homepage-combined-tests.txt`.
- Checks include SQLite and HTTP restart persistence, logout/expiry/touch/absolute lifetime, late save after cleanup, injected concurrent revocation, content redaction, production origin/secret/proxy validation, actual Secure cookie emission behind explicitly trusted loopback and no emission when forwarding is spoofed, foreign preflight/no permissions/no writes, false/null origins, content-type tricks, legitimate agency/client/worker actions, safe GET and authorized read acknowledgement.
- All data is synthetic, on throwaway local SQLite files and loopback HTTP. Node VM/client serialization tests are not actual browser/device acceptance.

## Deployment and residual gates
**Not production-ready or deployed.** Real hosting topology, TLS termination, trusted proxy ranges, canonical origin, secret entropy/storage/rotation, persistent writable volume, file access/encryption/backups, SQLite multi-process contention and rollout/rollback are unverified. Do not configure broad proxy trust or add permissive CORS to make an error disappear. A production server behind an unconfigured proxy intentionally cannot set a Secure cookie through plain HTTP.

Use `NODE_ENV=production` explicitly in a reviewed deployment; development defaults are not deployment configuration. The Store persists session identity and optional CSV draft data in the same application DB, not an encrypted session vault. Cleanup runs during activity, not a separate scheduler; expired sessions are denied even before cleanup. Tombstones contain IDs/timestamps only. Existing legacy sessions still require sign-in after reviewed rollout. No actual customer session was changed here.

Real recovery/invitation delivery, versioned hashed/expiring legacy invites, browser/device flows, real paid activation, bilingual runtime verification and remaining business-state policies remain separate release gates. This patch does not configure them.

## Design sources
- Installed `express-session` README: Session Store Implementation and secure-cookie/proxy options (locked dependency inspected locally).
- OWASP CSRF Prevention Cheat Sheet, custom request headers for AJAX/API and disallowing simple content types: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
