const { db, run, all, get } = require('../database/db');
const { id } = require('./ids');
const { notify, notifyMany } = require('./notify');
const { logAudit } = require('./audit');
const { getSupervisorsForClient } = require('./supervisors');

// Finds available temps in the same agency who are not already booked
// for an overlapping shift on that date, ranks by fewest current shifts
// (simple load-balancing heuristic).
function findCandidates(shift, limit = 5) {
  const booked = all(
    `SELECT temp_id FROM shifts WHERE agency_id = ? AND shift_date = ? AND temp_id IS NOT NULL
       AND status IN ('scheduled','confirmed','in_progress')`,
    [shift.agency_id, shift.shift_date]
  ).map((r) => r.temp_id);

  const bookedSet = new Set(booked);
  const temps = all(`SELECT id, full_name, email, phone FROM users WHERE agency_id = ? AND role = 'temp' AND active = 1`, [shift.agency_id]);
  const available = temps.filter((w) => !bookedSet.has(w.id) && w.id !== shift.temp_id);

  const scored = available.map((w) => {
    const loadCount = get(
      `SELECT COUNT(*) as c FROM shifts WHERE temp_id = ? AND status IN ('scheduled','confirmed','completed')`,
      [w.id]
    ).c;
    return { ...w, load: loadCount };
  });
  scored.sort((a, b) => a.load - b.load);
  return scored.slice(0, limit);
}

function managersFor(agencyId) {
  return all(`SELECT id FROM users WHERE agency_id = ? AND role IN ('agency_manager','agency_admin','owner')`, [agencyId]);
}

// Resolve durable client-organization links, including invited supervisors.
const supervisorsFor = getSupervisorsForClient;

// Client raises a replacement request but the agency has not acted on it
// yet — nothing is searched or broadcast to workers until an agency user
// reviews it (spec: Requested -> Agency Reviewing, before any search
// starts). This is the client-initiated entry point.
function requestReplacement({ shift, reason, note, requestedBy }) {
  const reqId = id('rep');
  run(
    `INSERT INTO replacement_requests (id, agency_id, original_shift_id, status, initiated_by, requested_by, reason, note)
     VALUES (?,?,?, 'requested', 'client', ?, ?, ?)`,
    [reqId, shift.agency_id, shift.id, requestedBy || null, reason || null, note || null]
  );
  notifyMany(managersFor(shift.agency_id).map((m) => m.id), {
    type: 'replacement',
    title: 'Client requested a replacement',
    body: `${shift.job_title} on ${shift.shift_date} ${shift.start_time}-${shift.end_time}${reason ? ` — ${reason}` : ''}`,
    link: `/manager/dashboard.html#replacements`
  });
  logAudit({ agencyId: shift.agency_id, actorId: requestedBy, action: 'replacement_requested_by_client', entityType: 'replacement_request', entityId: reqId });
  return reqId;
}

// Starts (or resumes) the broadcast search: notifies the top eligible
// candidates and moves the request to 'offered'. Pass `requestId` to move
// an existing 'requested'/'unfilled' row through review into search rather
// than creating a new one — this is what an agency does after reviewing a
// client-initiated request, and what a retry does after an unfilled search.
function startReplacementSearch({ shift, noShowEventId, requestId, initiatedBy = 'system', requestedBy = null, reason = null, note = null, reviewedBy = null }) {
  let reqId = requestId;
  if (reqId) {
    run(`UPDATE replacement_requests SET status = 'searching', reviewed_at = datetime('now'), reviewed_by = COALESCE(?, reviewed_by) WHERE id = ?`, [reviewedBy, reqId]);
  } else {
    reqId = id('rep');
    run(
      `INSERT INTO replacement_requests (id, agency_id, original_shift_id, no_show_event_id, status, initiated_by, requested_by, reason, note, reviewed_at, reviewed_by)
       VALUES (?,?,?,?, 'searching', ?, ?, ?, ?, datetime('now'), ?)`,
      [reqId, shift.agency_id, shift.id, noShowEventId || null, initiatedBy, requestedBy, reason, note, reviewedBy]
    );
  }

  const candidates = findCandidates(shift);
  if (candidates.length === 0) {
    run(`UPDATE replacement_requests SET status = 'unfilled' WHERE id = ?`, [reqId]);
    notifyMany(managersFor(shift.agency_id).map((m) => m.id), {
      type: 'replacement',
      title: 'No available replacements found',
      body: `No eligible temps were found to cover ${shift.job_title} on ${shift.shift_date}. Manual assignment needed.`,
      link: `/manager/dashboard.html#replacements`
    });
    return reqId;
  }

  for (const c of candidates) {
    run(`INSERT INTO replacement_candidates (id, replacement_request_id, temp_id) VALUES (?,?,?)`, [id('rpc'), reqId, c.id]);
    notify({
      userId: c.id,
      type: 'replacement',
      title: 'Open shift available',
      body: `${shift.job_title} on ${shift.shift_date} ${shift.start_time}-${shift.end_time}. Tap to accept.`,
      link: `/temp/dashboard.html#open-shifts`
    });
  }
  run(`UPDATE replacement_requests SET status = 'offered', candidates_notified = candidates_notified + ? WHERE id = ?`, [candidates.length, reqId]);
  logAudit({ agencyId: shift.agency_id, action: 'replacement_search_started', entityType: 'replacement_request', entityId: reqId, meta: { candidates: candidates.length } });
  return reqId;
}

