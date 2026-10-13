// The Valynce server as "npm run check:browser" starts it for the offline AI
// checks: the real built app, with the offline AI pointed at a pretend model and
// a pretend runtime served from this machine. It exists so that those checks
// never download the real model. Valynce itself has no way to change what the
// offline AI downloads; that is fixed in src/ai/local/assets.ts.
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { providerFromEnv } from '../dist/ai/config.js';
import { OfflineAi } from '../dist/ai/local/offline.js';
import { NcrStorage } from '../dist/core/storage.js';
import { createApp } from '../dist/server/app.js';

const root = resolve(import.meta.dirname, '..');
const storage = new NcrStorage(join(process.env.VALYNCE_DATA_DIR, 'valynce.db'));
const offlineAi = new OfflineAi({ dir: process.env.VALYNCE_AI_DIR, manifest: JSON.parse(process.env.CHECK_OFFLINE_MANIFEST), freeBytes: async () => 1e12 });
const app = createApp({
  storage,
  loadSample: () => [],
  uiDir: join(root, 'dist', 'ui'),
  ai: providerFromEnv(),
  aiTimeoutMs: 2000,
  offlineAi,
  offlineTimeoutMs: Number(process.env.CHECK_OFFLINE_TIMEOUT_MS || 20000),
});
const server = serve({ fetch: app.fetch, port: Number(process.env.VALYNCE_PORT), hostname: '127.0.0.1' });
function shutdown() {
  offlineAi.shutdown();
  server.close(() => {
    storage.close();
    process.exit(0);
  });
  if ('closeAllConnections' in server) server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
