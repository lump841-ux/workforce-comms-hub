// Phase 3 — Archive / File Away / Remove.
//
// Archive-over-delete is the default: every archivable entity gets an
// archived_at/archived_by pair instead of being removed from the database.
// Archiving just sets the timestamp (and, for shifts, doesn't touch the
// underlying `status` — an archived shift keeps whatever lifecycle status it
// already had, e.g. 'completed' or 'cancelled', it's just hidden from the
// active screens). Restoring clears it. Permanent delete is offered as a
// separate, rarer action and relies on SQLite's own foreign-key enforcement
// (PRAGMA foreign_keys = ON, see database/db.js) rather than us hand-rolling
// a dependency graph: we attempt the DELETE, and if any other table still
// references the row, SQLite throws and we surface a friendly message
// telling the caller the record has history and should stay archived.
const { run, all } = require('../database/db');
const { logAudit } = require('./audit');

const FK_ERROR = /FOREIGN KEY constraint failed/i;
const HAS_HISTORY_MESSAGE = 'This record has related history (shifts, messages, or other records) and can\'t be permanently deleted. It will remain archived instead.';

function archiveRow({ table, row, actorId, agencyId, action }) {
  run(`UPDATE ${table} SET archived_at = datetime('now'), archived_by = ? WHERE id = ?`, [actorId, row.id]);
  logAudit({ agencyId, actorId, action: `${action}_archived`, entityType: table.slice(0, -1), entityId: row.id });
}

function restoreRow({ table, row, actorId, agencyId, action }) {
  run(`UPDATE ${table} SET archived_at = NULL, archived_by = NULL WHERE id = ?`, [row.id]);
  logAudit({ agencyId, actorId, action: `${action}_restored`, entityType: table.slice(0, -1), entityId: row.id });
}

function deleteRow({ table, row, actorId, agencyId, action, mustBeArchivedFirst = true, cleanup }) {
  if (mustBeArchivedFirst && !row.archived_at) {
    throw new Error('Archive this record first, then delete it permanently.');
  }
  try {
    if (cleanup) cleanup();
    run(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
    logAudit({ agencyId, actorId, action: `${action}_deleted`, entityType: table.slice(0, -1), entityId: row.id });
  } catch (e) {
    if (FK_ERROR.test(e.message)) throw new Error(HAS_HISTORY_MESSAGE);
    throw e;
  }
}

// ---- Clients ----
function archiveClient({ client, actorId, agencyId }) {
  archiveRow({ table: 'clients', row: client, actorId, agencyId, action: 'client' });
}
function restoreClient({ client, actorId, agencyId }) {
  restoreRow({ table: 'clients', row: client, actorId, agencyId, action: 'client' });
}
function deleteClient({ client, actorId, agencyId }) {
  deleteRow({ table: 'clients', row: client, actorId, agencyId, action: 'client' });
}

// ---- Shifts ----
function archiveShift({ shift, actorId, agencyId }) {
  archiveRow({ table: 'shifts', row: shift, actorId, agencyId, action: 'shift' });
}
function restoreShift({ shift, actorId, agencyId }) {
  restoreRow({ table: 'shifts', row: shift, actorId, agencyId, action: 'shift' });
}
function deleteShift({ shift, actorId, agencyId }) {
  // shift_breaks and shift_photos belong exclusively to this shift and carry
  // no meaning on their own, so clear those first; anything else that still
  // points at the shift (escalations, replacement history, time disputes)
  // should block the delete via the FK check in deleteRow's try/catch.
  deleteRow({
    table: 'shifts', row: shift, actorId, agencyId, action: 'shift',
    cleanup: () => {
      run('DELETE FROM shift_breaks WHERE shift_id = ?', [shift.id]);
      run('DELETE FROM shift_photos WHERE shift_id = ?', [shift.id]);
    }
  });
}

// ---- Workers (temps) ----
function archiveWorker({ worker, actorId, agencyId }) {
  run(`UPDATE users SET active = 0, archived_at = datetime('now'), archived_by = ? WHERE id = ?`, [actorId, worker.id]);
  logAudit({ agencyId, actorId, action: 'worker_archived', entityType: 'user', entityId: worker.id });
}
function restoreWorker({ worker, actorId, agencyId }) {
  run(`UPDATE users SET active = 1, archived_at = NULL, archived_by = NULL WHERE id = ?`, [worker.id]);
  logAudit({ agencyId, actorId, action: 'worker_restored', entityType: 'user', entityId: worker.id });
}
function deleteWorker({ worker, actorId, agencyId }) {
  deleteRow({ table: 'users', row: worker, actorId, agencyId, action: 'worker' });
}

// ---- Escalations / Issues ----
function archiveEscalation({ escalation, actorId, agencyId }) {
  archiveRow({ table: 'escalations', row: escalation, actorId, agencyId, action: 'escalation' });
}
function restoreEscalation({ escalation, actorId, agencyId }) {
  restoreRow({ table: 'escalations', row: escalation, actorId, agencyId, action: 'escalation' });
}
function deleteEscalation({ escalation, actorId, agencyId }) {
  deleteRow({ table: 'escalations', row: escalation, actorId, agencyId, action: 'escalation' });
}

// Unified, searchable Archive view — everything with archived_at set (or,
// for workers, active = 0) across the four entity types, newest first.
function getArchiveSummary(agencyId, search) {
  const like = search ? `%${search.toLowerCase()}%` : null;
  const clients = all(
    `SELECT * FROM clients WHERE agency_id = ? AND archived_at IS NOT NULL ${like ? 'AND LOWER(company_name) LIKE ?' : ''} ORDER BY archived_at DESC LIMIT 200`,
    like ? [agencyId, like] : [agencyId]
  );
  const shifts = all(
    `SELECT s.*, c.company_name, u.full_name as temp_name FROM shifts s
     JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.temp_id
     WHERE s.agency_id = ? AND s.archived_at IS NOT NULL ${like ? 'AND (LOWER(s.job_title) LIKE ? OR LOWER(c.company_name) LIKE ?)' : ''}
     ORDER BY s.archived_at DESC LIMIT 200`,
    like ? [agencyId, like, like] : [agencyId]
  );
  const workers = all(
    `SELECT id, full_name, email, phone, archived_at FROM users
     WHERE agency_id = ? AND role = 'temp' AND active = 0 AND archived_at IS NOT NULL ${like ? 'AND (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)' : ''}
     ORDER BY archived_at DESC LIMIT 200`,
    like ? [agencyId, like, like] : [agencyId]
  );
  const escalations = all(
    `SELECT e.*, c.company_name FROM escalations e LEFT JOIN clients c ON c.id = e.client_id
     WHERE e.agency_id = ? AND e.archived_at IS NOT NULL ${like ? 'AND (LOWER(e.summary) LIKE ? OR LOWER(e.triggered_by) LIKE ?)' : ''}
     ORDER BY e.archived_at DESC LIMIT 200`,
    like ? [agencyId, like, like] : [agencyId]
  );
  return { clients, shifts, workers, escalations };
}

module.exports = {
  archiveClient, restoreClient, deleteClient,
  archiveShift, restoreShift, deleteShift,
  archiveWorker, restoreWorker, deleteWorker,
  archiveEscalation, restoreEscalation, deleteEscalation,
  getArchiveSummary
};