// Agency manually picks one specific worker instead of broadcasting to the
// top N by load — same end state ('offered') as a broadcast search, just a
// single targeted candidate. Used for both client-initiated requests the
// agency wants to hand-place, and unfilled broadcast searches.
function selectReplacementCandidate({ requestId, tempId, actorId }) {
  const reqRow = get('SELECT * FROM replacement_requests WHERE id = ?', [requestId]);
  if (!reqRow) throw new Error('Replacement request not found');
  if (!['requested', 'reviewing', 'searching', 'unfilled'].includes(reqRow.status)) {
    throw new Error('This request already has a candidate in progress or is closed');
  }
  const shift = get('SELECT * FROM shifts WHERE id = ?', [reqRow.original_shift_id]);
  if (!shift) throw new Error('Original shift not found');
  const temp = get(`SELECT id, full_name FROM users WHERE id = ? AND agency_id = ? AND role = 'temp' AND active = 1`, [tempId, shift.agency_id]);
  if (!temp) throw new Error('That worker is not eligible');

  const existing = get('SELECT id FROM replacement_candidates WHERE replacement_request_id = ? AND temp_id = ?', [requestId, tempId]);
  if (!existing) {
    run(`INSERT INTO replacement_candidates (id, replacement_request_id, temp_id) VALUES (?,?,?)`, [id('rpc'), requestId, tempId]);
  }
  notify({
    userId: tempId,
    type: 'replacement',
    title: 'Open shift available',
    body: `${shift.job_title} on ${shift.shift_date} ${shift.start_time}-${shift.end_time}. Tap to accept.`,
    link: `/temp/dashboard.html#open-shifts`
  });
  run(
    `UPDATE replacement_requests SET status = 'offered', reviewed_at = COALESCE(reviewed_at, datetime('now')), reviewed_by = COALESCE(reviewed_by, ?), candidates_notified = candidates_notified + 1 WHERE id = ?`,
    [actorId, requestId]
  );
  logAudit({ agencyId: shift.agency_id, actorId, action: 'replacement_candidate_selected', entityType: 'replacement_request', entityId: requestId, meta: { tempId } });
  return { ok: true };
}

// Agency declines a client-initiated request outright (e.g. not needed,
// handled another way) without ever notifying any workers.
function rejectReplacementRequest({ requestId, actorId, note }) {
  const reqRow = get('SELECT * FROM replacement_requests WHERE id = ?', [requestId]);
  if (!reqRow) throw new Error('Replacement request not found');
  if (['filled', 'completed', 'cancelled'].includes(reqRow.status)) throw new Error('This request is already closed');
  const shift = get('SELECT * FROM shifts WHERE id = ?', [reqRow.original_shift_id]);
  run(
    `UPDATE replacement_requests SET status = 'cancelled', reviewed_at = COALESCE(reviewed_at, datetime('now')), reviewed_by = COALESCE(reviewed_by, ?), note = COALESCE(?, note) WHERE id = ?`,
    [actorId, note || null, requestId]
  );
  if (shift) {
    notifyMany(supervisorsFor(shift.client_id).map((s) => s.id), {
      type: 'replacement',
      title: 'Replacement request declined',
      body: `Your agency reviewed the replacement request for ${shift.job_title} on ${shift.shift_date} and won't be sending a cover for it.${note ? ` Note: ${note}` : ''}`,
      link: `/client/dashboard.html#replacements`
    });
    logAudit({ agencyId: shift.agency_id, actorId, action: 'replacement_request_rejected', entityType: 'replacement_request', entityId: requestId });
  }
  return { ok: true };
}

