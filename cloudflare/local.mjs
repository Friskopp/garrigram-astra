// Deliberately separate from worker.mjs: this identity is never deployed.
import { createApp } from './worker.mjs';
const app = createApp(async () => ({ email: 'local-preview@garrison.se' }));
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/api/session' && request.method === 'GET') {
      return Response.json({ hosted: false }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return app.fetch(request, env);
  },
};
