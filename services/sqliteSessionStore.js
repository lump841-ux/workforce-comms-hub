const session = require('express-session');
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Uses the existing application database/volume; never opens a second live DB.
class SQLiteSessionStore extends session.Store {
  constructor(db, { maxAge = MAX_AGE, now = Date.now } = {}) {
    super(); this.db = db; this.maxAge = maxAge; this.now = now; this.lastCleanup = 0;
    db.exec(`CREATE TABLE IF NOT EXISTS browser_sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS browser_sessions_expiry ON browser_sessions(expires_at);`);
  }
  perform(callback, fn) {
    try { const result = fn(); process.nextTick(() => callback?.(null, result)); }
    catch (error) { process.nextTick(() => callback?.(error)); }
  }
  prune() {
    // Redact expired content immediately; keep ID-only tombstones briefly against late saves.
    this.db.prepare("UPDATE browser_sessions SET data='{}', revoked=1 WHERE expires_at <= ?").run(this.now());
    this.db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ?').run(this.now()-this.maxAge);
    this.lastCleanup = this.now();
  }
  cleanup() { if (this.now() - this.lastCleanup >= 60000) this.prune(); }
  expiration(sess, createdAt) {
    const requested = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : this.now() + this.maxAge;
    if (!Number.isFinite(requested)) throw new Error('Invalid session expiry');
    return Math.min(requested, createdAt + this.maxAge);
  }
  get(sid, callback) {
    this.perform(callback, () => {
      this.cleanup();
      const row = this.db.prepare('SELECT data,expires_at,revoked FROM browser_sessions WHERE sid = ?').get(sid);
      if (!row) return null;
      if (row.revoked || row.expires_at <= this.now()) { this.db.prepare("UPDATE browser_sessions SET data='{}',revoked=1 WHERE sid = ?").run(sid); return null; }
      try { return JSON.parse(row.data); }
      catch { this.db.prepare("UPDATE browser_sessions SET data='{}',revoked=1,expires_at=? WHERE sid = ?").run(this.now(),sid); return null; }
    });
  }
  set(sid, sess, callback) {
    this.perform(callback, () => {
      this.cleanup();
      const previous = this.db.prepare('SELECT created_at,expires_at,revoked FROM browser_sessions WHERE sid = ?').get(sid);
      const createdAt = sess.__issuedAt ?? previous?.created_at ?? this.now();
      if (!Number.isSafeInteger(createdAt) || createdAt > this.now() || createdAt + this.maxAge <= this.now()) return;
      // Carried in every in-flight session object, even after tombstone cleanup.
      sess.__issuedAt = createdAt;
      // An expired ID cannot be revived by a late in-flight save.
      if (previous && (previous.revoked || previous.expires_at <= this.now())) return;
      const expires = this.expiration(sess, createdAt);
      this.db.prepare(`INSERT INTO browser_sessions(sid,data,created_at,expires_at) VALUES (?,?,?,?)
        ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires_at=MIN(browser_sessions.created_at + ?,excluded.expires_at)
        WHERE browser_sessions.revoked=0 AND browser_sessions.expires_at > ?`)
        .run(sid, JSON.stringify(sess), createdAt, expires, this.maxAge, this.now());
    });
  }
  touch(sid, sess, callback) {
    this.perform(callback, () => {
      const row = this.db.prepare('SELECT created_at,expires_at,revoked FROM browser_sessions WHERE sid = ?').get(sid);
      if (!row || row.revoked || row.expires_at <= this.now()) return;
      this.db.prepare('UPDATE browser_sessions SET expires_at = ? WHERE sid = ? AND revoked=0 AND expires_at > ?')
        .run(this.expiration(sess, row.created_at), sid, this.now());
      this.cleanup();
    });
  }
  destroy(sid, callback) { this.perform(callback, () => this.db.prepare("INSERT INTO browser_sessions(sid,data,created_at,expires_at,revoked) VALUES (?,'{}',?,?,1) ON CONFLICT(sid) DO UPDATE SET data='{}',revoked=1,expires_at=excluded.expires_at").run(sid,this.now(),this.now())); }
}
module.exports = { SQLiteSessionStore, MAX_AGE };
