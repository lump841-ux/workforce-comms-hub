const MAX_BYTES = 128 * 1024;
const MAX_ROWS = 500;
const MAX_FIELD = 4096;

// Strict RFC-4180-style reader: quoted commas/newlines and doubled quotes,
// CRLF/LF, optional UTF-8 BOM. Never evaluates spreadsheet formulas.
function parseCsv(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Choose a nonempty CSV file.');
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new Error('CSV must be 128 KB or smaller.');
  if (input.includes('\0')) throw new Error('CSV contains an invalid character.');
  const text = input.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  function pushField() { row.push(field); field = ''; closed = false; if (row.length > 10) throw new Error('CSV has too many columns.'); }
  function pushRow() { pushField(); if (row.some(v => v.trim())) rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new Error('CSV supports at most 500 workers.'); }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; pushRow(); }
    else if (c === '"') { if (field || closed) throw new Error('Malformed CSV quote.'); quoted = true; }
    else { if (closed) throw new Error('Unexpected text after a closing CSV quote.'); field += c; }
    if (field.length > MAX_FIELD) throw new Error('A CSV field is too long.');
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (field || row.length || closed) pushRow();
  if (rows.length < 2) throw new Error('CSV needs a header and at least one worker.');
  const header = rows.shift().map(s => s.trim().toLowerCase().replace(/[ _-]/g,''));
  const normalized = header.map(s => s === 'name' || s === 'fullname' ? 'fullName' : s === 'email' ? 'email' : s === 'phone' ? 'phone' : null);
  if (normalized.some(v => !v) || new Set(normalized).size !== normalized.length || !normalized.includes('fullName') || !normalized.includes('email')) throw new Error('Use columns full_name,email,phone (phone is optional). Do not include passwords or agency IDs.');
  return rows.map((values, index) => {
    const result = { row: index + 2, fullName: '', email: '', phone: '', errors: [] };
    if (values.length !== header.length) result.errors.push('Column count does not match the header.');
    normalized.forEach((key, i) => { result[key] = (values[i] || '').trim(); });
    result.email = result.email.toLowerCase();
    if (!result.fullName || result.fullName.length > 120 || /[<>\r\n\x00-\x1f]/.test(result.fullName)) result.errors.push('Full name is required, maximum 120 characters, on one line.');
    if (result.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email)) result.errors.push('Enter a valid email address.');
    if (result.phone.length > 40 || /[<>\r\n\x00-\x1f]/.test(result.phone)) result.errors.push('Phone must be 40 characters or fewer on one line.');
    return result;
  });
}

function previewWorkers(csv, agencyId, get) {
  if (!agencyId) throw new Error('Agency context required.');
  const seen = new Set();
  const rows = parseCsv(csv).map(row => {
    let status = row.errors.length ? 'error' : 'ready'; let reason = row.errors.join(' ');
    if (status === 'ready' && seen.has(row.email)) { status = 'skipped'; reason = 'Duplicate email in this file; first occurrence kept.'; }
    if (status === 'ready') {
      seen.add(row.email);
      const own = get('SELECT id FROM users WHERE lower(email) = ? AND agency_id = ?', [row.email, agencyId]);
      const invite = get("SELECT id FROM temp_invites WHERE lower(email) = ? AND agency_id = ? AND status = 'pending'", [row.email, agencyId]);
      if (own || invite) { status = 'skipped'; reason = 'Already in this agency or already invited; no changes will be made.'; }
      else if (get('SELECT id FROM users WHERE lower(email) = ?', [row.email])) { status = 'error'; reason = 'This email is unavailable for a new worker invitation.'; }
    }
    return { row: row.row, fullName: row.fullName, email: row.email, phone: row.phone, status, reason };
  });
  const summary = { total: rows.length, ready: 0, skipped: 0, error: 0 };
  rows.forEach(r => summary[r.status]++);
  return { rows, summary, canImport: summary.ready > 0 && summary.error === 0 };
}
module.exports = { parseCsv, previewWorkers, MAX_BYTES, MAX_ROWS };
