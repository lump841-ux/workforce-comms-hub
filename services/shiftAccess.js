const { get } = require('../database/db');
const STAFF_ROLES = ['owner', 'agency_admin', 'agency_manager', 'recruiter'];

function actorForShiftSession(sessionUser) {
  if (!sessionUser?.agency_id) return null;
  const actor = get('SELECT * FROM users WHERE id = ? AND active = 1 AND archived_at IS NULL', [sessionUser.id]);
  if (!actor || actor.role !== sessionUser.role) return null;
  if (actor.role === 'client_hr') {
    if (actor.client_org_id !== sessionUser.client_org_id) return null;
    const link = get(`SELECT l.id FROM client_org_agency_links l JOIN clients c ON c.id = l.client_id
      WHERE l.client_org_id = ? AND l.agency_id = ? AND l.client_id = ? AND l.status = 'active'
        AND c.agency_id = l.agency_id AND c.archived_at IS NULL`,
      [actor.client_org_id, sessionUser.agency_id, sessionUser.client_id]);
    return link ? { ...actor, agency_id: sessionUser.agency_id, client_id: sessionUser.client_id } : null;
  }
  return actor.agency_id === sessionUser.agency_id && (actor.role === 'temp' || STAFF_ROLES.includes(actor.role)) ? actor : null;
}

function liveShiftForAgency(agencyId, shiftId) {
  return get(`SELECT s.*, c.company_name, c.site_name FROM shifts s JOIN clients c ON c.id = s.client_id AND c.agency_id = s.agency_id
    WHERE s.id = ? AND s.agency_id = ? AND s.archived_at IS NULL AND c.archived_at IS NULL`, [shiftId, agencyId]);
}

// Every direct shift action/read checks the current identity and active tenant/site.
function shiftForSession(sessionUser, shiftId) {
  const actor = actorForShiftSession(sessionUser);
  if (!actor) return null;
  const shift = liveShiftForAgency(actor.agency_id, shiftId);
  if (!shift) return null;
  if (actor.role === 'client_hr') return shift.client_id === actor.client_id ? shift : null;
  if (actor.role === 'temp') return shift.temp_id === actor.id ? shift : null;
  return STAFF_ROLES.includes(actor.role) ? shift : null;
}

// Offered shifts are not yet assigned to the candidate; authorize by the durable
// offer plus current agency, then leave acceptance state/race handling to its service.
function offerForSession(sessionUser, requestId) {
  const actor = actorForShiftSession(sessionUser);
  if (!actor || actor.role !== 'temp') return null;
  const request = get('SELECT * FROM replacement_requests WHERE id = ? AND agency_id = ?', [requestId, actor.agency_id]);
  if (!request || !liveShiftForAgency(actor.agency_id, request.original_shift_id)) return null;
  const candidate = get('SELECT * FROM replacement_candidates WHERE replacement_request_id = ? AND temp_id = ?', [requestId, actor.id]);
  return candidate ? { request, candidate } : null;
}

function replacementForSession(sessionUser, requestId) {
  const actor = actorForShiftSession(sessionUser);
  if (!actor || actor.role === 'temp') return null;
  const request = get('SELECT * FROM replacement_requests WHERE id = ? AND agency_id = ?', [requestId, actor.agency_id]);
  const original = request && shiftForSession(sessionUser, request.original_shift_id);
  if (!original) return null;
  if (request.filled_shift_id) {
    const filled = liveShiftForAgency(actor.agency_id, request.filled_shift_id);
    if (!filled || filled.client_id !== original.client_id) return null;
  }
  return request;
}
module.exports = { shiftForSession, offerForSession, replacementForSession };
