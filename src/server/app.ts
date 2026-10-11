import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import type { NcrFields } from '../core/ncr.ts';
import type { NcrStorage } from '../core/storage.ts';
import { computeTotals } from '../modules/quality/totals.ts';
import type { LoadSampleResponse, NcrListResponse, RemoveSampleResponse } from './contract.ts';

export interface AppOptions {
  storage: NcrStorage;
  /** Returns the synthetic sample records. */
  loadSample: () => NcrFields[];
  /** Folder holding the built browser interface. */
  uiDir: string;
  /**
   * Extra origins allowed to send writes, such as the Vite dev server that
   * proxies to this backend. Empty in the packaged app.
   */
  trustedOrigins?: readonly string[];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function createApp({ storage, loadSample, uiDir, trustedOrigins = [] }: AppOptions): Hono {
  const app = new Hono();
  const uiRoot = resolve(uiDir);

  // The records belong to whoever sits at this machine. Refuse requests that
  // arrive under another host name (DNS rebinding) and writes started by
  // another website open in the same browser.
  app.use(async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    let hostname: string;
    try {
      hostname = new URL(`http://${host}`).hostname;
    } catch {
      return c.text('Bad Host header', 400);
    }
    if (!LOOPBACK_HOSTS.has(hostname)) return c.text('Valynce only answers on localhost', 403);

    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin !== undefined && !trustedOrigins.includes(origin)) {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          // 'null' and malformed origins fall through to the refusal below.
        }
        if (originHost !== host) return c.text('Cross-site request refused', 403);
      }
      const site = c.req.header('sec-fetch-site');
      if (site !== undefined && site !== 'same-origin' && site !== 'none') {
        return c.text('Cross-site request refused', 403);
      }
    }
    await next();
  });

  app.get('/api/ncrs', (c) => {
    const records = storage.list();
    const body: NcrListResponse = {
      records,
      totals: computeTotals(records),
      sampleCount: records.filter((r) => r.origin === 'sample').length,
    };
    return c.json(body);
  });

  app.post('/api/sample', (c) => {
    const body: LoadSampleResponse = storage.insertMany(loadSample(), 'sample');
    return c.json(body);
  });

  app.delete('/api/sample', (c) => {
    const body: RemoveSampleResponse = { deleted: storage.deleteByOrigin('sample') };
    return c.json(body);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // Everything else is the built browser interface.
  app.get('*', async (c) => {
    let path: string;
    try {
      path = decodeURIComponent(c.req.path);
    } catch {
      return c.text('Bad path', 400);
    }
    let file = resolve(uiRoot, `.${path}`);
    if (file !== uiRoot && !file.startsWith(uiRoot + sep)) return c.text('Not found', 404);
    if (!(await isFile(file))) file = resolve(uiRoot, 'index.html');
    if (!(await isFile(file))) {
      return c.text('The browser interface is not built yet. Run "npm run build", or use "npm run dev".', 503);
    }
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    return c.body(await readFile(file), 200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  });

  return app;
}
