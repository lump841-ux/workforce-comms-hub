const { run, all, get } = require('../database/db');
const { id } = require('./ids');
const { notifyMany, notify } = require('./notify');
const { createEscalation } = require('./escalation');
const { startReplacementSearch } = require('./replacement');
const { logAudit } = require('./audit');

const GRACE_MINUTES = 15;

// Scans all shifts that started > GRACE_MINUTES ago, are still 'scheduled' or 'confirmed',
// and have no clock_in_at. Flags them as no_show, creates a no_show_event, notifies
// manager, opens a Tier 1 escalation, and kicks off the replacement search.
function scanForNoShows() {
  const candidates = all(
    `SELECT * FROM shifts
     WHERE status IN ('scheduled','confirmed')
       AND clock_in_at IS NULL
       AND datetime(shift_date || ' ' || start_time) <= datetime('now', ?)`,
    [`-${GRACE_MINUTES} minutes`]
  );

  const flagged = [];
  for (const shift of candidates) {
    flagShiftNoShow(shift);
    flagged.push(shift.id);
  }
  return flagged;
}

function flagShiftNoShow(shift) {
  run(`UPDATE shifts SET status = 'no_show', no_show_flagged_at = datetime('now') WHERE id = ?`, [shift.id]);

  const eventId = id('nse');
  run(
    `INSERT INTO no_show_events (id, agency_id, shift_id, grace_minutes) VALUES (?,?,?,?)`,
    [eventId, shift.agency_id, shift.id, GRACE_MINUTES]
  );

  const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [shift.agency_id]);
  notifyMany(managers.map((m) => m.id), {
    type: 'no_show',
    title: `No-show flagged: ${shift.job_title}`,
    body: `Shift on ${shift.shift_date} at ${shift.start_time} was not clocked in within ${GRACE_MINUTES} minutes.`,
    link: `/manager/dashboard.html#shifts`
  });

  const client = get('SELECT * FROM clients WHERE id = ?', [shift.client_id]);
  createEscalation({
    agencyId: shift.agency_id,
    clientId: shift.client_id,
    shiftId: shift.id,
    triggeredBy: 'no_show',
    tier: 1,
    summary: `${shift.job_title} shift at ${client ? client.company_name : 'client'} on ${shift.shift_date} ${shift.start_time} flagged as a no-show.`
  });

  logAudit({ agencyId: shift.agency_id, action: 'no_show_flagged', entityType: 'shift', entityId: shift.id });

  startReplacementSearch({ shift, noShowEventId: eventId });

  return eventId;
}

// Manual override — a manager marks a shift no-show immediately (e.g. temp called out)
function manualFlagNoShow(shiftId, actorId) {
  const shift = get('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shift) throw new Error('Shift not found');
  const eventId = flagShiftNoShow(shift);
  const evRow = get('SELECT * FROM no_show_events WHERE id = ?', [eventId]);
  if (evRow) run(`UPDATE no_show_events SET detection_method = 'manual' WHERE id = ?`, [eventId]);
  logAudit({ agencyId: shift.agency_id, actorId, action: 'no_show_manual_flag', entityType: 'shift', entityId: shiftId });
  return eventId;
}

module.exports = { scanForNoShows, flagShiftNoShow, manualFlagNoShow, GRACE_MINUTES };
