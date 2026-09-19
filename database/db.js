const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hub.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
}

// Lightweight additive migration: adds columns that newer schema versions
// introduced but that CREATE TABLE IF NOT EXISTS won't retrofit onto an
// already-existing table. Safe to run on every boot.
function migrate() {
  const addColumnIfMissing = (table, column, definition) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  try {
    addColumnIfMissing('client_orgs', 'contact_email', 'TEXT');
    addColumnIfMissing('client_orgs', 'contact_phone', 'TEXT');
    addColumnIfMissing('client_orgs', 'notification_prefs', 'TEXT');
    addColumnIfMissing('shifts', 'en_route_at', 'TEXT');
    addColumnIfMissing('shifts', 'running_late_at', 'TEXT');
    addColumnIfMissing('shifts', 'cancel_reason_category', 'TEXT');
    addColumnIfMissing('shifts', 'cancel_reason', 'TEXT');
    addColumnIfMissing('users', 'language_pref', "TEXT NOT NULL DEFAULT 'en'");
  } catch (e) {
    console.error('Migration warning:', e.message);
  }
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

module.exports = { db, init, run, get, all };
