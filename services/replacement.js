const { run, all, get } = require('../database/db');
const { id } = require('./ids');
const { notify, notifyMany } = require('./notify');
const { logAudit } = require('./audit');

// Finds available temps in the same agency who are not already booked
// for an overlapping shift on that date, ranks by fewest current shifts
// (simple load-balancing heuristic), and notifies the top candidates.
function findCandidates(shift, limit = 5) {
  const booked = all(
    `SELECT temp_id FROM shifts WHERE agency_id = ? AND shift_date = ? AND temp_id IS NOT NULL
       AND status IN ('scheduled','confirmed','in_progress')`,
    [shift.agency_id, shift.shift_date]
  ).map((r) => r.temp_id);

  const bookedSet = new Set(booked);
  const temps = all(`SELECT id FROM users WHERE agency_id = ? AND role = 'temp' AND active = 1`, [shift.agency_id]);
  const available = temps.filter((w) => !bookedSet.has(w.id) && w.id !== shift.temp_id);

  const scored = available.map((w) => {
    const loadCount = get(
      `SELECT COUNT(*) as c FROM shifts WHERE temp_id = ? AND status IN ('scheduled','confirmed','completed')`,
      [w.id]
    ).c;
    return { tempId: w.id, load: loadCount };
  });
  scored.sort((a, b) => a.load - b.load);
  return scored.slice(0, limit).map((s) => s.tempId);
}

function startReplacementSearch({ shift, noShowEventId }) {
  const reqId = id('rep');
  run(
    `INSERT INTO replacement_requests (id, agency_id, original_shift_id, no_show_event_id, status) VALUES (?,?,?,?, 'searching')`,
    [reqId, shift.agency_id, shift.id, noShowEventId || null]
  );

  const candidateIds = findCandidates(shift);
  if (candidateIds.length === 0) {
    run(`UPDATE replacement_requests SET status = 'unfilled' WHERE id = ?`, [reqId]);
    const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [shift.agency_id]);
    notifyMany(managers.map((m) => m.id), {
      type: 'replacement',
      title: 'No available replacements found',
      body: `No eligible temps were found to cover ${shift.job_title} on ${shift.shift_date}. Manual assignment needed.`,
      link: `/manager/dashboard.html#replacements`
    });
    return reqId;
  }

  for (const tempId of candidateIds) {
    run(
      `INSERT INTO replacement_candidates (id, replacement_request_id, temp_id) VALUES (?,?,?)`,
      [id('rpc'), reqId, tempId]
    );
    notify({
      userId: tempId,
      type: 'replacement',
      title: 'Open shift available',
      body: `${shift.job_title} on ${shift.shift_date} ${shift.start_time}-${shift.end_time}. Tap to accept.`,
      link: `/temp/dashboard.html#open-shifts`
    });
  }
  run(`UPDATE replacement_requests SET status = 'offered', candidates_notified = ? WHERE id = ?`, [candidateIds.length, reqId]);
  logAudit({ agencyId: shift.agency_id, action: 'replacement_search_started', entityType: 'replacement_request', entityId: reqId, meta: { candidates: candidateIds.length } });
  return reqId;
}

// Temp accepts an offered replacement shift — first to accept wins (race-safe via status check)
function acceptReplacement(replacementRequestId, tempId) {
  const reqRow = get('SELECT * FROM replacement_requests WHERE id = ?', [replacementRequestId]);
  if (!reqRow) throw new Error('Replacement request not found');
  if (reqRow.status === 'filled') return { ok: false, reason: 'already_filled' };

  const candidate = get('SELECT * FROM replacement_candidates WHERE replacement_request_id = ? AND temp_id = ?', [replacementRequestId, tempId]);
  if (!candidate) throw new Error('Not an eligible candidate for this shift');

  const original = get('SELECT * FROM shifts WHERE id = ?', [reqRow.original_shift_id]);

  const newShiftId = id('sft');
  run(
    `INSERT INTO shifts (id, agency_id, client_id, temp_id, job_title, shift_date, start_time, end_time, status, confirmed_at, original_shift_id)
     VALUES (?,?,?,?,?,?,?,?, 'confirmed', datetime('now'), ?)`,
    [newShiftId, original.agency_id, original.client_id, tempId, original.job_title, original.shift_date, original.start_time, original.end_time, original.id]
  );

  run(`UPDATE shifts SET status = 'replaced', replacement_shift_id = ? WHERE id = ?`, [newShiftId, original.id]);
  run(
    `UPDATE replacement_requests SET status = 'filled', filled_by_temp_id = ?, filled_shift_id = ?, filled_at = datetime('now') WHERE id = ?`,
    [tempId, newShiftId, replacementRequestId]
  );
  run(`UPDATE replacement_candidates SET response = 'accepted', responded_at = datetime('now') WHERE id = ?`, [candidate.id]);
  run(
    `UPDATE replacement_candidates SET response = 'declined', responded_at = datetime('now')
     WHERE replacement_request_id = ? AND temp_id != ? AND response IS NULL`,
    [replacementRequestId, tempId]
  );

  const noShowEvent = reqRow.no_show_event_id ? get('SELECT * FROM no_show_events WHERE id = ?', [reqRow.no_show_event_id]) : null;
  if (noShowEvent) {
    run(`UPDATE no_show_events SET resolved = 1, resolution = 'replaced', resolved_at = datetime('now') WHERE id = ?`, [noShowEvent.id]);
  }

  const managers = all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin')`, [original.agency_id]);
  notifyMany(managers.map((m) => m.id), {
    type: 'replacement',
    title: 'Shift covered',
    body: `${original.job_title} on ${original.shift_date} has been filled by a replacement temp.`,
    link: `/manager/dashboard.html#shifts`
  });

  logAudit({ agencyId: original.agency_id, actorId: tempId, action: 'replacement_accepted', entityType: 'shift', entityId: newShiftId });

  return { ok: true, newShiftId };
}

module.exports = { startReplacementSearch, acceptReplacement, findCandidates };
