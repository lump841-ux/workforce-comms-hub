const { get } = require('../database/db');
function establishSession(req, res, user, extra = {}) {
  const current = get('SELECT auth_version FROM users WHERE id = ?', [user.id]);
  req.session.regenerate((err) => {
    if (err) return res.status(503).json({ error: 'Unable to start a secure session. Please sign in again.' });
    req.session.user = { ...user, auth_version: current.auth_version };
    req.session.save((error) => error
      ? res.status(503).json({ error: 'Unable to save session. Please sign in again.' })
      : res.json({ ok: true, ...extra, user: req.session.user }));
  });
}
function validateSession(req, res, next) {
  const sessionUser = req.session?.user;
  if (!sessionUser) return next();
  const user = get('SELECT * FROM users WHERE id = ?', [sessionUser.id]);
  let valid = user && user.active === 1 && !user.archived_at &&
    user.auth_version === sessionUser.auth_version && user.role === sessionUser.role;
  if (valid && user.role === 'client_hr') {
    valid = user.client_org_id === sessionUser.client_org_id;
    if (valid && sessionUser.agency_id) valid = !!get(`SELECT l.id FROM client_org_agency_links l JOIN clients c ON c.id = l.client_id
      WHERE l.client_org_id = ? AND l.agency_id = ? AND l.client_id = ? AND l.status = 'active' AND c.archived_at IS NULL AND c.agency_id = l.agency_id`,
      [user.client_org_id, sessionUser.agency_id, sessionUser.client_id]);
    else if (sessionUser.client_id) valid = false;
  } else if (valid) valid = user.agency_id === sessionUser.agency_id && (user.client_id || null) === (sessionUser.client_id || null);
  if (!valid) { delete req.session.user; delete req.session.workerCsvDraft; }
  next();
}
module.exports = { establishSession, validateSession };