// Only an open offer may be accepted. One SQLite transaction covers the claim,
// shift, notifications and audit so retries/failures cannot create partial cover.
function acceptReplacement(replacementRequestId, tempId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const refuse = (reason) => { db.exec('ROLLBACK'); return { ok: false, reason }; };
    const reqRow = get('SELECT * FROM replacement_requests WHERE id = ?', [replacementRequestId]);
    if (!reqRow) throw new Error('Replacement request not found');
    if (reqRow.status !== 'offered' || reqRow.filled_shift_id) return refuse('offer_closed');

    const candidate = get('SELECT * FROM replacement_candidates WHERE replacement_request_id = ? AND temp_id = ?', [replacementRequestId, tempId]);
    if (!candidate || candidate.response !== null) throw new Error('Not an eligible candidate for this shift');
    const eligibleTemp = get("SELECT id FROM users WHERE id = ? AND agency_id = ? AND role = 'temp' AND active = 1 AND archived_at IS NULL", [tempId, reqRow.agency_id]);
    if (!eligibleTemp) throw new Error('Not an eligible candidate for this shift');

    const original = get('SELECT * FROM shifts WHERE id = ? AND agency_id = ?', [reqRow.original_shift_id, reqRow.agency_id]);
    if (!original || original.archived_at || original.replacement_shift_id || ['replaced', 'completed', 'cancelled'].includes(original.status)) return refuse('shift_closed');

    // Re-check availability at claim time, not only when the offer was sent.
    // Half-open intervals allow back-to-back shifts and handle overnight work.
    const conflict = get(
      `SELECT id FROM shifts WHERE temp_id = ? AND id != ? AND archived_at IS NULL
         AND status IN ('scheduled','confirmed','in_progress')
         AND datetime(shift_date || ' ' || start_time) < datetime(? || ' ' || ?, ?)
         AND datetime(shift_date || ' ' || end_time,
           CASE WHEN end_time <= start_time THEN '+1 day' ELSE '+0 day' END) > datetime(? || ' ' || ?)`,
      [tempId, original.id, original.shift_date, original.end_time,
        original.end_time <= original.start_time ? '+1 day' : '+0 day', original.shift_date, original.start_time]
    );
    if (conflict || tempId === original.temp_id) return refuse('worker_unavailable');

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

    const temp = get('SELECT full_name FROM users WHERE id = ?', [tempId]);
    notifyMany(managersFor(original.agency_id).map((m) => m.id), {
      type: 'replacement',
      title: 'Shift covered',
      body: `${original.job_title} on ${original.shift_date} has been filled by a replacement temp.`,
      link: `/manager/dashboard.html#shifts`
    });
    notifyMany(supervisorsFor(original.client_id).map((s) => s.id), {
      type: 'replacement',
      title: 'Replacement worker assigned',
      body: `${temp ? temp.full_name : 'A replacement worker'} will cover ${original.job_title} on ${original.shift_date} ${original.start_time}-${original.end_time}.`,
      link: `/client/dashboard.html#replacements`
    });

    logAudit({ agencyId: original.agency_id, actorId: tempId, action: 'replacement_accepted', entityType: 'shift', entityId: newShiftId });

    db.exec('COMMIT');
    return { ok: true, newShiftId };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Client's final acknowledgment that the replacement worked out — closes
// the loop (spec: Client Confirmed -> Completed). Only valid once a worker
// has actually accepted the shift.
function confirmReplacementByClient({ requestId, clientUserId, clientId }) {
  const reqRow = get('SELECT rr.*, s.client_id FROM replacement_requests rr JOIN shifts s ON s.id = rr.original_shift_id WHERE rr.id = ?', [requestId]);
  if (!reqRow) throw new Error('Replacement request not found');
  if (reqRow.client_id !== clientId) throw new Error('Replacement request not found for your organization');
  if (reqRow.status !== 'filled') throw new Error('This replacement has not been filled yet');
  run(
    `UPDATE replacement_requests SET status = 'completed', client_confirmed_at = datetime('now'), client_confirmed_by = ?, completed_at = datetime('now') WHERE id = ?`,
    [clientUserId, requestId]
  );
  logAudit({ agencyId: reqRow.agency_id, actorId: clientUserId, action: 'replacement_confirmed_by_client', entityType: 'replacement_request', entityId: requestId });
  return { ok: true };
}

module.exports = {
  startReplacementSearch,
  acceptReplacement,
  findCandidates,
  requestReplacement,
  selectReplacementCandidate,
  rejectReplacementRequest,
  confirmReplacementByClient
};
