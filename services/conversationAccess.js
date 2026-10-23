const { get } = require('../database/db');

const STAFF_ROLES = ['owner', 'agency_admin', 'agency_manager', 'recruiter'];
const isStaff = (user) => STAFF_ROLES.includes(user.role);
const activeUser = (id) => get('SELECT * FROM users WHERE id = ? AND active = 1 AND archived_at IS NULL', [id]);
const linkedClient = (orgId, agencyId, clientId) => get(
  `SELECT l.id FROM client_org_agency_links l JOIN clients c ON c.id = l.client_id
   WHERE l.client_org_id = ? AND l.agency_id = ? AND l.client_id = ?
     AND l.status = 'active' AND c.archived_at IS NULL`, [orgId, agencyId, clientId]);
const assignedToClient = (tempId, agencyId, clientId) => get(
  'SELECT id FROM shifts WHERE temp_id = ? AND agency_id = ? AND client_id = ? AND archived_at IS NULL LIMIT 1',
  [tempId, agencyId, clientId]);

function actorForSession(sessionUser) {
  const actor = activeUser(sessionUser.id);
  if (!actor || !sessionUser.agency_id) return null;
  if (actor.role === 'client_hr') {
    if (!linkedClient(actor.client_org_id, sessionUser.agency_id, sessionUser.client_id)) return null;
    return { ...actor, agency_id: sessionUser.agency_id, client_id: sessionUser.client_id };
  }
  return (isStaff(actor) || actor.role === 'temp') && actor.agency_id === sessionUser.agency_id ? actor : null;
}

function canReceive(actor, recipient, clientId, shift) {
  if (!recipient || recipient.id === actor.id) return false;
  if (recipient.role === 'client_hr') {
    // A client conversation must stay inside one actual site relationship.
    return !!clientId && !!linkedClient(recipient.client_org_id, actor.agency_id, clientId);
  }
  if (recipient.agency_id !== actor.agency_id) return false;
  if (isStaff(recipient)) return true;
  if (recipient.role !== 'temp' || actor.role === 'temp') return false;
  if (shift && recipient.id !== shift.temp_id) return false;
  return !clientId || !!assignedToClient(recipient.id, actor.agency_id, clientId);
}

function canAccessConversation(sessionUser, conversation) {
  const actor = activeUser(sessionUser.id);
  if (!actor || !conversation) return false;
  if (actor.role === 'client_hr') {
    return !!linkedClient(actor.client_org_id, conversation.agency_id, conversation.client_id);
  }
  return (isStaff(actor) || actor.role === 'temp') && actor.agency_id === conversation.agency_id;
}

module.exports = { STAFF_ROLES, isStaff, activeUser, actorForSession, assignedToClient, canReceive, canAccessConversation };
