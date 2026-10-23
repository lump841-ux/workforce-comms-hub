// Deliberately no network adapter. Explicit local/test mode only, private process memory.
const outbox = [];
function configuration() {
  if (process.env.NODE_ENV !== 'test' || process.env.RECOVERY_DELIVERY !== 'mock') return null;
  try {
    const url = new URL(process.env.APP_BASE_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
function deliver(email, token) {
  const base = configuration();
  if (!base) throw new Error('Recovery delivery unavailable');
  // Bounded mock queue, no filesystem logs, HTTP endpoints or external sends.
  if (outbox.length >= 100) outbox.shift();
  outbox.push({ email, url: `${base}/reset-password.html#token=${encodeURIComponent(token)}` });
}
function takeMockMessages() {
  if (!configuration()) throw new Error('Mock outbox is test-only');
  return outbox.splice(0);
}
module.exports = { configuration, deliver, takeMockMessages };
