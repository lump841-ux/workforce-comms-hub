const crypto = require('node:crypto');
const net = require('node:net');
function loadSessionConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let origin = null;
  if (env.APP_BASE_URL) {
    const url = new URL(env.APP_BASE_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:','http:'].includes(url.protocol)) throw new Error('APP_BASE_URL must be a canonical HTTP(S) origin');
    if (url.protocol === 'http:' && (production || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('APP_BASE_URL requires HTTPS except explicit local development');
    origin = url.origin;
  } else if (production) throw new Error('APP_BASE_URL is required in production');
  else origin = 'http://localhost:4400'; // Exact local default; override explicitly for another port/origin.
  const secret = env.SESSION_SECRET;
  if (secret && (Buffer.byteLength(secret) < 32 || secret === 'workforce-comms-hub-dev-secret-change-me')) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  if (production && !secret) throw new Error('SESSION_SECRET is required in production');
  let trustProxy = false;
  if (env.SESSION_TRUST_PROXY) {
    trustProxy = env.SESSION_TRUST_PROXY.split(',').map(s => s.trim());
    if (!trustProxy.length || trustProxy.some(value => {
      const [ip,bits,...extra] = value.split('/'); const family = net.isIP(ip);
      return !family || extra.length || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) < 1 || Number(bits) > (family === 4 ? 32 : 128)));
    })) throw new Error('SESSION_TRUST_PROXY requires explicit IP addresses/CIDRs; blanket trust is not allowed');
  }
  return { origin, trustProxy, secret: secret || crypto.randomBytes(48).toString('base64'),
    cookie: { httpOnly: true, sameSite: 'lax', secure: origin?.startsWith('https://') || false, path:'/', maxAge:7*24*60*60*1000 } };
}
module.exports = { loadSessionConfig };
