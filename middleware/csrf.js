const SAFE = new Set(['GET','HEAD','OPTIONS']);
// Same-origin JSON API defense. No CORS opt-in exists; do not add permissive CORS.
function csrfGuard(config) {
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    if ((req.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(415).json({error:'JSON request required'});
    if (req.get('x-twanova-csrf') !== '1') return res.status(403).json({error:'Request verification failed. Reload the page and try again.'});
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({error:'Cross-origin request rejected'});
    const origin = req.get('origin');
    if (origin) {
      const expected = config.origin;
      if (!expected || origin !== expected) return res.status(403).json({error:'Cross-origin request rejected'});
    }
    next();
  };
}
module.exports = { csrfGuard };
