import { authenticate, HttpError } from './auth.mjs';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'private, no-store',
};
const json = (value, status = 200) => Response.json(value, { status, headers: securityHeaders });
const fail = (message, status = 400) => { throw new HttpError(status, message); };

async function limitedRequest(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) fail('This photo is too large. Try a smaller photo.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('The request is empty.');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail('This photo is too large. Try a smaller photo.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('content-type') || '' } });
}

function fileType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['jpg', 'image/jpeg'];
  if ([137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) return ['png', 'image/png'];
  const text = new TextDecoder('ascii');
  if (text.decode(bytes.slice(0,4)) === 'RIFF' && text.decode(bytes.slice(8,12)) === 'WEBP') return ['webp', 'image/webp'];
  return null;
}

async function createPost(request, env, identity) {
  let form;
  try { form = await (await limitedRequest(request, MAX_REQUEST_BYTES)).formData(); }
  catch (error) { if (error.status) throw error; fail('Choose a photo and try again.'); }
  const author = form.get('author');
  const caption = form.get('caption') ?? '';
  const photo = form.get('photo');
  if (typeof author !== 'string' || !author.trim() || author.length > 60) fail('Please enter a name (up to 60 characters).');
  if (typeof caption !== 'string' || caption.length > 1000) fail('Captions can be up to 1,000 characters.');
  if (!(photo instanceof File) || !photo.size || photo.size > MAX_IMAGE_BYTES) fail('Please choose a photo under 8 MB after resizing.');
  const type = fileType(new Uint8Array(await photo.slice(0,12).arrayBuffer()));
  if (!type) fail('Please choose a JPG, PNG or WebP photo.');
  let lat = null, lng = null, location = null;
  const rawLat = form.get('lat'), rawLng = form.get('lng');
  if (rawLat || rawLng) {
    lat = Number(rawLat); lng = Number(rawLng); location = form.get('location');
    if (!rawLat || !rawLng || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || typeof location !== 'string' || !location.trim() || location.length > 100) fail('Please choose a valid location.');
    location = location.trim();
  }
  const id = crypto.randomUUID();
  const key = `${id}.${type[0]}`;
  // Check quotas before writing R2; database triggers enforce them atomically too.
  const quota = await env.DB.prepare(`SELECT (SELECT bytes FROM storage_usage WHERE id=1) AS bytes,
    (SELECT COUNT(*) FROM posts WHERE owner_email=? AND created_at>=?) AS daily`).bind(identity.email, `${new Date().toISOString().slice(0,10)}T00:00:00.000Z`).first();
  if (quota.bytes + photo.size > 8_000_000_000) fail('Our photo storage is full. Please contact the app owner.', 507);
  if (quota.daily >= 30) fail('You’ve shared 30 moments today. Come back tomorrow for more.', 429);
  await env.PHOTOS.put(key, photo.stream(), { httpMetadata: { contentType: type[1] } });
  try {
    await env.DB.prepare(`INSERT INTO posts (id,author,owner_email,caption,image,image_bytes,location,lat,lng,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,author.trim(),identity.email,caption.trim(),`/uploads/${key}`,photo.size,location,lat,lng,new Date().toISOString()).run();
  } catch (error) {
    await env.PHOTOS.delete(key);
    if (String(error).includes('storage_budget_exceeded')) fail('Our photo storage is full. Please contact the app owner.',507);
    if (String(error).includes('daily_upload_limit_exceeded')) fail('You’ve shared 30 moments today. Come back tomorrow for more.',429);
    throw error;
  }
  return json({ id }, 201);
}

// Dependency injection is only used by the separate local test entrypoint.
// The deployed default always uses cryptographically verified Access identity.
export function createApp(verifyIdentity = authenticate) {
  return {
    async fetch(request, env) {
      try {
        const identity = await verifyIdentity(request, env);
        const url = new URL(request.url);
        const method = request.method;
        if (!['GET','HEAD'].includes(method)) {
          if (request.headers.get('origin') !== url.origin) fail('Cross-origin requests are not allowed.',403);
        }
        if (url.pathname === '/api/session' && method === 'GET') return json({ email: identity.email, hosted: true });
        if (url.pathname === '/api/posts' && method === 'GET') {
          const { results } = await env.DB.prepare(`SELECT p.id,p.author,p.caption,p.image,p.location,p.lat,p.lng,p.created_at,p.demo,
            (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
            EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND visitor=?) AS liked
            FROM posts p ORDER BY created_at DESC`).bind(identity.email).all();
          return json(results);
        }
        if (url.pathname === '/api/posts' && method === 'POST') return await createPost(request, env, identity);
        const like = url.pathname.match(/^\/api\/posts\/([a-zA-Z0-9-]+)\/like$/);
        if (like && method === 'PUT') {
          let body;
          try { body = await (await limitedRequest(request,1024)).json(); }
          catch (error) { if(error.status) throw error; fail('Invalid reaction.'); }
          if (typeof body?.liked !== 'boolean') fail('Invalid reaction.');
          if (!await env.DB.prepare('SELECT id FROM posts WHERE id=?').bind(like[1]).first()) fail('Moment not found.',404);
          if (body.liked) await env.DB.prepare('INSERT OR IGNORE INTO likes (post_id,visitor) VALUES (?,?)').bind(like[1],identity.email).run();
          else await env.DB.prepare('DELETE FROM likes WHERE post_id=? AND visitor=?').bind(like[1],identity.email).run();
          const result = await env.DB.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id=?').bind(like[1]).first();
          return json({liked:body.liked,likes:result.count});
        }
        if (url.pathname.startsWith('/api/')) fail('Not found.',404);
        if (!['GET','HEAD'].includes(method)) fail('Method not allowed.',405);
        if (url.pathname.startsWith('/uploads/')) {
          const key = url.pathname.slice('/uploads/'.length);
          if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) fail('Photo not found.',404);
          const photo = await env.PHOTOS.get(key);
          if (!photo) fail('Photo not found.',404);
          const headers = new Headers(securityHeaders);
          photo.writeHttpMetadata(headers);
          headers.set('ETag',photo.httpEtag);
          headers.set('Content-Length',String(photo.size));
          return new Response(method === 'HEAD' ? null : photo.body, { headers });
        }
        const asset = await env.ASSETS.fetch(request);
        const response = new Response(asset.body, asset);
        for (const [key,value] of Object.entries(securityHeaders)) response.headers.set(key,value);
        return response;
      } catch (error) {
        if (!error.status) console.error('Garrigram request failed', error);
        return json({error:error.status?error.message:'Something went wrong. Please try again.'},error.status||500);
      }
    },
  };
}

export default createApp();
