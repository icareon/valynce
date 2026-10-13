// Drives the built app in headless Chrome and checks what a person would see and do.
// Usage: npm run build && npm run check:browser [-- <screenshot folder>]
// It starts its own server on a spare port with a throwaway database, so it
// never touches real Valynce data. Chrome is found at CHROME_PATH or the usual places.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const shotsDir = resolve(process.argv[2] ?? join(tmpdir(), 'valynce-browser-check'));
const work = mkdtempSync(join(tmpdir(), 'valynce-check-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => path && existsSync(path));

if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(2);
}
if (!existsSync(join(root, 'dist/server/main.js')) || !existsSync(join(root, 'dist/ui/index.html'))) {
  console.error('The app is not built. Run "npm run build" first.');
  process.exit(2);
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

async function until(test, what, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const value = await test();
      if (value) return value;
    } catch {
      // not ready yet
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(60);
  }
}

// ---------- the app under test ----------

const appPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
const dataDir = join(work, 'data');
let server;

// A stand-in for the AI provider, on this machine. The checks never contact a real
// provider and never use a real key: the server under test is pointed here instead.
const model = { mode: 'good', requests: [] };
const MODEL_REPLIES = {
  good: {
    overview: 'Recorded cost in USD sits mostly in the Material category, which rests on one report. Some reports have no cost recorded.',
    findings: [
      { kind: 'fact', statement: 'The Material cost comes from a single report of a wrong alloy delivery.', recordIds: ['PC-008'] },
      { kind: 'hypothesis', statement: 'The labeling reports may share one labeling step, which could be checked.', recordIds: ['PC-001', 'PC-003'] },
    ],
    missingInformation: ['Two reports have no cost, and one cost in another currency is not ranked.'],
    nextSteps: ['Review PC-008 with the receiving inspection records.'],
  },
  bad: {
    overview: 'The root cause is the supplier.',
    findings: [{ kind: 'fact', statement: 'Everything traces to one report.', recordIds: ['PC-999'] }],
    missingInformation: [],
    nextSteps: [],
  },
};
const modelServer = createHttpServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    model.requests.push({ url: request.url, key: request.headers['x-api-key'], body });
    if (model.mode === 'slow') return; // never answers; the app must give up by itself
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(MODEL_REPLIES[model.mode]) }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((done) => modelServer.listen(0, '127.0.0.1', done));
const modelHost = `127.0.0.1:${modelServer.address().port}`;
// A stand-in for the offline AI's downloads and runtime, also on this machine: a
// small file in place of the model, and a script in place of llama-server that
// answers with one citation per theme taken from the schema it is given.
const FAKE_RUNTIME = `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const model = args[args.indexOf('-m') + 1];
http.createServer((request, response) => {
  if (request.url === '/health') return response.end('{"status":"ok"}');
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    fs.appendFileSync(model + '.requests', body + '\\n');
    if (fs.existsSync(model + '.slow')) return; // never answers; Valynce must give up or be cancelled
    const schema = JSON.parse(body).response_format.json_schema.schema;
    const reply = { overview: 'The reports describe labeling, dimensional and material problems.' };
    for (const key of schema.required.filter((k) => k !== 'overview')) {
      reply[key] = { statement: 'The reports in this category describe similar problems.', recordIds: [schema.properties[key].properties.recordIds.items.enum[0]] };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
}).listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`;
function tarEntry(name, type, body = Buffer.alloc(0)) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000755\0', 100, 8);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write('        ', 148, 8);
  header.write(type, 156, 1);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
const fakeModel = Buffer.alloc(3_000_000, 7);
const fakeArchive = gzipSync(Buffer.concat([tarEntry('fake-rt/', '5'), tarEntry('fake-rt/llama-server', '0', Buffer.from(FAKE_RUNTIME)), Buffer.alloc(1024)]));
const downloadsSeen = [];
let slowDownloads = false;
const downloadServer = createHttpServer(async (request, response) => {
  downloadsSeen.push(request.url);
  const data = request.url === '/model.gguf' ? fakeModel : request.url === '/rt.tar.gz' ? fakeArchive : null;
  if (data === null) return response.writeHead(404).end();
  response.writeHead(200);
  for (let at = 0; at < data.length && !response.destroyed; at += 100_000) {
    response.write(data.subarray(at, at + 100_000));
    if (slowDownloads) await sleep(150);
  }
  response.end();
});
await new Promise((done) => downloadServer.listen(0, '127.0.0.1', done));
const downloadBase = `http://127.0.0.1:${downloadServer.address().port}`;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const OFFLINE_ENV = {
  CHECK_OFFLINE_MANIFEST: JSON.stringify({
    model: { label: 'Check model', id: 'check-model-q4', file: 'model.gguf', source: 'downloads.test', url: `${downloadBase}/model.gguf`, bytes: fakeModel.length, sha256: sha256(fakeModel) },
    runtime: { name: 'check runtime', build: 'c1', source: 'runtime.test', folder: 'fake-rt', program: 'llama-server', archive: { url: `${downloadBase}/rt.tar.gz`, bytes: fakeArchive.length, sha256: sha256(fakeArchive) } },
  }),
};
const OFFLINE_SERVER = 'scripts/browser-check-server.mjs';

const AI_ENV = { ANTHROPIC_API_KEY: 'browser-check-not-a-real-key', VALYNCE_AI_BASE_URL: `http://${modelHost}`, VALYNCE_AI_TIMEOUT_SECONDS: '2' };

// The offline AI's files go to a throwaway folder as well, so a model installed on
// this computer is neither used nor touched, and nothing real is ever downloaded.
const aiDir = join(work, 'offline-ai');

async function startServer(extra = {}, entry = 'dist/server/main.js') {
  server = spawn(process.execPath, [entry], {
    cwd: root,
    // No key unless a check asks for one, whatever the shell running the checks has set.
    env: { ...process.env, VALYNCE_DATA_DIR: dataDir, VALYNCE_AI_DIR: aiDir, VALYNCE_PORT: String(appPort), VALYNCE_DEV_ORIGIN: '', ANTHROPIC_API_KEY: '', VALYNCE_AI_BASE_URL: '', VALYNCE_AI_MODEL: '', VALYNCE_AI_TIMEOUT_SECONDS: '', ...extra },
    stdio: 'ignore',
  });
  await until(async () => (await fetch(`${base}/api/ncrs`)).ok, 'the Valynce server');
}

async function stopServer() {
  const exited = new Promise((done) => server.once('exit', done));
  server.kill('SIGINT');
  await exited;
}

// ---------- a minimal Chrome DevTools Protocol client ----------

const debugPort = await freePort();
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(work, 'chrome')}`,
    '--no-first-run',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const target = await until(async () => {
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  return pages.find((page) => page.type === 'page');
}, 'Chrome');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done, fail) => {
  socket.addEventListener('open', done);
  socket.addEventListener('error', fail);
});

let nextId = 0;
const pending = new Map();
const requested = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Network.requestWillBeSent') requested.push(message.params.request.url);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.fail(new Error(message.error.message));
  else waiter.done(message.result);
});

function cdp(method, params = {}) {
  return new Promise((done, fail) => {
    nextId += 1;
    pending.set(nextId, { done, fail });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
}

// Helpers available to every snippet evaluated in the page.
const PRELUDE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const text = (s) => $(s)?.textContent.trim() ?? null;
  const byText = (s, t) => $$(s).find((el) => el.textContent.trim().includes(t));
`;

async function page(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression: `(async () => { ${PRELUDE} return (${expression}); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error');
  return result.result.value;
}

const waitFor = (expression, timeout) => until(() => page(expression), expression, timeout);
const click = (expression) => page(`(${expression}).click()`);

const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
async function press(key) {
  const [code, text] = KEYS[key];
  const event = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...event, ...(text ? { text } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

async function type(selector, value) {
  await page(`($(${JSON.stringify(selector)}).focus(), $(${JSON.stringify(selector)}).select?.())`);
  await cdp('Input.insertText', { text: value });
}

async function choose(selector, label) {
  await page(`(() => {
    const el = $(${JSON.stringify(selector)});
    const option = [...el.options].find((o) => o.textContent.trim() === ${JSON.stringify(label)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, option.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function upload(selector, path) {
  const { root: doc } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.nodeId, selector });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [path] });
}

// A real wheel event at a point on the page, as a mouse or trackpad would send.
async function wheel(x, y, deltaY) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  await sleep(250);
}

async function viewport(width, height) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
}

mkdirSync(shotsDir, { recursive: true });
async function screenshot(name) {
  await sleep(250);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
}

async function goto(hash = '') {
  await cdp('Page.navigate', { url: `${base}/${hash}` });
  // A download can leave the headless page marked hidden, which stops frames and so transitions.
  await cdp('Page.bringToFront');
  await waitFor(`document.readyState === 'complete' && ($('.empty') || $('.page-head')) !== null`);
}

// ---------- checks ----------

let failures = 0;
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
}

const OVERFLOW = `(() => {
  const wide = (el) => el && el.scrollWidth > el.clientWidth + 1;
  const shown = (el) => el.getClientRects().length > 0;
  return {
    page: document.documentElement.scrollWidth > window.innerWidth + 1,
    main: wide($('.main')),
    table: $$('.table-wrap').filter(shown).some(wide),
    clipped: $$('.btn, .field, .bar, .rail a, .local, .seg button').filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
    }).length,
  };
})()`;

// Every piece of text on screen against the solid colour behind it.
const CONTRAST = `(() => {
  const channels = (color) => color.match(/[\\d.]+/g).map(Number);
  const luminance = (color) => {
    const [r, g, b] = channels(color).slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const solidBackground = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const parts = channels(getComputedStyle(node).backgroundColor);
      if (parts.length === 3 || parts[3] === 1) return getComputedStyle(node).backgroundColor;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const weak = new Set();
  const walker = document.createTreeWalker($('.app'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.textContent.trim() || el.getClientRects().length === 0) continue;
    if (el.closest('.visually-hidden, [aria-hidden=true], :disabled, option')) continue;
    const style = getComputedStyle(el);
    if (Number(style.opacity) < 1) continue;
    const a = luminance(style.color);
    const b = luminance(solidBackground(el));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5) weak.add((el.className || el.tagName) + ' ' + ratio.toFixed(2));
  }
  return [...weak];
})()`;

