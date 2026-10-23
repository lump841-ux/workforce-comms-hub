# Worker CSV import: review-only implementation

Based on the locally reviewed critical repair commit 7055bc9, itself based on Communications Hub main 78c7d62. No production publication or real invitations were sent.

## What is implemented

Workers screen links to a dedicated CSV import page. The agency user chooses a file, previews every row, corrects errors, then explicitly confirms creation of pending invitation links. Workers are not active accounts until they use an invitation to choose their own password, matching the existing individual invitation flow. No temporary passwords are generated, and the import does not send email, SMS or other messages.

- Up to 500 rows / 128 KB, with bounded fields and strict CSV quoting/header validation.
- UTF-8 BOM, CRLF/LF, quoted commas and escaped quotation marks supported.
- Required full_name/email and optional phone. Unknown columns, including password or agency identifiers, are rejected.
- Case-insensitive duplicates within the file and existing records in the current agency are skipped without overwriting records.
- Unavailable registered email addresses get a generic error, without revealing another agency's data. This existing single-home-agency account model does not transfer workers between agencies.
- Server-owned draft is bound to user, agency and session, expires in 10 minutes, and requires explicit confirmation. Client-supplied row/agency edits are ignored.
- Live account activation, role, archive and agency are rechecked even with an old session.
- Entire batch is revalidated and committed in one SQLite transaction; changes or errors cause no partial import.
- UI renders file-derived text using textContent, not HTML. Links remain same-origin. Double submit disabled; ambiguous network failure instructs the user to check Workers before retrying.
- Restart clears the local preview; another preview invalidates any prior server draft. Nothing is deleted from actual worker records.

## Verification

API/parser suite: 54 assertions, all passing on isolated throwaway SQLite. Includes malformed/oversized files, BOM/quotes, row bounds, duplicate rules, cross-agency draft rejection, client row tampering, stale data, transaction rollback, expired drafts and deactivated/archived/demoted/moved users.

The existing smoke and critical suites also run from `npm test`. See evidence/csv-full-tests.txt for the final aggregate result.

Browser visual behavior, keyboard/screen-reader usability, real mobile file selection and actual invitation delivery have not been tested. No production data was imported. Invitation links remain sensitive and should be shared only with their intended worker, with explicit authorization. The broader invitation lifecycle (expiry/revocation/session security) is still under audit.

## Commands

`npm run test:csv`

`DB_PATH=/tmp/new-disposable-smoke.db npm test`

The new CSV suite ignores inherited DB_PATH and creates/removes only its own temporary directory. The existing smoke runner deletes the DB_PATH it is given; never point it at a real database.
