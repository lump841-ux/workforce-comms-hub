require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const { init } = require('./database/db');
init();

const { scanForNoShows } = require('./services/noshow');
const { autoBumpStaleEscalations } = require('./services/escalation');

const authRoutes = require('./routes/auth');
const agencySignupRoutes = require('./routes/agencySignup');
const messageRoutes = require('./routes/messages');
const tempRoutes = require('./routes/temp');
const managerRoutes = require('./routes/manager');
const clientRoutes = require('./routes/client');

const app = express();
const PORT = process.env.PORT || 4400;
// Behind Railway's reverse proxy, secure cookies rely on the forwarded scheme.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('Production requires SESSION_SECRET of at least 32 characters');
  }
}


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'local-development-only-not-for-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
  })
);

app.use('/api/auth', authRoutes);
app.use('/api', agencySignupRoutes);
app.use('/api', messageRoutes);
app.use('/api/temp', tempRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/client', clientRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'workforce-comms-hub', time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Background jobs — no-show detection scan + escalation auto-bump
const SCAN_INTERVAL_MS = 60 * 1000; // every minute
setInterval(() => {
  try {
    const flagged = scanForNoShows();
    if (flagged.length) console.log(`[no-show scan] flagged ${flagged.length} shift(s)`);
  } catch (e) {
    console.error('[no-show scan] error', e);
  }
  try {
    const bumped = autoBumpStaleEscalations();
    if (bumped) console.log(`[escalation bump] bumped ${bumped} escalation(s)`);
  } catch (e) {
    console.error('[escalation bump] error', e);
  }
}, SCAN_INTERVAL_MS);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Twanova — Workforce Communications Hub running on http://localhost:${PORT}`);
  });
}

module.exports = app;