// Who scrolls, and how tall the document is compared with what is in it.
const SCROLL = `(() => {
  const de = document.documentElement;
  const view = $('.view');
  const nested = $$('.app *').filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getClientRects().length > 0 && !el.closest('.detail');
  }).map((el) => String(el.className || el.tagName));
  const point = (el, dy) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(Math.min(Math.max(b.top + dy, 60), innerHeight - 30))]; };
  return {
    doc: de.scrollHeight, viewport: innerHeight, y: Math.round(scrollY), max: de.scrollHeight - innerHeight,
    contentBottom: Math.round(view.getBoundingClientRect().bottom + scrollY),
    appbar: [Math.round($('.appbar').getBoundingClientRect().top), getComputedStyle($('.appbar')).position],
    // On wide screens the rail stays under the app bar; on a phone it is a normal row that scrolls away.
    railOffset: getComputedStyle($('.rail')).position === 'sticky' ? Math.round($('.rail').getBoundingClientRect().top - $('.appbar').getBoundingClientRect().bottom) : 0,
    hiddenImportHeight: $('.import-view').hidden ? $('.import-view').getBoundingClientRect().height : 0,
    nested,
    points: { chart: point($('.pareto'), 120), table: point($$('.table-wrap').find((t) => t.getClientRects().length > 0), 30), sidebar: [28, 420], background: [innerWidth - 6, 300], detail: point($('.detail'), 300) },
  };
})()`;

/**
 * The document must be the only thing that scrolls vertically, be exactly as
 * tall as its content, and scroll the same way wherever the pointer is.
 */
async function scrollModel(name) {
  await page(`(scrollTo(0, 0), 0)`);
  await sleep(120);
  const start = await page(SCROLL);
  check(`${name}: only the page scrolls vertically`, start.nested.length === 0, start.nested.join(', '));
  check(`${name}: the page is exactly as tall as its content, with no blank region`, Math.abs(start.doc - Math.max(start.viewport, start.contentBottom)) <= 1 && start.hiddenImportHeight === 0, JSON.stringify({ doc: start.doc, viewport: start.viewport, contentBottom: start.contentBottom, hiddenImport: start.hiddenImportHeight }));
  const results = [];
  for (const [where, at] of Object.entries(start.points)) {
    if (at === null || at[0] > start.viewport * 3) continue;
    await page(`(scrollTo(0, 0), 0)`);
    await sleep(80);
    for (let i = 0; i < Math.ceil(start.max / 500) + 2; i += 1) await wheel(at[0], at[1], 600);
    const end = await page(SCROLL);
    // At the end of the page the last content sits at the bottom edge, never above it.
    const blank = end.doc > end.viewport ? end.viewport - (end.contentBottom - end.y) : 0;
    results.push({ where, y: end.y, max: end.max, appbarTop: end.appbar[0], railOffset: end.railOffset, blank });
  }
  check(`${name}: the wheel scrolls the page to its end from the chart, table, sidebar and background alike, and the app bar and rail stay put`,
    results.every((r) => r.y === r.max && r.appbarTop === 0 && r.railOffset === 0 && r.blank <= 0) && start.appbar[1] === 'sticky', JSON.stringify(results));
  await page(`(scrollTo(0, 0), 0)`);
  await sleep(80);
}

const rowCount = `$$('.records tbody tr').length`;
const countText = `text('.toolbar-count')`;
const barValues = `$$('.bar').map((b) => [b.querySelector('.bar-label').textContent, b.querySelector('.bar-count').textContent, b.querySelector('.bar-cum').textContent])`;
const barSum = `$$('.bar-count').reduce((sum, el) => sum + parseInt(el.textContent, 10), 0)`;
const theme = `document.documentElement.dataset.theme`;
const SIZES = [[1440, 900], [1280, 800]];

async function setTheme(name) {
  if ((await page(theme)) !== name) await click(`$('.theme-toggle')`);
  // Colours cross-fade; wait for that to finish before measuring or photographing.
  await waitFor(`${theme} === ${JSON.stringify(name)} && document.getAnimations().length === 0`);
  await sleep(50);
}

async function fits(label) {
  const overflow = await page(OVERFLOW);
  check(`${label}: nothing overflows or is clipped`, !overflow.page && !overflow.main && !overflow.table && overflow.clipped === 0, JSON.stringify(overflow));
}

/** Checks contrast and takes a screenshot in each theme at each size, leaving the light theme on. */
async function inBothThemes(name, { sizes = SIZES } = {}) {
  for (const mode of ['light', 'dark']) {
    await setTheme(mode);
    const weak = await page(CONTRAST);
    check(`${name}, ${mode} theme: text contrast is at least 4.5:1`, weak.length === 0, weak.join(', '));
    for (const [width, height] of sizes) {
      await viewport(width, height);
      await fits(`${name}, ${mode} theme at ${width}x${height}`);
      await screenshot(`${name}-${mode}-${width}x${height}`);
    }
    await viewport(1440, 900);
  }
  await setTheme('light');
}

async function importFile(path, expectReady) {
  await click(`byText('.rail a', 'Import')`);
  await waitFor(`text('.import-view .page-head h1') === 'Import CSV'`);
  if (await page(`byText('.import-view .btn', 'Import another file') !== undefined`)) {
    await click(`byText('.import-view .btn', 'Import another file')`);
  }
  await upload('input[type=file]', path);
  const name = path.split('/').at(-1);
  await waitFor(`$('.chips') !== null && text('.file-name').includes(${JSON.stringify(name)})`);
  if (expectReady !== undefined) {
    await waitFor(`byText('.button-row .btn', 'Import ${expectReady} report') !== undefined`);
    await click(`byText('.button-row .btn', 'Import ${expectReady} report')`);
    await waitFor(`$('.import-done') !== null`);
  }
}

