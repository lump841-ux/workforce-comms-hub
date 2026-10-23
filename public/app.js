// Shared client-side helpers used by all dashboards
// User-written fields are text, never trusted HTML. Safe in text and quoted attributes.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
// Legacy unsafe media is replaced at display time, without rewriting stored records.
function safeImageSrc(value) {
  try { return MediaPolicy.normalizeImageSource(value); } catch (_) { return '/favicon-32.png'; }
}
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Twanova-CSRF': '1' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function initials(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d.includes('T') || d.includes(' ') ? d + (d.endsWith('Z') ? '' : 'Z') : d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d.endsWith('Z') ? d : d + 'Z');
  return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function pill(status) {
  const value = String(status ?? '');
  const className = /^[a-z0-9_-]+$/i.test(value) ? value : 'unknown';
  return `<span class="pill pill-${className}">${escapeHtml(value.replace(/_/g, ' '))}</span>`;
}

function logout() {
  api('/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login.html'));
}

async function requireSession(allowedRoles) {
  try {
    const { user } = await api('/auth/me');
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      window.location.href = '/login.html';
      return null;
    }
    return user;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

function toast(msg, isError) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:100;padding:12px 20px;border-radius:10px;font-size:13.5px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.2);transition:opacity .2s';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#dc2626' : '#0f2a4a';
  el.style.color = '#fff';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.opacity = '0'), 3000);
}
