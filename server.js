require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const { init, db } = require('./database/db');
const { loadSessionConfig } = require('./services/sessionConfig');
const { SQLiteSessionStore } = require('./services/sqliteSessionStore');
const { csrfGuard } = require('./middleware/csrf');
const sessionConfig = loadSessionConfig();
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
if (sessionConfig.trustProxy) app.set('trust proxy', sessionConfig.trustProxy);
app.use('/api', csrfGuard(sessionConfig));

app.use('/api/manager/worker-import', express.json({ limit: '256kb' }));
// Bounded images are validated by upload routes; 1 MB includes base64 overhead.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: sessionConfig.secret,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: sessionConfig.cookie
  })
);

app.use(require('./services/sessionIdentity').validateSession);
app.use('/api/auth', require('./routes/recovery'));
app.use('/api/auth', authRoutes);
app.use('/api', agencySignupRoutes);
app.use('/api', messageRoutes);
app.use('/api/temp', tempRoutes);
app.use('/api/manager/worker-import', require('./routes/workerImport'));
app.use('/api/manager', managerRoutes);
app.use('/api/client', clientRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true, service: 'workforce-comms-hub', time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: req.originalUrl.startsWith('/api/manager/worker-import') ? 'Import request is too large. Use a CSV smaller than 128 KB.' : 'Request is too large; images must be 512 KB or smaller' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' });
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
