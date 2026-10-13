import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { providerFromEnv } from '../ai/config.ts';
import { megabytes, OfflineAi } from '../ai/local/offline.ts';
import { resolveAiDir, resolveDataDir } from '../core/paths.ts';
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

// Set by "npm run dev" only: the Vite dev server is a different origin from this backend.
const devOrigin = process.env.VALYNCE_DEV_ORIGIN;

// Optional. With no key the app works as before and makes no outside requests.
const ai = providerFromEnv();
const aiTimeoutSeconds = Number(process.env.VALYNCE_AI_TIMEOUT_SECONDS || 60);
if (!Number.isInteger(aiTimeoutSeconds) || aiTimeoutSeconds < 1 || aiTimeoutSeconds > 300) {
  throw new Error(`VALYNCE_AI_TIMEOUT_SECONDS must be a whole number from 1 to 300, got "${process.env.VALYNCE_AI_TIMEOUT_SECONDS}"`);
}

// Optional as well. Creating it only looks at what is already on disk: nothing is
// downloaded or started until the user enables offline AI and asks for a summary.
const offlineAi = new OfflineAi({ dir: resolveAiDir() });
const offlineTimeoutSeconds = Number(process.env.VALYNCE_OFFLINE_AI_TIMEOUT_SECONDS || 180);
if (!Number.isInteger(offlineTimeoutSeconds) || offlineTimeoutSeconds < 1 || offlineTimeoutSeconds > 900) {
  throw new Error(`VALYNCE_OFFLINE_AI_TIMEOUT_SECONDS must be a whole number from 1 to 900, got "${process.env.VALYNCE_OFFLINE_AI_TIMEOUT_SECONDS}"`);
}

const app = createApp({
  storage,
  loadSample,
  uiDir: join(packageRoot, 'dist', 'ui'),
  trustedOrigins: devOrigin ? [devOrigin] : [],
  ai,
  aiTimeoutMs: aiTimeoutSeconds * 1000,
  offlineAi,
  offlineTimeoutMs: offlineTimeoutSeconds * 1000,
});

const server = serve({ fetch: app.fetch, port, hostname: HOSTNAME }, (info) => {
  console.log(`Valynce is running at http://${HOSTNAME}:${info.port}`);
  console.log(`Records are stored in ${dataDir}`);
  console.log(
    ai === null
      ? 'Online AI: off (no ANTHROPIC_API_KEY). No records are sent outside this computer.'
      : `Online AI: available through ${ai.name} (${ai.model}) at ${ai.host}. Data is sent only when you confirm a summary.`,
  );
  const offline = offlineAi.status();
  console.log(
    offline.state === 'ready'
      ? `Offline AI: installed (${offline.model.label}) in ${offline.folder}. It runs on this computer when you ask for a summary.`
      : offline.state === 'unsupported'
        ? `Offline AI: ${offline.message}`
        : `Offline AI: not installed. Enabling it in the app downloads ${megabytes(offline.totalBytes)}; nothing is downloaded until then.`,
  );
});

function shutdown(): void {
  // Stops a download in progress and the local model, so nothing keeps running or holding memory.
  offlineAi.shutdown();
  server.close(() => {
    storage.close();
    process.exit(0);
  });
  // Browsers keep spare connections open. close() waits for them, so without
  // this Ctrl+C stops new requests but the process never exits.
  if ('closeAllConnections' in server) server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
