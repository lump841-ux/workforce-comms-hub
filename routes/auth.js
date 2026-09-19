const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run, all } = require('../database/db');
const { id } = require('../services/ids');
const { logAudit } = require('../services/audit');

const router = express.Router();

// For a client_hr user, session.user.client_id/agency_id track whichever
// agency relationship is "currently selected." This picks the first active
// link (oldest first) as the default right after login.
function defaultClientLink(clientOrgId) {
  return get(
    `SELECT l.*, a.name as agency_name FROM client_org_agency_links l
     JOIN agencies a ON a.id = l.agency_id
     WHERE l.client_org_id = ? AND l.status = 'active'
     ORDER BY l.created_at ASC LIMIT 1`,
    [clientOrgId]
  );
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = get('SELECT * FROM users WHERE email = ? AND active = 1', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  let agencyId = user.agency_id;
  let clientId = user.client_id;

  if (user.role === 'client_hr') {
    // client_hr identity lives at the client_org level, not a single agency —
    // resolve today's "current" agency to whichever active link is oldest.
    const link = defaultClientLink(user.client_org_id);
    agencyId = link ? link.agency_id : null;
    clientId = link ? link.client_id : null;
  }

  req.session.user = {
    id: user.id,
    role: user.role,
    full_name: user.full_name,
    email: user.email,
    agency_id: agencyId,
    client_id: clientId,
    client_org_id: user.client_org_id,
    avatar_url: user.avatar_url
  };

  logAudit({ agencyId, actorId: user.id, action: 'login', entityType: 'user', entityId: user.id });

  res.json({ ok: true, user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

// A temp never self-registers anymore — an agency manager issues an invite
// (see POST /manager/temps/invite), and this is where the temp lands to
// accept it and set their own password. Nothing exists in `users` until
// this runs, so an agency can freely revoke a pending invite with no cleanup.
router.get('/temp-invite/:token', (req, res) => {
  const invite = get(`SELECT ti.*, a.name as agency_name FROM temp_invites ti JOIN agencies a ON a.id = ti.agency_id WHERE ti.token = ?`, [req.params.token]);
  if (!invite || invite.status !== 'pending') return res.status(404).json({ error: 'This invite link is no longer valid' });
  res.json({ fullName: invite.full_name, email: invite.email, agencyName: invite.agency_name });
});

router.post('/temp-invite/:token/accept', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Choose a password (6+ characters)' });

  const invite = get('SELECT * FROM temp_invites WHERE token = ?', [req.params.token]);
  if (!invite || invite.status !== 'pending') return res.status(404).json({ error: 'This invite link is no longer valid' });

  const existing = get('SELECT id FROM users WHERE email = ?', [invite.email]);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const userId = id('usr');
  run(
    `INSERT INTO users (id, agency_id, role, full_name, email, phone, password_hash) VALUES (?,?, 'temp',?,?,?,?)`,
    [userId, invite.agency_id, invite.full_name, invite.email, invite.phone || null, bcrypt.hashSync(password, 10)]
  );
  run(`UPDATE temp_invites SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?`, [invite.id]);

  req.session.user = { id: userId, role: 'temp', full_name: invite.full_name, email: invite.email, agency_id: invite.agency_id, client_id: null };
  logAudit({ agencyId: invite.agency_id, actorId: userId, action: 'temp_invite_accepted', entityType: 'user', entityId: userId });
  res.json({ ok: true, user: req.session.user });
});

// Self-serve client signup — a company can create its own Twanova login
// before ever talking to an agency (see the "client heard about it first"
// case). It starts with no agency connected; they link one afterward from
// the client dashboard, either by entering an agency's connect code or by
// accepting an invite an agency already sent them.
router.post('/register-client', (req, res) => {
  const { companyName, fullName, email, password } = req.body;
  if (!companyName || !fullName || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const existing = get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const clientOrgId = id('corg');
  run(`INSERT INTO client_orgs (id, company_name) VALUES (?,?)`, [clientOrgId, companyName]);

  const userId = id('usr');
  const hash = bcrypt.hashSync(password, 10);
  run(
    `INSERT INTO users (id, client_org_id, role, full_name, email, password_hash) VALUES (?,?, 'client_hr',?,?,?)`,
    [userId, clientOrgId, fullName, email.toLowerCase().trim(), hash]
  );

  req.session.user = { id: userId, role: 'client_hr', full_name: fullName, email, agency_id: null, client_id: null, client_org_id: clientOrgId };
  logAudit({ actorId: userId, action: 'client_registered', entityType: 'client_org', entityId: clientOrgId });
  res.json({ ok: true, user: req.session.user });
});

// Emergency password reset for demo/test accounts — locked behind a secret
// that only exists as a Railway env var (never committed). No self-serve
// "forgot password" flow exists yet, so this is the only way to recover a
// login until that's built.
router.post('/dev/reset-password', (req, res) => {
  const { secret, email, newPassword } = req.body;
  if (!process.env.DEV_RESET_SECRET || secret !== process.env.DEV_RESET_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!email || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'email and newPassword (6+ chars) required' });
  }
  const user = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'No account with that email' });
  run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), user.id]);
  res.json({ ok: true });
});

module.exports = router;
