const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, run, get } = require('../database/db');
const { id } = require('../services/ids');
const { logAudit } = require('../services/audit');
const delivery = require('../services/recoveryDelivery');
const router = express.Router();
const buckets = new Map();
const windowMs = 15 * 60 * 1000;
const generic = { ok: true, message: 'If an eligible account exists, recovery instructions are available through the configured delivery service.' };
function limit(key, max) {
  const now = Date.now();
  for (const [k, value] of buckets) if (value.until <= now) buckets.delete(k);
  const bucket = buckets.get(key) || { count: 0, until: now + windowMs };
  if (!buckets.has(key) && buckets.size >= 10000) return false;
  bucket.count++; buckets.set(key, bucket);
  return bucket.count <= max;
}
function guard(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON request required' });
  const canonical = delivery.configuration();
  if (!canonical) return res.status(503).json({ error: 'Password recovery delivery is not configured. Please contact your agency administrator.' });
  if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== canonical)) return res.status(403).json({ error: 'Request origin not allowed' });
  if (!limit(`ip:${req.ip}`, 20)) return res.status(429).json({ error: 'Too many recovery attempts. Please try again later.' });
  next();
}
router.post('/forgot-password', guard, (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  // Hash addresses in throttle keys; applies equally to nonexistent and inactive users.
  const digest = crypto.createHash('sha256').update(email).digest('hex');
  if (!limit(`email:${digest}`, 3)) return res.status(429).json({ error: 'Too many recovery attempts. Please try again later.' });
  const user = get('SELECT * FROM users WHERE lower(email) = ? AND active = 1 AND archived_at IS NULL', [email]);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (!user) return res.json(generic);
  db.exec('BEGIN IMMEDIATE');
  try {
    run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [Date.now(), user.id]);
    run('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)', [id('rst'),user.id,tokenHash,Date.now()+30*60*1000,Date.now()]);
    delivery.deliver(user.email, token);
    db.exec('COMMIT');
    res.json(generic);
  } catch {
    db.exec('ROLLBACK');
    res.status(503).json({ error: 'Password recovery is temporarily unavailable. Please try again later.' });
  }
});
router.post('/reset-password', guard, (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'This recovery link is invalid or expired. Request a new link.' });
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password,'utf8') > 72) return res.status(400).json({ error: 'Choose a password of at least 12 characters and at most 72 UTF-8 bytes.' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const reset = get(`SELECT r.*,u.agency_id FROM password_reset_tokens r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.active = 1 AND u.archived_at IS NULL`, [hash, Date.now()]);
    if (!reset) { db.exec('ROLLBACK'); return res.status(400).json({ error: 'This recovery link is invalid or expired. Request a new link.' }); }
    run('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', [bcrypt.hashSync(password,12),reset.user_id]);
    run('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [Date.now(),reset.user_id]);
    logAudit({agencyId:reset.agency_id,actorId:reset.user_id,action:'password_reset',entityType:'user',entityId:reset.user_id});
    db.exec('COMMIT');
    req.session.destroy(() => res.json({ok:true,message:'Password updated. Sign in again with your new password.'}));
  } catch {
    db.exec('ROLLBACK');
    res.status(503).json({error:'Unable to reset password. Please try again later.'});
  }
});
module.exports = router;
