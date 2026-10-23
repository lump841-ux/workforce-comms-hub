const express = require('express');
const crypto = require('crypto');
const { db, get, run } = require('../database/db');
const { requireRole } = require('../middleware/auth');
const { previewWorkers } = require('../services/workerCsv');
const { id } = require('../services/ids');
const { logAudit } = require('../services/audit');
const router = express.Router();
const importRoles = ['owner','agency_admin','agency_manager','recruiter'];
router.use(requireRole(...importRoles));
function activeActor(user) {
  const current = get('SELECT agency_id, role, active, archived_at FROM users WHERE id = ?', [user.id]);
  return current && current.active === 1 && !current.archived_at && current.agency_id && current.agency_id === user.agency_id && importRoles.includes(current.role);
}
router.use((req,res,next) => {
  if (!activeActor(req.session.user)) {
    delete req.session.workerCsvDraft;
    return res.status(403).json({error:'Your current account cannot import workers. Sign in again or contact your agency.'});
  }
  res.set('Cache-Control','no-store'); next();
});
router.post('/preview',(req,res) => {
  // A failed/new preview invalidates any previous confirmable draft.
  delete req.session.workerCsvDraft;
  try {
    const preview = previewWorkers(req.body.csv,req.session.user.agency_id,get);
    let importId = null;
    if (preview.canImport) {
      importId = crypto.randomBytes(16).toString('hex');
      req.session.workerCsvDraft = { importId, userId:req.session.user.id, agencyId:req.session.user.agency_id, expiresAt:Date.now()+10*60*1000, rows:preview.rows.filter(r=>r.status==='ready') };
    }
    res.json({...preview,importId,expiresInSeconds:importId ? 600 : 0});
  } catch(e) { res.status(400).json({error:e.message}); }
});
router.post('/commit',(req,res) => {
  const u=req.session.user; const draft=req.session.workerCsvDraft;
  if (req.body.confirm !== true || !draft || req.body.importId !== draft.importId || draft.userId !== u.id || draft.agencyId !== u.agency_id || draft.expiresAt < Date.now()) return res.status(409).json({error:'Preview this CSV again before confirming the import.'});
  const imported=[];
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!activeActor(u)) throw new Error('Account permissions changed.');
    // Revalidate every row before inserting anything; never accept client-supplied row edits.
    for (const row of draft.rows) {
      if (get('SELECT id FROM users WHERE lower(email)=?',[row.email]) || get("SELECT id FROM temp_invites WHERE lower(email)=? AND agency_id=? AND status='pending'",[row.email,u.agency_id])) throw new Error('The worker list changed. Preview again; nothing was imported.');
    }
    for (const row of draft.rows) {
      const inviteId=id('inv'); const token=crypto.randomBytes(24).toString('hex');
      run('INSERT INTO temp_invites (id,agency_id,full_name,email,phone,token,invited_by) VALUES (?,?,?,?,?,?,?)',[inviteId,u.agency_id,row.fullName,row.email,row.phone || null,token,u.id]);
      logAudit({agencyId:u.agency_id,actorId:u.id,action:'temp_csv_invite_staged',entityType:'temp_invite',entityId:inviteId});
      // Relative links avoid trusting the request Host header. No emails are sent.
      imported.push({fullName:row.fullName,email:row.email,invitePath:`/temp-invite.html?token=${token}`});
    }
    db.exec('COMMIT'); delete req.session.workerCsvDraft;
    res.json({ok:true,created:imported.length,imported,sent:0,accountsCreated:0});
  } catch(e) {
    db.exec('ROLLBACK'); delete req.session.workerCsvDraft;
    res.status(409).json({error:e.message === 'The worker list changed. Preview again; nothing was imported.' ? e.message : 'Import could not be saved. Nothing was imported; preview and try again.'});
  }
});
module.exports=router;
