# Communications Hub: critical workflow repair review

Prepared October 23, 2026. Review-only changes; not deployed.

## Source and scope

Based on `lump841-ux/workforce-comms-hub` main commit `78c7d62ed957029d6aec8c4db64df68191b79e0e`.
The Railway deployed revision is not yet verified. This is not the static Render demo or the separate staffing product. No database schema migrations are required.

## Repairs

- Manager no-show marking requires the current agency, rejects foreign/missing/archived shifts and prevents duplicate no-show events.
- Manager-triggered no-show scans are agency-scoped and unavailable to recruiters or an account without agency context. Internal scheduled scans retain all-agency scope.
- Automatic scans exclude arrived, supervisor-confirmed and archived shifts and recheck attendance inside the write transaction.
- No-show event, escalation, replacement search and notifications commit atomically.
- Replacement acceptance only accepts an open offered request with an active, unarchived, same-agency candidate and a valid original shift. Closed, stale, declined and repeated claims are rejected.
- Replacement assignment and its notification/audit records are transactional. A failure rolls back the assignment rather than leaving partial records.
- Acceptance rechecks overlapping assignments, including overnight shifts; back-to-back shifts are permitted.
- Replacement supervisor notifications use durable client-organization links instead of a login-dependent client ID.
- Escalation acknowledge/resolve require agency scope; repeated operations are safe and acknowledgment cannot reopen a resolved escalation.

## Evidence

Executed in the cloud workspace with Node v24.19.0, installed locked npm dependencies, and throwaway SQLite databases only.

- Unmodified existing smoke suite: **142 passed, 0 failed** (`evidence/baseline-smoke.txt`).
- Initial critical baseline: **4 passed, 21 failed** (`evidence/baseline-critical.txt`). Additional independent-review regression cases were added after this baseline, so this is not a count comparison to the final 50-case suite.
- Final `npm test`: existing smoke **142 passed, 0 failed**, critical regression **50 passed, 0 failed** (`evidence/fixed-full-tests.txt`). No conditional replacement skips occurred in the existing smoke run.
- `node --check`: all six changed/new JavaScript files passed.
- `git diff --check`: passed.
- An independent source review identified double-booking and escalation-isolation gaps; both were included and retested.

## Test commands

`npm ci --ignore-scripts`

`DB_PATH=/tmp/unique-disposable-hub-smoke.db npm test`

`npm run test:critical`

The existing smoke runner removes the specified DB file at startup: use only a new disposable path. The new critical runner always creates its own temporary directory and ignores inherited DB_PATH.

## Not verified

No production or staging deployment, live account login, real email invitation, Stripe lifecycle, physical-device browser flow, or cross-process load test was performed. SQLite transaction behavior is exercised in-process; no multi-process stress claim is made. Tests do not establish overall product launch readiness, full organization isolation, or that every application route is secure. The remaining app audit must continue.
