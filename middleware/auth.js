function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      return res.redirect('/login.html');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Forbidden — insufficient role' });
    }
    next();
  };
}

// Attaches agency_id scope check helper for tenant isolation
function tenantScoped(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  req.agencyId = req.session.user.agency_id;
  next();
}

module.exports = { requireAuth, requireRole, tenantScoped };
