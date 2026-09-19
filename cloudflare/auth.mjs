import { createRemoteJWKSet, jwtVerify } from 'jose';

const keySets = new Map();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Static Assets' router does not propagate ctx.access, so verify Access JWTs here.
// Neither user-supplied email headers nor browser visitor IDs establish identity.
export async function authenticate(request, env, keySet) {
  const issuer = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !env.ACCESS_AUD) {
    throw new HttpError(503, 'Garrigram is being set up. Team sign-in is not configured yet.');
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new HttpError(401, 'Please sign in with your Garrison email.');
  if (!keySet) {
    if (!keySets.has(issuer)) keySets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    keySet = keySets.get(issuer);
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
    }));
  } catch {
    throw new HttpError(401, 'Your sign-in has expired or is invalid. Please sign in again.');
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
  const domain = env.ALLOWED_EMAIL_DOMAIN || 'garrison.se';
  if (!email || email.split('@').length !== 2 || email.split('@')[1] !== domain) {
    throw new HttpError(403, 'Garrigram is available to the Garrison team only.');
  }
  return { email };
}
