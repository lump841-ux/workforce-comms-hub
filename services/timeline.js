const { get, all } = require('../database/db');

// Pulls every event tied to a shift out of its scattered source tables/columns
// and returns one sorted, timestamped feed — this is the "SHIFT TIMELINE"
// the spec calls for: a documented record of exactly what happened, without
// anyone having to write it up by hand or make a phone call to reconstruct it.
// Callers validate a current, active shift relationship before entering.
function buildShiftTimeline(shiftId, viewer) {
  if (!viewer?.id || !viewer.agency_id) return null;
  const shift = get(
    `SELECT s.*, c.company_name, c.site_name, u.full_name as temp_name
     FROM shifts s JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.temp_id
     WHERE s.id = ?`,
    [shiftId]
  );
  if (!shift) return null;

  const events = [];
  const push = (at, type, label, meta) => {
    if (!at) return;
    events.push({ at, type, label, meta: meta || null });
  };

  push(shift.created_at, 'scheduled', `Shift scheduled — ${shift.job_title}`);
  push(shift.confirmed_at, 'confirmed', 'Worker confirmed shift');
  push(shift.en_route_at, 'on_my_way', 'Worker tapped "On My Way"');
  push(shift.running_late_at, 'running_late', `Worker reported running late${shift.late_eta ? ` — ETA ${shift.late_eta}` : ''}`);
  push(shift.arrived_at, 'arrived', 'Worker tapped "I\'ve Arrived"');
  push(shift.supervisor_confirmed_arrival_at, 'supervisor_confirmed_arrival', 'Supervisor confirmed arrival');
  push(shift.clock_in_at, 'clock_in', 'Worker clocked in');
  push(shift.reported_absent_at, 'reported_absent', 'Supervisor reported worker absent');
  push(shift.left_early_at, 'left_early', 'Supervisor reported worker left early');
  push(shift.clock_out_at, 'clock_out', 'Worker clocked out');
  push(shift.no_show_flagged_at, 'no_show', 'Flagged as no-show');
  if (shift.status === 'cancelled' && shift.cancel_reason_category) {
    push(shift.created_at, 'cancelled', `Worker can't make shift (${shift.cancel_reason_category.replace(/_/g, ' ')})${shift.cancel_reason ? `: ${shift.cancel_reason}` : ''}`);
  }

  const breaks = all('SELECT * FROM shift_breaks WHERE shift_id = ? ORDER BY started_at ASC', [shiftId]);
  for (const b of breaks) {
    push(b.started_at, 'break_started', `${b.break_type === 'lunch' ? 'Lunch' : 'Short'} break started`);
    push(b.ended_at, 'break_ended', 'Break ended');
  }

  const photoScope = viewer.role === 'temp' ? ' AND sp.temp_id = ?' : '';
  const photos = all('SELECT sp.*, u.full_name as uploader_name FROM shift_photos sp LEFT JOIN users u ON u.id = sp.uploaded_by WHERE sp.shift_id = ?' + photoScope + ' ORDER BY sp.created_at ASC', viewer.role === 'temp' ? [shiftId, viewer.id] : [shiftId]);
  for (const p of photos) {
    push(p.created_at, 'photo', `Photo uploaded${p.uploader_role === 'client_hr' ? ' by supervisor' : ''}${p.caption ? `: ${p.caption}` : ''}`, { photoId: p.id, dataUrl: p.data_url });
  }

  const disputes = all('SELECT * FROM time_disputes WHERE shift_id = ? ORDER BY created_at ASC', [shiftId]);
  for (const d of disputes) {
    push(d.created_at, 'time_dispute_opened', `Time issue reported (${d.category.replace(/_/g, ' ')})`, { disputeId: d.id });
    push(d.supervisor_verified_at, 'time_dispute_verified', 'Supervisor verified time issue', { disputeId: d.id });
    push(d.resolved_at, 'time_dispute_resolved', `Time issue resolved — ${d.resolved_hours || d.reported_hours} hrs`, { disputeId: d.id });
  }

  const escalations = all('SELECT * FROM escalations WHERE shift_id = ? ORDER BY created_at ASC', [shiftId]);
  for (const e of escalations) {
    push(e.created_at, 'escalation', `${e.triggered_by.replace(/_/g, ' ')} escalation opened (tier ${e.tier})${e.after_hours ? ' — after hours' : ''}`, { escalationId: e.id });
    push(e.acknowledged_at, 'escalation_acknowledged', 'Escalation acknowledged', { escalationId: e.id });
    push(e.resolved_at, 'escalation_resolved', 'Escalation resolved', { escalationId: e.id });
  }

  const messages = all(
    `SELECT m.*, u.full_name as sender_name, u.role as sender_role FROM messages m
     JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.sender_id
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
     WHERE c.shift_id = ? AND c.agency_id = ? AND (c.client_id IS NULL OR c.client_id = ?) ORDER BY m.created_at ASC`,
    [viewer.id, shiftId, viewer.agency_id, shift.client_id]
  );
  for (const m of messages) {
    push(m.created_at, 'message', `${m.sender_name} (${m.sender_role.replace('_', ' ')}): ${m.body.slice(0, 140)}`);
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return { shift, events };
}

module.exports = { buildShiftTimeline };
