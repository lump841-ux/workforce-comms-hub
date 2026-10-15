#!/usr/bin/env node
// Non-destructive launch preflight. Reports configuration; does not connect to or modify the database.
const path=require('node:path');
const fs=require('node:fs');
const messages=[];
function report(kind,message){messages.push({kind,message});console.log(kind.toUpperCase()+': '+message);}
const prod=process.env.NODE_ENV==='production';
const secret=process.env.SESSION_SECRET||'';
const dbPath=path.resolve(process.env.DB_PATH||path.join(__dirname,'../database/hub.db'));
const configured=Boolean(process.env.DB_PATH);
report('info','Node environment: '+(process.env.NODE_ENV||'unset'));
report('info','SQLite database path: '+dbPath);
if(!configured)report('fail','DB_PATH is not configured. Default database/hub.db is inside the application filesystem and not reliably durable on Railway.');
else if(!dbPath.startsWith('/data/'))report('warn','DB_PATH is set but persistence of its parent path must be verified against a mounted volume.');
else report('pass','DB_PATH targets /data; verify Railway has a volume mounted at /data before deployment.');
if(secret.length<32)report('fail','SESSION_SECRET must be a unique random secret of at least 32 characters; do not print its value.');
else report('pass','SESSION_SECRET is set (value not printed).');
report('warn','express-session uses its default MemoryStore; configure a production-safe persistent session store.');
report('warn','Confirm SQLite backups and restore drills, multi-tenant authorization, notification delivery, and payment sandbox tests before customer launch.');
if(fs.existsSync(dbPath))report('info','The configured SQLite file exists in this runtime. This does not prove persistence or backup.');
else report('info','No SQLite file detected at the configured location (normal for a fresh runtime).');
const fails=messages.filter(x=>x.kind==='fail').length;
console.log('Preflight result: '+fails+' critical configuration finding(s).');
process.exitCode=fails?1:0;
