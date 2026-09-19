import http from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'garrigram.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author TEXT NOT NULL, caption TEXT NOT NULL, image TEXT NOT NULL, location TEXT, lat REAL, lng REAL, created_at TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, visitor TEXT NOT NULL, PRIMARY KEY(post_id,visitor));`);
if(process.env.SEED_DEMO !== '0') {
  const samples=JSON.parse(await readFile(path.join(root,'seed.json'),'utf8'));
  const insert=db.prepare('INSERT OR IGNORE INTO posts (id,author,caption,image,location,lat,lng,created_at,demo) VALUES (?,?,?,?,?,?,?,?,1)');
  for(const p of samples) insert.run(p.id,p.author,p.caption,p.image,p.location,p.lat,p.lng,p.created_at);
}
const json = (res, status, value) => { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const readBody = async req => { let length=0; const chunks=[]; for await (const chunk of req) { length+=chunk.length; if(length>22*1024*1024) throw Object.assign(new Error('Photo is too large. Please choose one under 15 MB.'), {status:413}); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Invalid request.'), {status:400}); } };
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const visitor = req => { const value=req.headers['x-visitor-id']; if(typeof value!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(value)) fail('Missing visitor identifier.'); return value; };
function imageType(bytes) { if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return 'jpg'; if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'; if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP') return 'webp'; return null; }

export const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  try {
    const url = new URL(req.url,'http://localhost');
    if(req.method!=='GET' && req.method!=='HEAD') {
      const origin=req.headers.origin;
      if(origin && new URL(origin).host!==req.headers.host) return json(res,403,{error:'Cross-origin requests are not allowed.'});
    }
    if(url.pathname==='/api/posts' && req.method==='GET') {
      const who=visitor(req);
      return json(res,200,db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes, EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND visitor=?) AS liked FROM posts p ORDER BY demo ASC, created_at DESC`).all(who));
    }
    if(url.pathname==='/api/posts' && req.method==='POST') {
      visitor(req); const body=await readBody(req);
      if(typeof body.author!=='string'||!body.author.trim()||body.author.length>60) fail('Please enter a name (up to 60 characters).');
      if(typeof body.caption!=='string'||body.caption.length>1000) fail('Captions can be up to 1,000 characters.');
      if(typeof body.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(body.image)) fail('Please choose a JPG, PNG or WebP photo.');
      const bytes=Buffer.from(body.image.split(',')[1],'base64'); const ext=imageType(bytes);
      if(!ext||bytes.length===0||bytes.length>15*1024*1024) fail('Please choose a valid photo under 15 MB.');
      const hasLocation=body.lat!==null&&body.lat!==undefined;
      if(hasLocation&&(!Number.isFinite(body.lat)||!Number.isFinite(body.lng)||Math.abs(body.lat)>90||Math.abs(body.lng)>180||typeof body.location!=='string'||!body.location.trim()||body.location.length>100)) fail('Please choose a valid location.');
      if(!hasLocation&&body.lng!=null) fail('Please choose a valid location.');
      const id=randomUUID(); const filename=`${id}.${ext}`;
      await writeFile(path.join(dataDir,'uploads',filename),bytes,{flag:'wx'});
      try { db.prepare('INSERT INTO posts (id,author,caption,image,location,lat,lng,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,body.author.trim(),body.caption.trim(),`/uploads/${filename}`,hasLocation?body.location.trim():null,hasLocation?body.lat:null,hasLocation?body.lng:null,new Date().toISOString()); }
      catch(e) { await unlink(path.join(dataDir,'uploads',filename)); throw e; }
      return json(res,201,{id});
    }
    const likeMatch=url.pathname.match(/^\/api\/posts\/([a-zA-Z0-9-]+)\/like$/);
    if(likeMatch&&req.method==='PUT') {
      const who=visitor(req); const body=await readBody(req); if(typeof body.liked!=='boolean') fail('Invalid reaction.');
      if(!db.prepare('SELECT id FROM posts WHERE id=?').get(likeMatch[1])) return json(res,404,{error:'Moment not found.'});
      if(body.liked) db.prepare('INSERT OR IGNORE INTO likes (post_id,visitor) VALUES (?,?)').run(likeMatch[1],who);
      else db.prepare('DELETE FROM likes WHERE post_id=? AND visitor=?').run(likeMatch[1],who);
      return json(res,200,{liked:body.liked,likes:db.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id=?').get(likeMatch[1]).count});
    }
    if(url.pathname.startsWith('/api/')) return json(res,404,{error:'Not found.'});
    if(req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'Method not allowed.'});
    const isUpload=url.pathname.startsWith('/uploads/');
    const base=isUpload?path.join(dataDir,'uploads'):path.join(root,'public');
    const relative=isUpload?url.pathname.slice(9):(url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1));
    const file=path.resolve(base,relative);
    if(!file.startsWith(base+path.sep)) return json(res,403,{error:'Forbidden.'});
    if(!existsSync(file)) return json(res,404,{error:'Not found.'});
    const bytes=await readFile(file); res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':isUpload?'public, max-age=31536000, immutable':'no-cache'}); res.end(req.method==='HEAD'?undefined:bytes);
  } catch(e) { if(!e.status) console.error(e); if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'}); else res.end(); }
});
const port=Number(process.env.PORT||4317);
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Garrigram is ready at http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
