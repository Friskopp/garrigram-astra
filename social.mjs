// Shared by the authenticated Worker and the local Node preview.
const HOUR = 60 * 60_000, COOLDOWN = 10 * 60_000, MAX_AVATAR = 512 * 1024;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (value, status = 200) => Response.json(value, { status, headers });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const publicProfile = p => ({ id: p.id, name: p.name, avatar: p.avatar });

async function body(request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'The request is empty.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 750_000) { await reader.cancel(); fail(413, 'Please choose a smaller profile photo.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(new Blob(chunks)).json(); }
  catch { fail(400, 'Invalid request.'); }
}

async function profile(db, owner) {
  await db.prepare('INSERT OR IGNORE INTO profiles (owner_id,id) VALUES (?,?)').bind(owner, crypto.randomUUID()).run();
  return db.prepare('SELECT * FROM profiles WHERE owner_id=?').bind(owner).first();
}

export async function cleanSocial(db, now = Date.now()) {
  await db.prepare('DELETE FROM check_ins WHERE expires_at<=?').bind(now).run();
  await db.prepare('DELETE FROM location_requests WHERE expires_at<=?').bind(now).run();
}

export async function withProfiles(db, rows, ownerColumn) {
  const owners = [...new Set(rows.map(row => row[ownerColumn]).filter(Boolean))];
  const profiles = new Map();
  for(let start=0;start<owners.length;start+=80){
    const batch=owners.slice(start,start+80);
    const {results}=await db.prepare(`SELECT owner_id,id,name,avatar FROM profiles WHERE owner_id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all();
    for(const p of results)profiles.set(p.owner_id,p);
  }
  return rows.map(row => {
    const p = profiles.get(row[ownerColumn]);
    const copy = { ...row, author: p?.name || row.author, avatar: p?.avatar || null };
    delete copy[ownerColumn];
    return copy;
  });
}

async function avatarUpload(value, env) {
  if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) fail(400, 'Choose a JPG, PNG or WebP photo.');
  let bytes;
  try { bytes = Uint8Array.from(atob(value.split(',')[1]), c => c.charCodeAt(0)); } catch { fail(400, 'Invalid photo.'); }
  if (!bytes.length || bytes.length > MAX_AVATAR) fail(413, 'Please crop your photo before saving.');
  const text = new TextDecoder();
  let type = bytes[0]===255 && bytes[1]===216 && bytes[2]===255 ? 'jpeg'
    : [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n) ? 'png'
    : text.decode(bytes.slice(0,4))==='RIFF' && text.decode(bytes.slice(8,12))==='WEBP' ? 'webp' : null;
  if (!type) fail(400, 'Invalid photo.');
  if (env.IMAGES) {
    try {
      const output = await env.IMAGES.input(new Blob([bytes]).stream()).transform({ width: 256, height: 256, fit: 'cover' }).output({ format: 'image/webp', quality: 82, anim: false });
      const response = output.response();
      if (response.ok && response.headers.get('content-type')==='image/webp') { bytes = new Uint8Array(await response.arrayBuffer()); type='webp'; }
    } catch { /* The browser already supplies a cropped, bounded JPEG. */ }
  }
  if (!bytes.length || bytes.length > MAX_AVATAR) fail(413, 'Please choose a smaller profile photo.');
  const key = `avatars/${crypto.randomUUID()}.${type==='jpeg'?'jpg':type}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: `image/${type}` } });
  return { url: `/${key}`, bytes: bytes.byteLength };
}

