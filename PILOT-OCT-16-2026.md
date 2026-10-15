# Twanova Communications Hub — private three-person pilot, October 16, 2026

**Purpose:** Validate the real operational application using three separately authenticated roles. Do not use Practice Mode. Not an authorization for public launch.

## Test setup
- Agency coordinator, client supervisor and worker each use their own account and device/browser.
- Create a clearly labeled fake shift at a consenting test site. Use minimal volunteered test data; no actual payroll, customer-sensitive info, government IDs or patient details.
- Agency creates its workspace at https://web-production-cd82a.up.railway.app/agency-signup.html, invites worker and client HR contact from manager portal. Each invitee accepts their own link.
- Agree on a time and one person to capture observations. Have the client supervisor's employer approve any testing on site.

## Test scenarios and evidence
| # | Actor | Action | Expected result | Status |
|---|---|---|---|---|
| 1 | Agency | Create workspace/login | Redirect into authorized manager UI | NOT TESTED |
| 2 | Agency | Add client, site and supervisor invitation | Invitee accepts and sees only authorized agency information | NOT TESTED |
| 3 | Agency | Invite temp worker | Worker claims account and sees only own assignments | NOT TESTED |
| 4 | Agency | Create and assign fake test shift | Worker and supervisor see assignment after refresh/poll | NOT TESTED |
| 5 | Worker | On My Way | Agency/supervisor receive appropriate status | NOT TESTED |
| 6 | Worker | Running Late and ETA | Both relevant dashboards reflect change | NOT TESTED |
| 7 | Worker | Arrived and clock in | Attendance updates and audit record | NOT TESTED |
| 8 | Worker | Start/end break | Relevant shift history updates | NOT TESTED |
| 9 | All | Exchange in-app message | Correct recipients see it; no SMS is sent for routine updates | NOT TESTED |
| 10 | Agency/client | Simulate no-show and replacement | Exception and approval flow works; no duplicate worker assignment | NOT TESTED |
| 11 | Worker/client | Clock out and verify hours | Activity visible to authorized users | NOT TESTED |
| 12 | All | Logout/relogin and phone rotation | State persists; pages fit screens; no unauthorized access | NOT TESTED |
| 13 | All | Tap every relevant visible button, open photos and links | Correct navigation and feedback, no broken assets | NOT TESTED |
| 14 | Admin | Restart verification in controlled environment only | Data preserved on durable storage | NOT TESTED |

## Devices and time
- Use three separate sessions simultaneously, preferably two phones (iPhone Safari + Android Chrome if available) and one desktop.
- Check status visibility immediately, at 20 seconds, and after manual refresh. Record actual delay; do not call the system real-time until measured.
- Record time, device, action, expected/observed result, screenshots without sensitive content, console/network errors if available.

## Stop conditions
- Wrong agency can view another agency's workers, messages or shifts.
- Any data loss, account takeover, destructive action, or accidental communication to real workers.
- No-show automated scanning affects real work without advance notice.

## After the session
- Ask each participant: Was the workflow understandable without coaching? What was confusing? Which function would you use daily?
- Categorize P0/P1 defects and repair before adding paying customers. Complete Double Check across security, pricing, legal, billing, capacity and backup recovery before public rollout.

**Current:** Production backend and role dashboards are deployed, but this checklist is NOT a test execution report. Actual multi-device functionality and automatic paid activation remain unverified.
