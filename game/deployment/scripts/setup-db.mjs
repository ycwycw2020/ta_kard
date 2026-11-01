import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from 'pg';
const base='D:/card_endfiled',cfg=JSON.parse(fs.readFileSync('private/config.json','utf8'));
fs.mkdirSync(base+'/database',{recursive:true});fs.mkdirSync(base+'/logs',{recursive:true});
cfg.db={...cfg.db,host:'127.0.0.1',port:5433};cfg.pgAdmin??=crypto.randomBytes(24).toString('hex');
fs.writeFileSync('private/config.json',JSON.stringify(cfg,null,2));
const bin=base+'/runtime/pgsql/bin/';
if(!fs.existsSync(base+'/database/PG_VERSION')){
 fs.writeFileSync('private/pg-init-password',cfg.pgAdmin);
 try {const r=spawnSync(bin+'initdb.exe',['-D',base+'/database','-U','postgres','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile=private/pg-init-password'],{encoding:'utf8',windowsHide:true});console.log(r.stdout);if(r.status)throw Error(r.stderr||'initdb failed');}finally{fs.unlinkSync('private/pg-init-password');}
 fs.appendFileSync(base+'/database/postgresql.conf',"\n# Talos local-only test database\nlisten_addresses = '127.0.0.1'\nport = 5433\nshared_buffers = '128MB'\nmax_connections = 40\nlogging_collector = on\nlog_directory = '../logs/postgresql'\nlog_filename = 'postgresql-%a.log'\nlog_rotation_age = '1d'\nlog_truncate_on_rotation = on\n");
}
const status=spawnSync(bin+'pg_ctl.exe',['status','-D',base+'/database'],{encoding:'utf8',windowsHide:true});
if(status.status){const r=spawnSync(bin+'pg_ctl.exe',['start','-D',base+'/database','-l',base+'/logs/postgres-start.log','-w','-t','45'],{stdio:'ignore',windowsHide:true});if(r.status)throw Error('pg_ctl failed; inspect D:/card_endfiled/logs/postgres-start.log');}
const c=new Client({host:'127.0.0.1',port:5433,user:'postgres',database:'postgres',password:cfg.pgAdmin});await c.connect();
// Generated hexadecimal passwords contain no quotes; no user text is interpolated.
if(!(await c.query("SELECT 1 FROM pg_roles WHERE rolname='talos'")).rowCount)await c.query(`CREATE ROLE talos LOGIN PASSWORD '${cfg.db.password}'`);
if(!(await c.query("SELECT 1 FROM pg_database WHERE datname='talos'")).rowCount)await c.query('CREATE DATABASE talos OWNER talos');
console.log((await c.query('SELECT version()')).rows[0].version);await c.end();
const app=new Client(cfg.db);await app.connect();await app.query(fs.readFileSync('schema.sql','utf8'));console.log('Game database ready at D:/card_endfiled/database, loopback port 5433');await app.end();
