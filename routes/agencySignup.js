const express = require('express');
const bcrypt = require('bcryptjs');
const { run, get } = require('../database/db');
const { id } = require('../services/ids');
const { logAudit } = require('../services/audit');

const router = express.Router();

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Creates a brand new agency tenant + its first agency_admin user in one step.
router.post('/agency-signup', (req, res) => {
  const { agencyName, adminName, email, password } = req.body;
  if (!agencyName || !adminName || !email || !password) {
    return res.status(400).json({ error: 'agencyName, adminName, email, and password are required' });
  }

  let slug = slugify(agencyName);
  let attempt = slug;
  let n = 1;
  while (get('SELECT id FROM agencies WHERE slug = ?', [attempt])) {
    attempt = `${slug}-${n++}`;
  }
  slug = attempt;

  const existing = get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const agencyId = id('agy');
  run(`INSERT INTO agencies (id, name, slug) VALUES (?,?,?)`, [agencyId, agencyName, slug]);

  const userId = id('usr');
  const hash = bcrypt.hashSync(password, 10);
  run(
    `INSERT INTO users (id, agency_id, role, full_name, email, password_hash) VALUES (?,?,?,?,?,?)`,
    [userId, agencyId, 'agency_admin', adminName, email.toLowerCase().trim(), hash]
  );

  req.session.user = { id: userId, role: 'agency_admin', full_name: adminName, email, agency_id: agencyId, client_id: null };
  logAudit({ agencyId, actorId: userId, action: 'agency_signup', entityType: 'agency', entityId: agencyId });

  res.json({ ok: true, agencySlug: slug, user: req.session.user });
});

module.exports = router;
