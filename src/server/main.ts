import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { resolveDataDir } from '../core/paths.ts';
import { NcrStorage } from '../core/storage.ts';
import { createApp } from './app.ts';
import { loadSampleRecords } from './sample.ts';

// Loopback only: the app is never reachable from another machine.
const HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 4310;

// src/server and dist/server sit at the same depth, so this works before and after the build.
const packageRoot = resolve(import.meta.dirname, '../..');
const loadSample = () => loadSampleRecords(join(packageRoot, 'fixtures', 'ncr-sample.json'));

// An empty value, as in an unedited .env file, means "use the default".
const port = Number(process.env.VALYNCE_PORT || DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`VALYNCE_PORT must be a port number, got "${process.env.VALYNCE_PORT}"`);
}

const dataDir = resolveDataDir();
mkdirSync(dataDir, { recursive: true });
const storage = new NcrStorage(join(dataDir, 'valynce.db'));

// A brand-new database opens with the synthetic sample records so there is
// something to look at. This happens once; removing them is permanent.
if (storage.getMeta('sample_seeded') === null) {
  if (storage.count() === 0) storage.insertMany(loadSample(), 'sample');
  storage.setMeta('sample_seeded', new Date().toISOString());
}

// Set by "npm run dev" only: the Vite dev server is a different origin from this backend.
const devOrigin = process.env.VALYNCE_DEV_ORIGIN;

const app = createApp({
  storage,
  loadSample,
  uiDir: join(packageRoot, 'dist', 'ui'),
  trustedOrigins: devOrigin ? [devOrigin] : [],
});

const server = serve({ fetch: app.fetch, port, hostname: HOSTNAME }, (info) => {
  console.log(`Valynce is running at http://${HOSTNAME}:${info.port}`);
  console.log(`Records are stored in ${dataDir}`);
});

function shutdown(): void {
  server.close(() => {
    storage.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
