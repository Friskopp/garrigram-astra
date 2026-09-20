import { HttpError } from './auth.mjs';

// Fixed, versioned presets prevent arbitrary transformations and preserve aspect ratio.
const presets = { map: { size: 160, quality: 75 }, feed: { size: 960, quality: 82 } };
export const variantKey = (key, size) => `variants/v1/${key}/${size}.webp`;
export const photoKeys = key => [key, ...Object.keys(presets).map(size => variantKey(key, size))];
const pending = new Map();
let retryAfter = 0;

async function generate(env, key, size, postId) {
  const target = variantKey(key, size);
  if (pending.has(target)) return pending.get(target);
  const job = (async () => {
    const source = await env.PHOTOS.get(key);
    if (!source) throw new HttpError(404, 'Photo not found.');
    const preset = presets[size];
    const output = await env.IMAGES.input(source.body)
      .transform({ width: preset.size, height: preset.size, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: preset.quality, anim: false });
    const response = output.response();
    if (!response.ok || response.headers.get('content-type') !== 'image/webp') throw new Error('Image processing failed');
    const bytes = await response.arrayBuffer();
    await env.PHOTOS.put(target, bytes, { httpMetadata: { contentType: 'image/webp' } });
    try {
      // The foreign key also catches a post deleted while its image was processing.
      await env.DB.prepare('INSERT INTO photo_variants (post_id,object_key,bytes) VALUES (?,?,?) ON CONFLICT(object_key) DO NOTHING')
        .bind(postId, target, bytes.byteLength).run();
    } catch (error) {
      await env.PHOTOS.delete(target);
      throw error;
    }
  })();
  pending.set(target, job);
  try { await job; } finally { pending.delete(target); }
}

// Called only after Access authentication, including conditional requests.
export async function servePhoto(request, env, securityHeaders) {
  const url = new URL(request.url);
  const key = url.pathname.slice('/uploads/'.length);
  const size = url.searchParams.get('size');
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) || (size !== null && !Object.hasOwn(presets, size))) {
    throw new HttpError(404, 'Photo not found.');
  }
  const post = await env.DB.prepare('SELECT id FROM posts WHERE image=?').bind(`/uploads/${key}`).first();
  if (!post) throw new HttpError(404, 'Photo not found.');
  let photo = size ? await env.PHOTOS.head(variantKey(key, size)) : null;
  let objectKey = photo ? variantKey(key, size) : key;
  if (size && !photo && env.IMAGES && Date.now() >= retryAfter) {
    try {
      await generate(env, key, size, post.id);
      photo = await env.PHOTOS.head(variantKey(key, size));
      if (photo) objectKey = variantKey(key, size);
    } catch {
      // Quota/service failures must not break photos or cause a transform retry storm.
      retryAfter = Date.now() + 5 * 60_000;
      console.warn('Photo optimization unavailable; serving originals for five minutes.');
    }
  }
  photo ||= await env.PHOTOS.head(key);
  if (!photo || !await env.DB.prepare('SELECT id FROM posts WHERE id=?').bind(post.id).first()) {
    throw new HttpError(404, 'Photo not found.');
  }
  const headers = new Headers(securityHeaders);
  photo.writeHttpMetadata(headers);
  // Keep bytes in the browser, but authenticate/revalidate before every reuse.
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('ETag', photo.httpEtag);
  headers.set('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
  const tags = request.headers.get('if-none-match')?.split(',').map(tag => tag.trim().replace(/^W\//, '')) || [];
  if (tags.includes('*') || tags.includes(photo.httpEtag)) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(photo.size));
  if (request.method === 'HEAD') return new Response(null, { headers });
  const body = await env.PHOTOS.get(objectKey);
  if (!body) throw new HttpError(404, 'Photo not found.');
  return new Response(body.body, { headers });
}