export async function socialRoute(request, env, owner) {
  const url = new URL(request.url), method = request.method, db = env.DB;
  if (url.pathname.startsWith('/avatars/') && ['GET','HEAD'].includes(method)) {
    if (!/^\/avatars\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url.pathname)) fail(404, 'Photo not found.');
    if (!await db.prepare('SELECT id FROM profiles WHERE avatar=?').bind(url.pathname).first()) fail(404, 'Photo not found.');
    const photo = await env.PHOTOS.get(url.pathname.slice(1));
    if (!photo) fail(404, 'Photo not found.');
    const responseHeaders = new Headers(headers); photo.writeHttpMetadata(responseHeaders);
    return new Response(method==='HEAD'?null:photo.body,{headers:responseHeaders});
  }
  if (!['/api/profile','/api/people','/api/check-in','/api/location-requests'].includes(url.pathname) && !/^\/api\/location-requests\/[0-9a-f-]{36}\/dismiss$/.test(url.pathname)) return null;
  const me = await profile(db, owner), now = Date.now();
  if (url.pathname==='/api/profile') {
    if (method==='GET') return json(publicProfile(me));
    if (method!=='PUT') fail(405, 'Method not allowed.');
    const data = await body(request);
    if (typeof data?.name!=='string' || !data.name.trim() || data.name.length>60) fail(400,'Enter a name up to 60 characters.');
    let avatar = me.avatar, size = me.avatar_bytes, uploaded = null;
    if (data.avatar===null) { avatar=null; size=0; }
    else if (data.avatar!==undefined) { uploaded=await avatarUpload(data.avatar,env); avatar=uploaded.url; size=uploaded.bytes; }
    try {
      const result=await db.prepare('UPDATE profiles SET name=?,avatar=?,avatar_bytes=? WHERE owner_id=? AND avatar IS ? AND name=?').bind(data.name.trim(),avatar,size,owner,me.avatar,me.name).run();
      if(!result.meta.changes)fail(409,'Your profile changed in another tab. Refresh the page and try again.');
    }
    catch (error) { if(uploaded)await env.PHOTOS.delete(uploaded.url.slice(1)); if(String(error).includes('storage_budget'))fail(507,'Photo storage is full. Try saving without a new photo.'); throw error; }
    if (me.avatar && me.avatar!==avatar) await env.PHOTOS.delete(me.avatar.slice(1));
    return json({id:me.id,name:data.name.trim(),avatar});
  }
  await cleanSocial(db, now);
  if (url.pathname==='/api/people' && method==='GET') {
    const {results:people}=await db.prepare('SELECT p.id,p.name,p.avatar,c.lat,c.lng,c.message,c.shared_at,c.expires_at FROM check_ins c JOIN profiles p ON p.id=c.profile_id WHERE c.expires_at>? ORDER BY c.shared_at DESC').bind(now).all();
    const {results:requests}=await db.prepare(`SELECT r.id,r.message,r.created_at,r.expires_at,p.name,p.avatar FROM location_requests r JOIN profiles p ON p.id=r.profile_id
      WHERE r.expires_at>? AND r.profile_id!=? AND NOT EXISTS(SELECT 1 FROM request_dismissals d WHERE d.request_id=r.id AND d.profile_id=?) ORDER BY r.created_at DESC LIMIT 10`).bind(now,me.id,me.id).all();
    const latest=await db.prepare('SELECT MAX(created_at) AS at FROM location_requests WHERE profile_id=?').bind(me.id).first();
    return json({people,requests,self:me.id,server_time:now,next_request_at:latest?.at?latest.at+COOLDOWN:0});
  }
  if (url.pathname==='/api/check-in') {
    if (method==='DELETE') { await db.prepare('DELETE FROM check_ins WHERE profile_id=?').bind(me.id).run(); return json({deleted:true}); }
    if (method!=='PUT') fail(405,'Method not allowed.');
    if (!me.name) fail(400,'Save your name in your profile before sharing.');
    const data=await body(request);
    if (!Number.isFinite(data?.lat)||!Number.isFinite(data?.lng)||Math.abs(data.lat)>90||Math.abs(data.lng)>180) fail(400,'A valid location is required.');
    if (typeof data.message!=='string'||data.message.length>200) fail(400,'Messages can be up to 200 characters.');
    await db.prepare(`INSERT INTO check_ins (profile_id,lat,lng,message,shared_at,expires_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,message=excluded.message,shared_at=excluded.shared_at,expires_at=excluded.expires_at`)
      .bind(me.id,data.lat,data.lng,data.message.trim(),now,now+HOUR).run();
    return json({shared_at:now,expires_at:now+HOUR});
  }
  if (url.pathname==='/api/location-requests' && method==='POST') {
    if (!me.name) fail(400,'Save your name in your profile before asking the team.');
    const data=await body(request);
    if (typeof data?.message!=='string'||data.message.length>200) fail(400,'Messages can be up to 200 characters.');
    const result=await db.prepare(`INSERT INTO location_requests (id,profile_id,message,created_at,expires_at)
      SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM location_requests WHERE profile_id=? AND created_at>?)`)
      .bind(crypto.randomUUID(),me.id,data.message.trim(),now,now+HOUR,me.id,now-COOLDOWN).run();
    if (!result.meta.changes) fail(429,'You can ask again 10 minutes after your last request.');
    return json({next_request_at:now+COOLDOWN},201);
  }
  const dismiss=url.pathname.match(/^\/api\/location-requests\/([0-9a-f-]{36})\/dismiss$/);
  if (dismiss && method==='POST') {
    await db.prepare('INSERT OR IGNORE INTO request_dismissals (request_id,profile_id) SELECT id,? FROM location_requests WHERE id=? AND expires_at>?').bind(me.id,dismiss[1],now).run();
    return json({dismissed:true});
  }
  fail(405,'Method not allowed.');
}