async function run() {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  const downloads = join(work, 'downloads');
  mkdirSync(downloads);
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(() =>
    cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }),
  );
  await viewport(1440, 900);

  // --- First visit: light theme, empty database ---
  await startServer();
  await goto();
  check('a first visit uses the light theme', (await page(theme)) === 'light' && (await page(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(245, 245, 242)');
  const html = await (await fetch(base + '/')).text();
  check('the theme is applied by a script that runs before the app loads', html.indexOf('valynce-theme') !== -1 && html.indexOf('valynce-theme') < html.indexOf('type="module"'));
  check('a new database opens empty, with a one-sentence explanation', await page(`$('.empty') !== null && $('.records') === null`));
  check('the empty state offers "Load demo data" and a link to CSV import', await page(`byText('.empty .btn', 'Load demo data') !== undefined && byText('.empty a.btn', 'Import a CSV file')?.getAttribute('href') === '#/import'`));
  await inBothThemes('empty', { sizes: [[1440, 900]] });

  // --- A file with no currency column: USD only when the user confirms it ---
  const plainCsv = join(work, 'no-currency.csv');
  writeFileSync(plainCsv, 'NCR No,Defect Type,Qty,Cost\nNC-1,Dimensional,4,10.00\nNC-2,Labeling,2,20.50\nNC-3,Labeling,1,\n');
  await importFile(plainCsv);
  check('with no currency column the import offers one explicit choice, not ticked', await page(`$('.usd-confirm') !== null && !$('.usd-confirm').checked && $('.currency-input') === null && text('.confirm').includes('All costs in this file are USD')`));
  check('until it is ticked, the costs are to be stored as currency unspecified', await page(`$$('.hint').some((el) => el.textContent.includes('2 reports to import have a cost with no currency') && el.textContent.includes('left out of the USD cost total'))`));
  await click(`byText('.button-row .btn', 'Import 3 reports')`);
  await waitFor(`$('.import-done') !== null`);
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$$('.metric').length === 3`);
  const unstated = await page(`$$('.metric').map((m) => [m.querySelector('.metric-value').textContent.trim(), m.querySelector('.metric-coverage').textContent])`);
  check('costs with no stated currency are not shown as dollars: "No USD costs recorded."', unstated[2][0] === 'No USD costs recorded.' && unstated[2][1] === 'USD cost recorded in 0 of 3 reports' && !unstated[2][0].includes('$'), JSON.stringify(unstated));
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`$('.pareto-empty') !== null`);
  check('the cost ranking says there are no USD costs and what it leaves out', await page(`text('.pareto-empty').includes('No USD costs recorded.') && $$('.bar').length === 0 && text('#pareto-coverage').includes('USD cost recorded in 0 of 3 reports') && text('#pareto-coverage').includes('2 reports with a cost in another currency or with no currency stated are not ranked and not converted') && text('#pareto-coverage').includes('1 report with no cost is not ranked')`), await page(`text('#pareto-coverage')`));
  check('the unstated costs are still in the records list, unchanged', await page(`$$('.records tbody td.col-cost').map((td) => td.textContent).filter((t) => t.includes('currency unspecified') && (t.includes('10.00') || t.includes('20.50'))).length === 2`));
  await screenshot('no-usd-costs-light-1440x900');
  await click(`byText('.seg button', 'NCR reports')`);
  const firstImport = (await (await fetch(base + '/api/ncrs')).json()).imports[0].id;
  await fetch(`${base}/api/imports/${firstImport}`, { method: 'DELETE' });
  await goto();
  await waitFor(`$('.empty') !== null`);

  await importFile(plainCsv);
  await click(`$('.usd-confirm')`);
  await waitFor(`$('.usd-note') !== null`);
  check('ticking the box states exactly what it will do', await page(`$('.usd-confirm').checked && text('.usd-note').includes('2 costs will be stored as USD because you confirmed') && $$('.hint').every((el) => !el.textContent.includes('will be stored as currency unspecified'))`), await page(`text('.usd-note')`));
  await page(`($('.usd-confirm').scrollIntoView({ block: 'center' }), 0)`);
  await inBothThemes('import-usd-confirm', { sizes: [[1440, 900]] });
  await choose('#map-cost', 'Not in this file');
  await waitFor(`$('.usd-confirm') === null`);
  await choose('#map-cost', 'Cost');
  await waitFor(`$('.usd-confirm') !== null`);
  check('the confirmation does not carry over when the cost column changes', await page(`!$('.usd-confirm').checked && $('.usd-note') === null`));
  await click(`$('.usd-confirm')`);
  await waitFor(`$('.usd-note') !== null`);
  await click(`byText('.button-row .btn', 'Import 3 reports')`);
  await waitFor(`$('.import-done') !== null`);
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$$('.metric').length === 3`);
  const confirmedUsd = await page(`$$('.metric').map((m) => [m.querySelector('.metric-value').textContent.trim(), m.querySelector('.metric-coverage').textContent])`);
  check('after confirmation the two costs add up to $30.50 in 2 of 3 reports', confirmedUsd[2][0] === '$30.50' && confirmedUsd[2][1] === 'USD cost recorded in 2 of 3 reports', JSON.stringify(confirmedUsd));
  const storedUsd = (await (await fetch(base + '/api/ncrs')).json());
  check('storage holds USD on the two rows with a cost, none on the row without, and the original cells', JSON.stringify(storedUsd.records.map((r) => [r.ncrNumber, r.costCents, r.currency, r.sourceValues.Cost]).sort()) === JSON.stringify([['NC-1', 1000, 'USD', '10.00'], ['NC-2', 2050, 'USD', '20.50'], ['NC-3', null, null, '']]), JSON.stringify(storedUsd.records.map((r) => [r.ncrNumber, r.costCents, r.currency, r.sourceValues]).sort()));
  await fetch(`${base}/api/imports/${storedUsd.imports[0].id}`, { method: 'DELETE' });
  await goto();
  await waitFor(`$('.empty') !== null`);

  // --- Load demo data ---
  await click(`byText('.empty .btn', 'Load demo data')`);
  await waitFor(`$$('.metric').length === 3 && ${rowCount} === 24`);
  const metrics = await page(`$$('.metric').map((m) => [m.querySelector('.metric-label').textContent, m.querySelector('.metric-value')?.textContent.trim(), m.querySelector('.metric-coverage').textContent])`);
  check('the summary shows 24 reports, 1,722 units and $20,152.50', JSON.stringify(metrics.map((m) => m[1])) === JSON.stringify(['24', '1,722units', '$20,152.50']), JSON.stringify(metrics));
  check('the three groups are labelled NCR reports, Affected quantity and Recorded cost (USD)', JSON.stringify(metrics.map((m) => m[0])) === JSON.stringify(['NCR reports', 'Affected quantity', 'Recorded cost (USD)']), JSON.stringify(metrics.map((m) => m[0])));
  check('coverage labels state how many reports had a value',
    metrics[0][2] === 'Category in 22 of 24 reports' &&
    metrics[1][2] === 'Quantity in 21 of 24 reports' &&
    metrics[2][2] === 'USD cost recorded in 20 of 24 reports', JSON.stringify(metrics.map((m) => m[2])));
  check('the Pareto chart starts on NCR reports', (await page(`text('#chart-title')`)) === 'NCR reports by category' && await page(`byText('.seg button', 'NCR reports').getAttribute('aria-pressed') === 'true'`));
  check('bars add up to the 24 stored reports and end at 100% cumulative', (await page(barSum)) === 24 && (await page(barValues)).at(-1)[2] === '100.0%');
  check('reports with no category have their own Uncategorized bar', await page(`byText('.bar', 'Uncategorized')?.querySelector('.bar-count').textContent === '2'`));
  check('the cumulative line has one marker per bar', await page(`$$('.cum-dot').length === $$('.bar').length && $$('.cum-line').length === $$('.bar').length - 1`));
  check('the chart says it is not a root-cause finding', await page(`text('.pareto').includes('the leading category is not a verified root cause')`));
  check('demo data is flagged with a notice and per-row tags', await page(`text('.demo-notice').includes('Demo data') && $$('.records tbody .tag').length === 24`));
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    check(`all eight table columns are visible at ${width}x${height}`, (await page(`$$('.records thead th').filter((th) => th.getBoundingClientRect().width > 40).length`)) === 8);
  }
  await viewport(1440, 900);
  const SUMMARY = `(() => {
    const row = $('.metrics');
    const style = getComputedStyle(row);
    const cells = $$('.metric').map((m) => getComputedStyle(m));
    return {
      height: Math.round(row.getBoundingClientRect().height),
      background: style.backgroundColor,
      radius: style.borderRadius,
      edges: [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth, style.borderBottomWidth],
      rule: style.borderBottomColor,
      cellBackgrounds: cells.map((c) => c.backgroundColor),
      separators: cells.map((c) => c.borderLeftWidth),
      minHeights: [style.minHeight, ...cells.map((c) => c.minHeight)],
      value: getComputedStyle($('.metric-value')).fontSize,
      label: getComputedStyle($('.metric-label')).fontSize,
      gapToChart: Math.round($('.pareto').getBoundingClientRect().top - row.getBoundingClientRect().bottom),
      chartTop: Math.round($('.pareto').getBoundingClientRect().top),
    };
  })()`;
  const CLEAR = 'rgba(0, 0, 0, 0)';
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    const s = await page(SUMMARY);
    check(`the summary at ${width}x${height} is 80 to 100px tall with no minimum height`, s.height >= 80 && s.height <= 100 && s.minHeights.every((h) => h === '0px' || h === 'auto'), JSON.stringify(s));
    check(`the summary at ${width}x${height} is borderless: no panel, no rounded box, thin rules between groups and one underneath`,
      s.background === CLEAR && s.cellBackgrounds.every((c) => c === CLEAR) && s.radius === '0px' && JSON.stringify(s.edges) === JSON.stringify(['0px', '0px', '0px', '1px']) && JSON.stringify(s.separators) === JSON.stringify(['0px', '1px', '1px']), JSON.stringify(s));
    check(`the summary at ${width}x${height} lines its three coverage lines up`, new Set(await page(`$$('.metric-coverage').map((el) => Math.round(el.getBoundingClientRect().top))`)).size === 1);
    check(`the summary at ${width}x${height} has small labels, prominent values and the chart close below`, parseFloat(s.label) <= 12 && parseFloat(s.value) >= 26 && parseFloat(s.value) <= 32 && s.gapToChart <= 20, JSON.stringify(s));
  }
  await viewport(390, 800);
  const stacked = await page(`(() => { const tops = $$('.metric').map((m) => Math.round(m.getBoundingClientRect().top)); return { tops, clipped: $$('.metric, .metric-value, .metric-coverage').filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > innerWidth).map((el) => el.className + ' ' + el.scrollWidth + '/' + el.clientWidth), page: document.documentElement.scrollWidth <= innerWidth + 1 }; })()`);
  check('at 390px the three groups stack with nothing clipped', stacked.tops[0] < stacked.tops[1] && stacked.tops[1] < stacked.tops[2] && stacked.clipped.length === 0 && stacked.page, JSON.stringify(stacked));
  await screenshot('overview-light-390x800');
  await viewport(1440, 900);
  const summary = await page(SUMMARY);
  check('the Pareto chart starts within 240px of the top of the window', summary.chartTop <= 240, JSON.stringify(summary));
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    await scrollModel(`overview at ${width}x${height}`);
  }
  await viewport(1440, 900);
  await inBothThemes('overview');

  // --- Definitions ---
  await click(`$$('.metric .icon-btn')[2]`);
  check('metric definitions open from the help button', await page(`!$$('.metric-help')[2].hidden && $$('.metric .icon-btn')[2].getAttribute('aria-expanded') === 'true'`));
  await click(`$$('.metric .icon-btn')[2]`);
  await click(`$('.pareto-controls .icon-btn')`);
  check('the chart explains bars, share and cumulative share', await page(`!$('.pareto-help').hidden && ['Bars', 'Share', 'Cumulative'].every((word) => text('.pareto-help').includes(word))`));
  await click(`$('.pareto-controls .icon-btn')`);

  // --- Category selection reveals the contributing records ---
  await click(`byText('.bar', 'Dimensional')`);
  await waitFor(`${rowCount} === 8`);
  check('selecting the Dimensional bar lists its 8 reports', (await page(countText)) === '8 of 24 reports' && await page(`$$('.records tbody td.col-category').every((td) => td.textContent === 'Dimensional')`));
  await sleep(300);
  check('the selected bar is pressed and is the only orange one', await page(`byText('.bar', 'Dimensional').getAttribute('aria-pressed') === 'true' && $$('.bar-fill').filter((f) => getComputedStyle(f).backgroundColor === 'rgb(255, 90, 31)').length === 1`));
  check('the readout states the selected category figures', await page(`text('.pareto-readout').includes('Dimensional') && text('.pareto-readout').includes('33.3%') && text('.pareto-readout').includes('listed below')`), await page(`text('.pareto-readout')`));
  await click(`byText('.bar', 'Uncategorized')`);
  await waitFor(`${rowCount} === 2`);
  check('the Uncategorized bar lists the 2 reports with no category', await page(`$$('.records tbody td.col-category').every((td) => td.textContent.includes('Not recorded'))`));
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);

  // --- Search and status filters share the chart's population ---
  await type('.search input', 'tool wear');
  await waitFor(`${rowCount} === 3`);
  check('search finds the 3 reports whose cause is "Tool wear"', (await page(countText)) === '3 of 24 reports');
  await scrollModel('overview with a short filtered table');
  check('the chart follows the search, adds up, and says what it is showing', (await page(barSum)) === 3 && await page(`text('#pareto-coverage').includes('Showing 3 of 24 reports')`));
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);
  await choose('.toolbar select', 'Open');
  await waitFor(`${rowCount} === 6`);
  check('the status filter shows the 6 open reports in both table and chart', (await page(countText)) === '6 of 24 reports' && (await page(barSum)) === 6);
  await type('.search input', 'zzzz');
  await waitFor(`$('.no-rows') !== null`);
  check('filters that match nothing say so in the table and in the chart', await page(`text('.no-rows').includes('No reports match') && text('.pareto-empty').includes('nothing to rank')`));
  await click(`byText('.no-rows .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);

  // --- Detail panel by keyboard ---
  await page(`$('.records tbody .row-open').focus()`);
  await press('Enter');
  await waitFor(`$('.detail') !== null`);
  check('Enter on a row opens its detail panel and moves focus into it', await page(`$('.detail').contains(document.activeElement) && text('#detail-title') === $('.records tbody tr.is-selected .row-open').textContent`));
  const detail = await page(`text('.detail')`);
  check('the detail panel shows description, disposition and reported cause', ['Description', 'Disposition', 'Reported cause'].every((label) => detail.includes(label)));
  check('reported cause is marked as not a verified root cause', detail.includes('no verified root cause'));
  check('the detail panel identifies demo data', await page(`$('.detail .tag') !== null && text('.detail').includes('Synthetic demo data')`));
  const squeezed = `$$('.records thead th').filter((th) => th.offsetWidth > 0).map((th) => Math.round(th.getBoundingClientRect().width))`;
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    const widths = await page(squeezed);
    check(`with the panel open at ${width}x${height}, no table column is squeezed unreadable`, widths.every((w) => w >= 72) && await page(`$('.records thead th.col-category').offsetWidth > 0`), JSON.stringify(widths));
  }
  await viewport(1440, 900);
  const beside = await page(`(() => { const b = $('.detail').getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), innerHeight, getComputedStyle($('.detail')).position]; })()`);
  check('the detail panel fills the space under the app bar and is outside the page flow', beside[0] === 48 && beside[1] === beside[2] && beside[3] === 'fixed', JSON.stringify(beside));
  await scrollModel('overview with the detail panel open');
  // The chart must stay legible in the space left beside the open panel.
  await viewport(1280, 800);
  const labels = await page(`$$('.pareto-axis span').filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect()).map((b) => [b.left, b.right])`);
  check('beside the open panel the chart axis labels do not overlap', labels.every((box, i) => i === 0 || box[0] >= labels[i - 1][1] + 2) && await page(`$('.bar-track').getBoundingClientRect().width >= 160`), JSON.stringify(labels));
  await viewport(1440, 900);
  await inBothThemes('detail');

  // --- Switching theme keeps what the user was doing ---
  await page(`(scrollTo(0, 0), 0)`);
  await click(`byText('.seg button', 'Recorded cost')`);
  await click(`byText('.bar', 'Material')`);
  await type('.search input', 'syn');
  await waitFor(`${rowCount} === 3`);
  const before = await page(`[text('#chart-title'), ${countText}, text('#detail-title'), $('.search input').value, byText('.bar', 'Material').getAttribute('aria-pressed')]`);
  check('the toggle names the theme it switches to', (await page(`text('.theme-toggle')`)) === 'Dark' && await page(`$('.theme-toggle').getAttribute('aria-label') === 'Switch to dark theme'`));
  await click(`$('.theme-toggle')`);
  await waitFor(`${theme} === 'dark'`);
  const after = await page(`[text('#chart-title'), ${countText}, text('#detail-title'), $('.search input').value, byText('.bar', 'Material').getAttribute('aria-pressed')]`);
  check('switching theme keeps the metric, filters, selected category and open record', JSON.stringify(before) === JSON.stringify(after) && before[0] === 'Recorded cost (USD) by category', JSON.stringify([before, after]));
  check('the dark theme is neutral, with no blue or teal tint', await page(`(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return r === g && g === b && r < 20; })()`) && (await page(`text('.theme-toggle')`)) === 'Light');
  await cdp('Page.reload');
  await waitFor(`document.readyState === 'complete' && $('.page-head') !== null`);
  check('the chosen theme survives a reload', (await page(theme)) === 'dark' && (await page(`localStorage.getItem('valynce-theme')`)) === 'dark');
  await setTheme('light');
  await cdp('Page.reload');
  await waitFor(`document.readyState === 'complete' && $('.page-head') !== null && ${rowCount} === 24`);
  check('switching back to light also survives a reload', (await page(theme)) === 'light');

  // --- Keyboard focus and reduced motion ---
  await press('Tab');
  const focus = await page(`(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.className, s.outlineStyle, s.outlineWidth, s.outlineColor]; })()`);
  check('keyboard focus shows a 2px orange outline', focus[1] === 'solid' && focus[2] === '2px' && focus[3] === 'rgb(224, 74, 18)', JSON.stringify(focus));
  await press('Tab');
  check('the theme toggle is reachable by keyboard and shows focus', await page(`document.activeElement === $('.theme-toggle') && getComputedStyle(document.activeElement).outlineStyle === 'solid'`), await page(`document.activeElement.className`));
  const duration = `getComputedStyle($('.btn')).transitionDuration`;
  const normal = await page(duration);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await page(duration);
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  check('transitions are 140 ms, and off when reduced motion is requested', normal.startsWith('0.14s') && reduced.split(',').every((d) => parseFloat(d) === 0), JSON.stringify([normal, reduced]));

  // --- Unknown is not zero ---
  await type('.search input', 'SYN-NCR-0019');
  await waitFor(`${rowCount} === 1`);
  const zeroRow = await page(`[text('.records tbody td.col-qty'), text('.records tbody td.col-cost')]`);
  check('a missing quantity and a recorded zero cost look different', zeroRow[0].includes('Not recorded') && zeroRow[1] === '$0.00', JSON.stringify(zeroRow));
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  // --- Records view ---
  await click(`byText('.rail a', 'Records')`);
  await waitFor(`text('.page-head h1') === 'Records'`);
  check('the Records view lists all 24 reports without the chart', (await page(rowCount)) === 24 && await page(`$('.pareto') === null`));
  check('the active view is marked in the navigation', await page(`byText('.rail a', 'Records').getAttribute('aria-current') === 'page'`));
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    await scrollModel(`records at ${width}x${height}`);
  }
  await viewport(1440, 900);
  await wheel(700, 500, 500);
  check('the table header stays just under the app bar while the page scrolls', await page(`scrollY > 100 && Math.abs($('.records thead th').getBoundingClientRect().top - $('.appbar').getBoundingClientRect().bottom) < 2`), await page(`[scrollY, $('.records thead th').getBoundingClientRect().top]`));
  await page(`(scrollTo(0, 0), 0)`);
  await type('.search input', 'SYN-NCR-001');
  await waitFor(`${rowCount} === 10`);
  await type('.search input', 'SYN-NCR-0019');
  await waitFor(`${rowCount} === 1`);
  await scrollModel('records with a one-row table');
  check('a page shorter than the window does not scroll at all', await page(`document.documentElement.scrollHeight === innerHeight`));
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);
  await inBothThemes('records');
  await viewport(390, 800);
  await scrollModel('records at 390x800');
  const narrow = await page(OVERFLOW);
  check('a 390px-wide screen has no clipped controls or sideways scrolling', !narrow.page && !narrow.main && narrow.clipped === 0 && await page(`$('.theme-toggle').getBoundingClientRect().right <= 390`), JSON.stringify(narrow));
  await screenshot('records-light-390x800');
  await viewport(1440, 900);

  // --- CSV import ---
  const exampleCsv = join(root, 'fixtures', 'ncr-import-example.csv');
  const chips = `$$('.chip').map((el) => el.textContent.trim())`;
  await click(`byText('.rail a', 'Import')`);
  await waitFor(`text('.import-view .page-head h1') === 'Import CSV'`);
  check('the Import view starts with only a file chooser', await page(`$('input[type=file]') !== null && $('.map-grid') === null`));
  await upload('input[type=file]', exampleCsv);
  await waitFor(`$('.chips') !== null`);
  check('every column of the example file is matched, and it has no unit column', await page(`$$('.map-row select').length === 13 && $$('.map-row select').filter((el) => el.value === '').map((el) => el.id).join() === 'map-quantityUnit'`));
  check('the unambiguous date and number formats are detected', await page(`$('.settings select').value === 'YMD' && $('#number-format').value === 'point'`));
  check('the preview shows how the numbers will be read', await page(`text('.readings').includes('"1250.00"') && text('.readings').includes('1250.00')`));
  check('the preview counts 11 to import, 4 errors, 2 repeats and 1 blank row',
    JSON.stringify(await page(chips)) === JSON.stringify(['11 will be imported', '4 with errors', '2 repeated in the file', '1 blank']), JSON.stringify(await page(chips)));
  check('each skipped row is listed with its row number and reason', await page(`$$('#skipped-title ~ .table-wrap tbody tr').length === 6 && text('#skipped-title ~ .table-wrap').includes('NCR ID is empty.') && text('#skipped-title ~ .table-wrap').includes('not a real calendar date')`));
  check('nothing is stored by previewing', (await (await fetch(base + '/api/ncrs')).json()).records.length === 24);
  for (const [width, height] of SIZES) {
    await viewport(width, height);
    await scrollModel(`import at ${width}x${height}`);
  }
  await viewport(1440, 900);
  await inBothThemes('import');

  // Leaving the Import view and switching theme must not lose the file being checked.
  await click(`byText('.rail a', 'Overview')`);
  await click(`$('.theme-toggle')`);
  await click(`byText('.rail a', 'Import')`);
  check('a file being checked survives a theme switch and a visit to another view', await page(`$('.chips') !== null && text('.file-name').includes('ncr-import-example.csv')`));
  await setTheme('light');

  await choose('#map-ncrNumber', 'Not in this file');
  await waitFor(`$('#step-check ~ .alert') !== null`);
  check('unmapping the NCR ID blocks the import with an explanation', await page(`text('#step-check ~ .alert').includes('NCR ID') && byText('.button-row .btn', 'Import').disabled`));
  await choose('#map-ncrNumber', 'NCR No');
  await waitFor(`$('#step-check ~ .alert') === null && !byText('.button-row .btn', 'Import').disabled`);

  await type('.currency-input', 'gbp');
  await waitFor(`$$('.hint').every((el) => !el.textContent.includes('will be stored as currency unspecified'))`);
  check('a chosen currency applies to costs that state none', await page(`$('.currency-input').value === 'GBP'`));
  await page(`(() => { const el = $('.currency-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`$$('.hint').some((el) => el.textContent.includes('will be stored as currency unspecified'))`);

  await click(`byText('.button-row .btn', 'Import 11 reports')`);
  await waitFor(`$('.import-done') !== null`);
  check('the result states what was imported and what was not', await page(`text('.import-done').includes('Imported 11 reports from ncr-import-example.csv') && text('.import-done').includes('6 rows were not imported')`));

  await click(`byText('.import-done a', 'View records')`);
  await waitFor(`text('.page-head h1') === 'Records' && ${rowCount} === 35`);
  check('the records list now holds 24 demo and 11 imported reports', (await page(countText)) === '35 reports' && await page(`text('.demo-notice').includes('24 of 35 reports are synthetic')`));
  await type('.search input', 'EX-NCR-0107');
  await waitFor(`${rowCount} === 1`);
  check('an imported report is not tagged as demo data', await page(`$('.records tbody .tag') === null`));
  check('a cost with no currency is shown with the unspecified mark, not a dollar sign', await page(`text('.records tbody td.col-cost').includes('210.00') && text('.records tbody td.col-cost').includes('currency unspecified') && !text('.records tbody td.col-cost').includes('$')`), await page(`text('.records tbody td.col-cost')`));
  await click(`$('.records tbody .row-open')`);
  await waitFor(`$('.detail') !== null`);
  const imported = await page(`text('.detail')`);
  check('the detail panel traces the report to its file and row', imported.includes('ncr-import-example.csv') && /Row in file\s*8/.test(imported) && imported.includes('Currency unspecified'), imported);
  await click(`$('.source-row summary')`);
  check('the original file row can be inspected', await page(`$('.source-row').open && text('.source-row').includes('Bath concentration low')`));
  await press('Escape');
  await waitFor(`$('.detail') === null`);
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  // --- Mixed currencies ---
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$$('.metric').length === 3`);
  const mixed = await page(`$$('.metric').map((m) => [m.querySelector('.metric-value')?.textContent.trim() ?? null, m.querySelector('.metric-coverage').textContent])`);
  // Demo data 20,152.50 plus the six USD rows of the example file, 2,382.75. The euro and unstated costs are not in it.
  check('recorded cost shows the USD total only: $22,535.25 in 26 of 35 reports', mixed[2][0] === '$22,535.25' && mixed[2][1] === 'USD cost recorded in 26 of 35 reports' && !(await page(`text('.metrics')`)).includes('€'), JSON.stringify(mixed));
  check('other currencies do not make the summary taller', (await page(`Math.round($('.metrics').getBoundingClientRect().height)`)) <= 100);
  check('report and quantity totals include the imported rows, whatever their currency', mixed[0][0] === '35' && mixed[1][0] === '2,618units' && mixed[1][1] === 'Quantity in 30 of 35 reports', JSON.stringify(mixed));
  await click(`$$('.metric .icon-btn')[2]`);
  check('the cost definition says how many costs are left out and that they are not converted', await page(`text('.metric:nth-child(3) .metric-help').includes('3 reports have a cost in another currency or with no currency stated') && text('.metric:nth-child(3) .metric-help').includes('not converted')`), await page(`text('.metric:nth-child(3) .metric-help')`));
  await click(`$$('.metric .icon-btn')[2]`);
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`text('#chart-title') === 'Recorded cost (USD) by category'`);
  check('the cost ranking has no currency selector', await page(`$$('.pareto-controls .seg').length === 1 && !text('.pareto-controls').includes('EUR')`));
  const usdBars = await page(`$$('.bar-count').map((el) => el.textContent)`);
  const usdCents = usdBars.reduce((sum, value) => sum + Math.round(Number(value.replace(/[$,]/g, '')) * 100), 0);
  check('the cost bars are all in dollars and add up to the summary figure, $22,535.25', usdBars.every((value) => value.startsWith('$')) && usdCents === 2253525, JSON.stringify(usdBars));
  check('the coverage line says what the ranking leaves out', await page(`text('#pareto-coverage').includes('USD cost recorded in 26 of 35 reports') && text('#pareto-coverage').includes('3 reports with a cost in another currency or with no currency stated are not ranked and not converted') && text('#pareto-coverage').includes('6 reports with no cost are not ranked') && text('#pareto-coverage').includes('None of these is treated as zero')`), await page(`text('#pareto-coverage')`));
  // Each bar against the records behind it, read from storage rather than from the screen.
  const stored = await (await fetch(base + '/api/ncrs')).json();
  const byCategory = new Map();
  for (const r of stored.records) if (r.costCents !== null && r.currency === 'USD') byCategory.set(r.defectCategory ?? 'Uncategorized', (byCategory.get(r.defectCategory ?? 'Uncategorized') ?? 0) + r.costCents);
  const shownBars = await page(`$$('.bar').map((b) => [b.querySelector('.bar-label').textContent, b.querySelector('.bar-count').textContent])`);
  check('every cost bar equals the sum of the USD costs on that category\'s stored reports', shownBars.length === byCategory.size && shownBars.every(([name, value]) => Math.round(Number(value.replace(/[$,]/g, '')) * 100) === byCategory.get(name)), JSON.stringify([shownBars, [...byCategory]]));
  const kept = Object.fromEntries(stored.records.filter((r) => ['EX-NCR-0105', 'EX-NCR-0106', 'EX-NCR-0107'].includes(r.ncrNumber)).map((r) => [r.ncrNumber, [r.costCents, r.currency, r.sourceValues.Cost, r.sourceValues.Currency]]).sort(([a], [b]) => a.localeCompare(b)));
  check('euro and unstated costs are intact in storage with their original cells', JSON.stringify(kept) === JSON.stringify({ 'EX-NCR-0105': [240000, 'EUR', '2400.00', 'EUR'], 'EX-NCR-0106': [118040, 'EUR', '1180.40', 'EUR'], 'EX-NCR-0107': [21000, null, '210.00', ''] }), JSON.stringify(kept));
  check('the stored totals still hold every currency separately', JSON.stringify(stored.totals.cost.groups) === JSON.stringify([{ currency: 'EUR', sumCents: 358040, recorded: 2 }, { currency: 'USD', sumCents: 2253525, recorded: 26 }, { currency: null, sumCents: 21000, recorded: 1 }]), JSON.stringify(stored.totals.cost.groups));
  await type('.search input', 'EX-NCR-0105');
  await waitFor(`${rowCount} === 1`);
  check('a euro cost is still shown in euros in the records list, and a search holding only euros ranks nothing', await page(`text('.records tbody td.col-cost').includes('€2,400.00') && text('.pareto-empty').includes('No USD costs recorded.') && text('#pareto-coverage').includes('1 report with a cost in another currency or with no currency stated is not ranked and not converted')`), await page(`text('.records tbody td.col-cost') + ' | ' + text('#pareto-coverage')`));
  await click(`$('.records tbody .row-open')`);
  await waitFor(`$('.detail') !== null`);
  check('the detail panel still shows the euro cost with its currency', await page(`text('.detail').includes('€2,400.00') && text('.detail').includes('EUR')`));
  await press('Escape');
  await waitFor(`$('.detail') === null`);
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await inBothThemes('mixed-currencies');
  await click(`byText('.seg button', 'NCR reports')`);

  // --- Importing the same file again ---
  await importFile(exampleCsv);
  check('the earlier import is listed with its counts', await page(`text('#previous-imports ~ .table-wrap').includes('ncr-import-example.csv')`));
  check('importing the same file again would add nothing', JSON.stringify(await page(chips)) === JSON.stringify(['0 will be imported', '4 with errors', '13 already stored', '1 blank']) && await page(`byText('.button-row .btn', 'Import').disabled`), JSON.stringify(await page(chips)));

  // --- An ambiguous number format must be chosen, never guessed ---
  const ambiguous = join(work, 'ambiguous-numbers.csv');
  writeFileSync(ambiguous, 'NCR No;Qty;Unit;Cost\nAMB-1;1,234;;1,500\nAMB-2;2,5;kg;\n');
  await upload('input[type=file]', ambiguous);
  await waitFor(`text('.file-name').includes('ambiguous-numbers.csv') && $('.chips') !== null`);
  // "2,5" proves the comma format for this file, so nothing is ambiguous yet.
  check('a value that can only be read one way settles the number format', await page(`$('#number-format').value === 'comma'`));
  // A new name, because choosing the same path twice does not count as a change.
  const undecided = join(work, 'undecided-numbers.csv');
  writeFileSync(undecided, 'NCR No;Qty;Cost\nAMB-1;1,234;1,500\n');
  await upload('input[type=file]', undecided);
  await waitFor(`$('#number-format').value === ''`);
  check('values like 1,234 leave the number format unchosen and block the import', await page(`text('#step-check ~ .alert').includes('Choose how numbers are written') && byText('.button-row .btn', 'Import').disabled`), await page(`$('#step-check ~ .alert')?.textContent`));
  check('the preview says the reading is not decided yet', await page(`$$('.readings .unread').length === 2 && text('.readings').includes('not decided yet')`));
  await page(`(scrollTo(0, $('.settings').getBoundingClientRect().top + scrollY - 64), 0)`);
  await screenshot('import-number-format-light-1440x900');
  await choose('#number-format', 'With a decimal point, as 1,234.56');
  await waitFor(`$$('.readings .read').length === 2`);
  check('choosing the point format reads 1,234 as 1234 and 1,500 as 1500.00', (await page(`$$('.readings .read').map((el) => el.textContent).join()`)) === '1234,1500.00' && await page(`!byText('.button-row .btn', 'Import').disabled`));
  await choose('#number-format', 'With a decimal comma, as 1.234,56');
  await waitFor(`$$('.readings .read')[0]?.textContent === '1.234'`);
  check('choosing the comma format reads 1,234 as 1.234, which a count of pieces cannot be', (await page(chips))[0] === '0 will be imported' && await page(`text('#skipped-title ~ .table-wrap').includes('Pieces are counted whole')`), JSON.stringify(await page(chips)));
  await type('.unit-input', 'kg');
  await waitFor(`$$('.chip')[0].textContent.trim() !== '0 will be imported' || text('#skipped-title ~ .table-wrap').includes('more than two decimal')`);
  check('with kg given as the unit the fractional quantity is accepted, and the cost is still refused unrounded', await page(`text('#skipped-title ~ .table-wrap').includes('more than two decimal places')`), await page(`text('#skipped-title ~ .table-wrap')`));

  // --- Persistence across a restart ---
  await stopServer();
  await startServer();
  await goto('#/records');
  await waitFor(`${rowCount} === 35`);
  check('all 35 reports are still there after restarting the server', (await page(countText)) === '35 reports');
  await type('.search input', 'EX-NCR-0105');
  await waitFor(`${rowCount} === 1`);
  await click(`$('.records tbody .row-open')`);
  await waitFor(`$('.detail') !== null`);
  check('an imported report keeps its values and source after a restart', await page(`text('.detail').includes('€2,400.00 (EUR)') && text('.detail').includes('ncr-import-example.csv') && text('.detail').includes('Grade B')`));
  await press('Escape');
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  // --- Remove demo data, then the import ---
  await click(`byText('.demo-notice .btn', 'Remove demo data')`);
  await waitFor(`${rowCount} === 11`);
  check('removing demo data leaves the 11 imported reports', (await page(countText)) === '11 reports' && await page(`$('.demo-notice') === null`));
  await click(`byText('.rail a', 'Import')`);
  await waitFor(`$('#previous-imports') !== null`);
  await page(`byText('td.actions .btn', 'Remove').focus()`);
  await press('Enter');
  await waitFor(`byText('td.actions .btn', 'Remove 11 reports') !== undefined`);
  check('removing an import asks for confirmation first', (await (await fetch(base + '/api/ncrs')).json()).records.length === 11);
  await click(`byText('td.actions .btn', 'Remove 11 reports')`);
  await waitFor(`$('#previous-imports') === null`);
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$('.empty') !== null`);
  check('removing the import returns to the empty state', await page(`$('.records') === null`));

  // --- Pareto against the hand-checkable file: the metric changes which category leads ---
  await importFile(join(root, 'fixtures', 'pareto-check.csv'), 10);
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$$('.bar').length === 4`);
  check('by NCR count: Labeling 4, Dimensional 3, Material 2, Uncategorized 1',
    JSON.stringify(await page(barValues)) === JSON.stringify([['Labeling', '4', '40.0%'], ['Dimensional', '3', '70.0%'], ['Material', '2', '90.0%'], ['Uncategorized', '1', '100.0%']]), JSON.stringify(await page(barValues)));
  await inBothThemes('pareto-count');

  await click(`byText('.seg button', 'Affected quantity')`);
  await waitFor(`text('#chart-title') === 'Affected quantity by category'`);
  check('by affected quantity: Dimensional 100, Material 80, Labeling 20',
    JSON.stringify(await page(barValues)) === JSON.stringify([['Dimensional', '100', '50.0%'], ['Material', '80', '90.0%'], ['Labeling', '20', '100.0%']]), JSON.stringify(await page(barValues)));
  check('pieces and kilograms are offered as separate rankings', JSON.stringify(await page(`[...$$('.seg')[1].querySelectorAll('button')].map((b) => b.textContent.trim())`)) === JSON.stringify(['Units · 8', 'kg · 1']));
  check('coverage for quantity: 9 of 10 recorded, 1 not ranked', await page(`text('#pareto-coverage').includes('Quantity recorded in 9 of 10 reports') && text('#pareto-coverage').includes('1 report with no quantity is not ranked')`), await page(`text('#pareto-coverage')`));
  await screenshot('pareto-quantity-light-1440x900');
  await click(`byText('.seg button', 'kg · 1')`);
  await waitFor(`$$('.bar').length === 1`);
  check('the kilogram ranking holds only the 2.5 kg report', JSON.stringify(await page(barValues)) === JSON.stringify([['Material', '2.5', '100.0%']]), JSON.stringify(await page(barValues)));

  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`text('#chart-title') === 'Recorded cost (USD) by category'`);
  check('by recorded cost in USD: Material $850, Labeling $100, Dimensional $50',
    JSON.stringify(await page(barValues)) === JSON.stringify([['Material', '$850.00', '85.0%'], ['Labeling', '$100.00', '95.0%'], ['Dimensional', '$50.00', '100.0%']]), JSON.stringify(await page(barValues)));
  check('coverage for cost: USD in 7 of 10, the euro report left out and not converted, 2 with no cost', await page(`text('#pareto-coverage').includes('USD cost recorded in 7 of 10 reports') && text('#pareto-coverage').includes('1 report with a cost in another currency or with no currency stated is not ranked and not converted') && text('#pareto-coverage').includes('2 reports with no cost are not ranked')`), await page(`text('#pareto-coverage')`));
  check('the summary agrees with the ranking: $1,000.00 in 7 of 10 reports', await page(`$$('.metric')[2].querySelector('.metric-value').textContent.trim() === '$1,000.00' && $$('.metric')[2].querySelector('.metric-coverage').textContent === 'USD cost recorded in 7 of 10 reports'`), await page(`text('.metrics')`));
  await click(`byText('.bar', 'Labeling')`);
  await waitFor(`${rowCount} === 4`);
  check('selecting Labeling lists its 4 reports and says 3 contribute a cost', (await page(countText)) === '4 of 10 reports' && await page(`text('.pareto-readout').includes('3 reports contribute') && text('.pareto-readout').includes('1 more in this category has no recorded cost in USD')`), await page(`text('.pareto-readout')`));
  check('the report with no cost is visibly not zero in the list', await page(`$$('.records tbody td.col-cost').filter((td) => td.textContent.includes('Not recorded')).length === 1`));
  await inBothThemes('pareto-cost');

  // The export must describe the same reports as the chart.
  await setTheme('light');
  await click(`byText('.pareto-controls .btn', 'Export CSV')`);
  const exported = join(downloads, 'valynce-pareto-cost-usd.csv');
  await until(() => existsSync(exported), 'the exported file');
  const csv = readFileSync(exported, 'utf8').trimEnd().split('\r\n');
  check('the exported file matches the chart row for row', csv.length === 4 && csv[1] === '1,Material,850.00,USD,85.00,85.00,1,Recorded cost,10,7,1' && csv[2] === '2,Labeling,100.00,USD,10.00,95.00,3,Recorded cost,10,7,1' && csv[3] === '3,Dimensional,50.00,USD,5.00,100.00,3,Recorded cost,10,7,1', csv.join(' | '));
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await choose('.toolbar select', 'Open');
  await waitFor(`${rowCount} === 4`);
  const openBars = await page(barValues);
  check('under a status filter the chart and table still describe the same reports', (await page(countText)) === '4 of 10 reports' && await page(`text('#pareto-coverage').includes('Showing 4 of 10 reports')`) && JSON.stringify(openBars) === JSON.stringify([['Dimensional', '$25.00', '100.0%']]), JSON.stringify(openBars));
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  const record = await page(`(() => { const row = byText('.records tbody tr', 'PC-009'); return [row.querySelector('.col-qty').textContent, row.querySelector('.col-cost').textContent]; })()`);
  check('a measured quantity keeps its unit and fraction in the table', record[0] === '2.5 kg' && record[1] === '€300.00', JSON.stringify(record));

  await stopServer();
  await startServer();
  await goto();
  await waitFor(`${rowCount} === 10`);
  check('the 10 reports and their units survive a restart', await page(`byText('.records tbody tr', 'PC-009').querySelector('.col-qty').textContent === '2.5 kg'`));

  // --- Optional AI summary ---
  const summaryButton = `byText('.summary .btn', 'Generate summary')`;
  const panel = `text('.summary')`;
  const provider = (location) => `$('input[name="ai-provider"][value="${location}"]')`;
  await waitFor(`$('.summary') !== null && !${panel}.includes('Checking')`);
  const firstPanel = await page(panel);
  check('the AI analysis section offers the two providers, named and described as specified', firstPanel.includes('AI analysis') && firstPanel.includes('Offline · Private') && firstPanel.includes('Analyze on this computer. NCR data stays on this device.') && firstPanel.includes('Qwen3 1.7B') && firstPanel.includes('Online · Frontier') && firstPanel.includes('Analyze with Claude. Selected NCR data is sent to Anthropic after confirmation.'), firstPanel);
  check('nothing is claimed about certified, guaranteed or validated output', !/certif|guarantee|validated|verified root-cause analysis/i.test(firstPanel), firstPanel);
  check('with nothing chosen yet the private option is selected, it is not installed, and no summary can be generated or is shown', await page(`${provider('offline')}.checked && ${panel}.includes('Not installed') && ${summaryButton}.disabled === true && $('.summary-result') === null`), firstPanel);
  check('the real offline download is stated before anything is fetched: 1.29 GB', firstPanel.includes('one-time download of 1.29 GB') && firstPanel.includes('downloaded until you confirm it'), firstPanel);
  await click(`byText('.summary .btn', 'Enable offline AI')`);
  await waitFor(`byText('.summary .btn', 'Download 1.29 GB') !== undefined`);
  const setupText = await page(panel);
  check('enabling offline AI first shows the model and runtime, their sizes and sources, and where they are kept', setupText.includes('Qwen3 1.7B model (1.28 GB, from huggingface.co/ggml-org/Qwen3-1.7B-GGUF)') && setupText.includes('llama.cpp runtime') && setupText.includes('from github.com/ggml-org/llama.cpp') && setupText.includes(aiDir), setupText);
  check('asking about the download creates no files and starts nothing', !existsSync(aiDir));
  await click(`byText('.summary .btn', 'Cancel')`);
  await waitFor(`byText('.summary .btn', 'Download 1.29 GB') === undefined`);

  await page(`(${provider('online')}.focus(), 0)`);
  await click(provider('online'));
  await waitFor(`${panel}.includes('No online AI provider is configured')`);
  check('without a key the online option says nothing can be sent and how to configure one, and cannot generate', await page(`${panel}.includes('ANTHROPIC_API_KEY') && ${panel}.includes('Not configured') && ${summaryButton}.disabled === true && byText('.summary .btn', 'Send and generate') === undefined`), await page(panel));
  check('choosing a provider is remembered in this browser and generates nothing', (await page(`localStorage.getItem('valynce.ai.provider')`)) === 'online' && (await page(`$('.summary-result') === null && $('.analyzing') === null`)));
  check('without a key the chart and the records list still work', (await page(barValues)).length === 4 && (await page(rowCount)) === 10);
  await inBothThemes('ai-providers', { sizes: [[1440, 900], [390, 800]] });

  await stopServer();
  await startServer(AI_ENV);
  await goto();
  await waitFor(`${rowCount} === 10`);
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`text('#chart-title') === 'Recorded cost (USD) by category'`);
  await sleep(400);
  check('loading the page, switching the metric and filtering send nothing to the provider', model.requests.length === 0, String(model.requests.length));
  await waitFor(`${summaryButton}.disabled === false`);
  check('after a restart the online option is still the selected one and shows the configured model', await page(`${provider('online')}.checked && ${panel}.includes('claude-sonnet-5-5') && !${panel}.includes('Not configured')`), await page(panel));
  await click(summaryButton);
  await waitFor(`${panel}.includes('Send this analysis to an AI provider?') && byText('.summary .btn', 'Send and generate') !== undefined`);
  const confirmText = await page(panel);
  check('the confirmation names the provider, the model and where the data goes', confirmText.includes('Anthropic') && confirmText.includes('claude-sonnet-5-5') && confirmText.includes(modelHost) && confirmText.includes('an external AI provider'), confirmText);
  check('the confirmation states the report count and the fields sent and withheld', confirmText.includes('10 reports') && confirmText.includes('NCR ID, opened date, defect category, description, status, disposition, reported cause, recorded cost when stated in USD') && /Not sent\s*supplier, part number, original file cells, file name and row number, affected quantity/.test(confirmText), confirmText);
  check('opening the confirmation moves keyboard focus to it and still sends nothing', await page(`document.activeElement.classList.contains('summary-block')`) && model.requests.length === 0);
  await inBothThemes('summary-confirm');
  await click(`byText('.summary .btn', 'Cancel')`);
  await waitFor(`byText('.summary .btn', 'Send and generate') === undefined`);
  check('cancelling sends nothing', model.requests.length === 0);

  await click(summaryButton);
  await waitFor(`byText('.summary .btn', 'Send and generate') !== undefined`);
  await click(`byText('.summary .btn', 'Send and generate')`);
  await waitFor(`$('.summary-result') !== null && $('.summary-block') === null`);
  check('confirming sends exactly one request, to the configured provider only', model.requests.length === 1 && model.requests[0].url === '/v1/messages', JSON.stringify(model.requests.map((r) => r.url)));
  const sent = model.requests[0]?.body ?? '';
  check('the request carries the report IDs and descriptions but no part numbers, file name or original cells', sent.includes('PC-008') && sent.includes('Wrong alloy delivered') && !sent.includes('PC-300') && !sent.includes('pareto-check.csv') && !sent.includes('Part No'), sent.slice(0, 300));
  check('the euro cost is not sent, converted or zeroed: the report is marked as left out', !sent.includes('300') && sent.includes('cost_in_another_or_no_currency'));
  const resultText = await page(panel);
  check('the summary is labelled an AI-generated draft with its model and time', resultText.includes('AI-generated draft · Review against source records') && resultText.includes('Online · Anthropic · claude-sonnet-5-5 · generated') && resultText.includes('10 reports sent'), resultText);
  check('the figures beside it are Valynce\'s own and match the chart: $1,000.00 from 7 of 10, Material $850.00 at 85.0%', resultText.includes('computed by Valynce') && resultText.includes('Total: $1,000.00 from 7 of 10 reports.') && resultText.includes('1. Material: $850.00, 85.0% of the total, from 1 report.'), resultText);
  check('facts and hypotheses are labelled differently', JSON.stringify(await page(`$$('.summary-findings .tag').map((t) => t.textContent)`)) === JSON.stringify(['From the reports', 'Hypothesis, not verified']));
  check('the summary says it is not a verified root cause', resultText.includes('Nothing here is a verified root cause'));
  check('a fresh summary is not marked outdated', await page(`$('.summary-outdated') === null`));
  check('the key never reaches the page', !(await page(`document.documentElement.outerHTML + JSON.stringify(Object.entries(localStorage))`)).includes(AI_ENV.ANTHROPIC_API_KEY));
  await page(`$('.summary').scrollIntoView()`);
  await inBothThemes('summary-result');
  await scrollModel('overview with a summary');

  await page(`(byText('button.cite', 'PC-008').focus(), 0)`);
  await press('Enter');
  await waitFor(`$('.detail') !== null`);
  check('a cited report ID opens that report, by keyboard', (await page(`text('#detail-title')`)) === 'PC-008' && (await page(`text('.detail')`)).includes('Wrong alloy delivered'), await page(`text('#detail-title')`));
  await press('Escape');
  await waitFor(`$('.detail') === null`);
  check('closing the report returns focus to the citation', await page(`document.activeElement.textContent === 'PC-008'`));

  await click(`byText('.seg button', 'NCR reports')`);
  await waitFor(`$('.summary-outdated') !== null`);
  check('changing the metric marks the summary outdated and does not regenerate it', (await page(`text('.summary-outdated')`)).startsWith('Outdated.') && model.requests.length === 1 && (await page(panel)).includes('Total: $1,000.00'), await page(`text('.summary-outdated')`));
  await screenshot('summary-outdated-light-1440x900');
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`$('.summary') !== null && $('.summary-outdated') === null`);
  await choose('.toolbar select', 'Open');
  await waitFor(`$('.summary-outdated') !== null`);
  check('changing the status filter marks it outdated', true);
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`$('.summary-outdated') === null`);
  check('returning to the original analysis clears the mark, still with one request in total', model.requests.length === 1);

  await stopServer();
  await startServer(AI_ENV);
  await goto();
  await waitFor(`$('.summary-result') !== null`);
  check('the summary survives a restart and is outdated against the default metric', await page(`${panel}.includes('wrong alloy delivery') && $('.summary-outdated') !== null`));
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`$('.summary-outdated') === null`);

  // A reply that breaks the rules: one repair, then a clear failure, and the earlier summary is kept.
  model.mode = 'bad';
  await click(`byText('.summary .btn', 'Generate summary again')`);
  await waitFor(`byText('.summary .btn', 'Send and generate') !== undefined`);
  await click(`byText('.summary .btn', 'Send and generate')`);
  await waitFor(`$('.summary-alert') !== null`);
  const failedText = await page(panel);
  check('an invalid reply gets one repair attempt and then a clear failure', model.requests.length === 3 && failedText.includes('Not generated.') && failedText.includes('Nothing was saved') && failedText.includes('PC-999') && failedText.includes('root cause'), failedText.slice(0, 500));
  check('the earlier valid summary is still shown after the failure', failedText.includes('wrong alloy delivery') && await page(`$('.summary-outdated') === null`));
  await inBothThemes('summary-failed', { sizes: [[1440, 900]] });

  // A provider that never answers: the app gives up after its limit and stays usable meanwhile.
  model.mode = 'slow';
  await click(`byText('.summary .btn', 'Review and try again')`);
  await waitFor(`byText('.summary .btn', 'Send and generate') !== undefined`);
  await click(`byText('.summary .btn', 'Send and generate')`);
  await waitFor(`${panel}.includes('Analyzing NCRs')`);
  check('while waiting, the button is disabled so a second request cannot be sent', await page(`${summaryButton}.disabled === true && byText('.summary .btn', 'Send and generate') === undefined && ${provider('offline')}.disabled === true`));
  const square = `getComputedStyle($('.analyzing-square i'))`;
  const box = await page(`(() => { const r = $('.analyzing-square').getBoundingClientRect(); return { w: r.width, h: r.height, hidden: $('.analyzing-square').getAttribute('aria-hidden'), dots: $$('.analyzing-square i').length, status: $('.analyzing [role="status"]').textContent.trim(), percent: /\\d+\\s*%/.test($('.analyzing').textContent), progress: $('.analyzing progress') }; })()`);
  check('while a summary is generated a small square with dots is shown beside "Analyzing NCRs…", hidden from screen readers, with the status in words', box.w >= 24 && box.w <= 32 && box.w === box.h && box.hidden === 'true' && box.dots === 4 && box.status === 'Analyzing NCRs…', JSON.stringify(box));
  check('the animation shows no percentage and no progress bar', box.percent === false && box.progress === null, JSON.stringify(box));
  const moving = await page(`${square}.animationName + ' ' + ${square}.animationDuration + ' ' + ${square}.backgroundColor`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await page(`${square}.animationName + ' ' + new Set($$('.analyzing-square i').map((i) => getComputedStyle(i).transform)).size`);
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  check('the dots are orange and move by CSS alone; with reduced motion they rest on the four corners', moving.startsWith('analyzing-orbit 2.4s rgb(255, 90, 31)') && still === 'none 4', `${moving} | ${still}`);
  await screenshot('summary-analyzing-light-1440x900');
  await click(`byText('.bar', 'Labeling')`);
  await waitFor(`${rowCount} === 4`);
  check('while waiting, the chart and the records list still respond', (await page(countText)) === '4 of 10 reports');
  await click(`byText('.bar', 'Labeling')`);
  await waitFor(`$('.summary-alert') !== null`, 8000);
  check('a provider that does not answer ends in a timeout message, with one request sent', (await page(`text('.summary-alert')`)).includes('did not answer in time') && model.requests.length === 4, await page(`text('.summary-alert')`));
  await click(`byText('.summary .btn', 'Close')`);

  await viewport(390, 800);
  await page(`$('.summary').scrollIntoView()`);
  await fits('summary at 390x800');
  await screenshot('summary-result-light-390x800');
  await viewport(1440, 900);

  await click(`byText('.summary .btn', 'Discard summary')`);
  await waitFor(`$('.summary-result') === null`);
  check('discarding removes the stored summary', (await (await fetch(`${base}/api/summary/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: { metric: 'cost', unit: null, search: '' } }) })).json()).latest === null);
  check('every request to the provider carried the key from the server environment, never from the page', model.requests.every((r) => r.key === AI_ENV.ANTHROPIC_API_KEY));


  // --- Offline AI: set-up, generation on this computer, and no swapping of providers ---
  // The real app, with a pretend model and runtime served from this machine. The online
  // stand-in stays configured throughout, so a silent fall-back to it would be seen.
  await stopServer();
  await startServer({ ...AI_ENV, ...OFFLINE_ENV }, OFFLINE_SERVER);
  await goto();
  await waitFor(`${rowCount} === 10`);
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`${summaryButton}.disabled === false`);
  const onlineBefore = model.requests.length;
  await click(provider('offline'));
  await waitFor(`${panel}.includes('Offline AI is not installed')`);
  check('selecting the offline option downloads nothing and generates nothing', downloadsSeen.length === 0 && !existsSync(aiDir) && (await page(`$('.analyzing') === null && $('.summary-result') === null && ${summaryButton}.disabled === true`)));
  check('the offline option is not replaced by the configured online one', model.requests.length === onlineBefore && (await page(`${provider('offline')}.checked`)));

  await click(`byText('.summary .btn', 'Enable offline AI')`);
  await waitFor(`byText('.summary .btn', 'Download 3 MB') !== undefined`);
  check('the size shown is the size of the files that will be fetched, and still nothing is fetched', (await page(panel)).includes('Check model model (3 MB, from downloads.test)') && downloadsSeen.length === 0, await page(panel));
  slowDownloads = true;
  await click(`byText('.summary .btn', 'Download 3 MB')`);
  await waitFor(`$('.download-progress') !== null && $('.download-progress').value > 0`);
  const progress = await page(`({ max: $('.download-progress').max, value: $('.download-progress').value, label: $('#offline-progress-label').textContent, square: $('.analyzing-square') })`);
  check('the download has its own progress bar, measured in bytes, not the analyzing animation', progress.max === fakeModel.length + fakeArchive.length && progress.value > 0 && progress.value < progress.max && /Downloading the (model|runtime): .* of 3 MB/.test(progress.label) && progress.square === null, JSON.stringify(progress));
  check('while downloading, a summary cannot be asked for and the analysis still works', (await page(`${summaryButton}.disabled === true`)) && (await page(barValues)).length === 3, JSON.stringify(await page(barValues)));
  await screenshot('offline-downloading-light-1440x900');
  await click(`byText('.summary .btn', 'Cancel download')`);
  await waitFor(`${panel}.includes('Offline AI is not installed')`);
  check('cancelling the download leaves nothing installed and no partial file', !existsSync(join(aiDir, 'installed.json')) && !existsSync(join(aiDir, 'model.gguf')) && !readdirSync(aiDir).some((name) => name.endsWith('.part')), existsSync(aiDir) ? readdirSync(aiDir).join(', ') : '');
  slowDownloads = false;
  await click(`byText('.summary .btn', 'Enable offline AI')`);
  await click(`byText('.summary .btn', 'Download 3 MB')`);
  await waitFor(`${panel}.includes('Offline AI is ready')`, 15000);
  check('after the download the offline option is ready and a summary can be asked for', await page(`${summaryButton}.disabled === false && ${panel}.includes('Ready') && ${panel}.includes('no internet connection and no API key')`), await page(panel));
  check('the verified files are in the offline AI folder, outside the project', existsSync(join(aiDir, 'installed.json')) && existsSync(join(aiDir, 'model.gguf')) && !aiDir.startsWith(root));
  const fetched = downloadsSeen.length;

  await click(summaryButton);
  await waitFor(`byText('.summary .btn', 'Generate on this computer') !== undefined`);
  const localConfirm = await page(`text('.summary-block')`);
  check('the offline confirmation states the scope and that processing is local', localConfirm.includes('runs on this computer') && localConfirm.includes('are not sent anywhere') && localConfirm.includes('10 reports (the offline limit is 40)') && localConfirm.includes('NCR ID, defect category, description'), localConfirm);
  check('the offline confirmation does not reuse the wording about sending data to a provider', !/This sends|external AI provider|Send and generate|Sent for each report|Anthropic/.test(localConfirm), localConfirm);
  check('the offline confirmation says the summary is the shorter one and who writes what', localConfirm.includes('an offline summary is shorter') && localConfirm.includes('Valynce writes the figures'), localConfirm);
  await inBothThemes('offline-confirm', { sizes: [[1440, 900], [390, 800]] });
  check('before confirming, the local model has not been started', !existsSync(join(aiDir, 'model.gguf.requests')));
  await click(`byText('.summary .btn', 'Generate on this computer')`);
  await waitFor(`$('.summary-result') !== null && $('.analyzing') === null`, 15000);
  const localResult = await page(panel);
  check('the offline summary names where it was made, the model, the time and the reports read', localResult.includes('AI-generated draft · Review against source records') && /Offline · check-model-q4 · on this computer · generated .* · 10 reports read/.test(localResult), localResult);
  check('its ranked finding is written by Valynce from the ranking: Material, $850.00, 85.00%, from 1 of its 2 reports', localResult.includes('Computed by Valynce') && localResult.includes('Material is ranked first by recorded cost (USD): $850.00, 85.00% of the total, from 1 of its 2 reports.') && localResult.includes('Total: $1,000.00 from 7 of 10 reports.'), localResult);
  check('it says it is the shorter offline summary, a draft that can be wrong', localResult.includes('This is the shorter offline summary') && localResult.includes('It can be wrong') && localResult.includes('Nothing here is a verified root cause'));
  const localRequests = readFileSync(join(aiDir, 'model.gguf.requests'), 'utf8').trim().split('\n');
  check('one request went to the local model, with descriptions and no costs, suppliers or part numbers', localRequests.length === 1 && localRequests[0].includes('Wrong alloy delivered') && !localRequests[0].includes('850') && !localRequests[0].includes('PC-300'), localRequests[0].slice(0, 300));
  check('generating offline contacted neither the online provider nor the download server', model.requests.length === onlineBefore && downloadsSeen.length === fetched, `${model.requests.length - onlineBefore} online, ${downloadsSeen.length - fetched} downloads`);
  await page(`$('.summary').scrollIntoView()`);
  await inBothThemes('offline-result', { sizes: [[1440, 900], [390, 800]] });
  await fits('offline summary');

  const firstCite = await page(`$('button.cite').textContent`);
  await page(`($('button.cite').focus(), 0)`);
  await press('Enter');
  await waitFor(`$('.detail') !== null`);
  check('a citation in an offline summary opens that report', (await page(`text('#detail-title')`)) === firstCite, firstCite);
  await press('Escape');
  await waitFor(`$('.detail') === null`);

  await click(provider('online'));
  await waitFor(`${provider('online')}.checked && ${summaryButton}.disabled === false`);
  check('selecting the other provider does not relabel the stored summary or regenerate it', (await page(panel)).includes('Offline · check-model-q4 · on this computer') && model.requests.length === onlineBefore && (await page(`$('.summary-outdated') === null`)));
  await click(`byText('.seg button', 'NCR reports')`);
  await waitFor(`$('.summary-outdated') !== null`);
  check('an offline summary is marked outdated when the metric changes', (await page(`text('.summary-outdated')`)).startsWith('Outdated.'));
  await click(`byText('.seg button', 'Recorded cost')`);
  await waitFor(`$('.summary-outdated') === null`);
  await click(provider('offline'));
  await waitFor(`${provider('offline')}.checked && ${summaryButton}.disabled === false`);

  // A local model that never answers: cancelling stops it without an error, and the app stays usable.
  writeFileSync(join(aiDir, 'model.gguf.slow'), '');
  await click(summaryButton);
  await waitFor(`byText('.summary .btn', 'Generate on this computer') !== undefined`);
  await click(`byText('.summary .btn', 'Generate on this computer')`);
  await waitFor(`$('.analyzing') !== null`);
  await click(`byText('.bar', 'Labeling')`);
  await waitFor(`${rowCount} === 4`);
  check('while the local model works, the chart and the records list still respond', (await page(countText)) === '4 of 10 reports');
  await click(`byText('.bar', 'Labeling')`);
  await click(`byText('.analyzing .btn', 'Cancel')`);
  await waitFor(`$('.analyzing') === null`);
  check('cancelling a generation stops the animation, shows no error and keeps the earlier summary', await page(`$('.summary-alert') === null && $('.summary-result') !== null && ${summaryButton}.disabled === false`));
  rmSync(join(aiDir, 'model.gguf.slow'));

  // The model file disappears behind Valynce's back: a clear failure, and no fall-back.
  rmSync(join(aiDir, 'model.gguf'));
  await sleep(1200);
  await click(summaryButton);
  await waitFor(`byText('.summary .btn', 'Generate on this computer') !== undefined`);
  await click(`byText('.summary .btn', 'Generate on this computer')`);
  await waitFor(`$('.summary-alert') !== null`);
  check('a missing model file is reported as such, with nothing downloaded and nothing sent online', (await page(`text('.summary-alert')`)).includes('missing or damaged') && downloadsSeen.length === fetched && model.requests.length === onlineBefore, await page(`text('.summary-alert')`));
  await click(`byText('.summary .btn', 'Close')`);
  await waitFor(`${panel}.includes('Offline AI was not set up') || ${panel}.includes('Offline AI is not installed')`);
  await inBothThemes('offline-failed', { sizes: [[1440, 900]] });
  await click(`byText('.summary .btn', 'Remove offline AI files')`);
  await waitFor(`${panel}.includes('Offline AI is not installed') && !${panel}.includes('was not set up')`);
  check('removing the offline AI files leaves the folder empty and keeps the stored summary', readdirSync(aiDir).filter((name) => !name.includes('.requests')).length === 0 && (await page(`$('.summary-result') !== null`)), readdirSync(aiDir).join(', '));
  await click(`byText('.summary .btn', 'Discard summary')`);
  await waitFor(`$('.summary-result') === null`);

  const outside = requested.filter((url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('about:') && !url.startsWith('blob:'));
  check('the page itself made no requests to anything but the local server, also while summaries were generated', outside.length === 0, outside.join(', '));
}

try {
  await run();
} catch (error) {
  failures += 1;
  console.log(`FAIL  stopped early: ${error.message}`);
  await screenshot('stopped-here').catch(() => {});
} finally {
  socket.close();
  chrome.kill();
  server?.kill('SIGKILL');
  modelServer.closeAllConnections();
  modelServer.close();
  downloadServer.closeAllConnections();
  downloadServer.close();
  await sleep(300);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\nScreenshots: ${shotsDir}`);
console.log(failures === 0 ? `All ${passed} browser checks passed.` : `${failures} browser check(s) failed, ${passed} passed.`);
process.exit(failures === 0 ? 0 : 1);
