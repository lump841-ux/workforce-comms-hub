const { run } = require('../database/db');
const { id } = require('./ids');

function logAudit({ agencyId, actorId, action, entityType, entityId, meta }) {
  run(
    `INSERT INTO audit_log (id, agency_id, actor_id, action, entity_type, entity_id, meta) VALUES (?,?,?,?,?,?,?)`,
    [id('aud'), agencyId || null, actorId || null, action, entityType || null, entityId || null, meta ? JSON.stringify(meta) : null]
  );
}

module.exports = { logAudit };
