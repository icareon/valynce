// Drives the built app in headless Chrome and checks what a person would see and do.
// Usage: npm run build && npm run check:browser [-- <screenshot folder>]
// It starts its own server on a spare port with a throwaway database, so it
// never touches real Valynce data. Chrome is found at CHROME_PATH or the usual places.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

async function startServer() {
  server = spawn(process.execPath, ['dist/server/main.js'], {
    cwd: root,
    env: { ...process.env, VALYNCE_DATA_DIR: dataDir, VALYNCE_PORT: String(appPort), VALYNCE_DEV_ORIGIN: '' },
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
  await waitFor(`document.readyState === 'complete' && ($('.empty') || $('.page-head')) !== null`);
}

// ---------- checks ----------

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
}

const OVERFLOW = `(() => {
  const wide = (el) => el && el.scrollWidth > el.clientWidth + 1;
  return {
    page: document.documentElement.scrollWidth > window.innerWidth + 1,
    main: wide($('.main')),
    table: wide($('.table-wrap')),
    clipped: $$('.btn, .field, .bar, .rail a, .local').filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
    }).length,
  };
})()`;

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
    return 'rgb(8, 9, 11)';
  };
  const selectors = ['.metric-label', '.metric-coverage', '.metric-value', '.chart-sub', '.bar-label', '.bar-count',
    'thead th', 'tbody td', '.row-open', '.toolbar-count', '.page-head p', '.crumbs span', '.local', '.rail a',
    '.demo-notice span', '.demo-notice strong', '.tag', '.unknown', '.badge', '.btn', '.field'];
  const weak = [];
  for (const selector of selectors) {
    const el = $(selector);
    if (!el) continue;
    const a = luminance(getComputedStyle(el).color);
    const b = luminance(solidBackground(el));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5) weak.push(selector + ' ' + ratio.toFixed(2));
  }
  return weak;
})()`;

const rowCount = `$$('tbody tr').length`;
const countText = `text('.toolbar-count')`;
const barSum = `$$('.bar-count').reduce((sum, el) => sum + parseInt(el.textContent, 10), 0)`;

async function run() {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await viewport(1440, 900);

  // --- A new database starts empty ---
  await startServer();
  await goto();
  check('a new database opens empty, with a one-sentence explanation', await page(`$('.empty') !== null && $('table') === null`));
  check('the empty state offers "Load demo data"', await page(`byText('.empty .btn', 'Load demo data') !== undefined`));
  await screenshot('empty-1440x900');

  // --- Load demo data ---
  await click(`byText('.empty .btn', 'Load demo data')`);
  await waitFor(`$$('.metric').length === 3 && ${rowCount} === 24`);
  const metrics = await page(`$$('.metric').map((m) => [m.querySelector('.metric-label').textContent, m.querySelector('.metric-value')?.textContent.trim(), m.querySelector('.metric-coverage').textContent])`);
  check('metric cards show 24 reports, 1,722 units and $20,152.50', JSON.stringify(metrics.map((m) => m[1])) === JSON.stringify(['24', '1,722', '$20,152.50']), JSON.stringify(metrics));
  check('coverage labels state how many reports had a value',
    metrics[0][2] === 'Category recorded in 22 of 24 reports.' &&
    metrics[1][2] === 'Quantity recorded in 21 of 24 reports.' &&
    metrics[2][2] === 'Cost recorded in 20 of 24 reports.', JSON.stringify(metrics.map((m) => m[2])));
  check('the chart is titled "NCR reports by category"', (await page(`text('#chart-title')`)) === 'NCR reports by category');
  check('chart bars add up to the 24 stored reports', (await page(barSum)) === 24);
  check('the chart has an Uncategorized bucket of 2', await page(`byText('.bar', 'Uncategorized')?.querySelector('.bar-count').textContent.startsWith('2')`));
  check('demo data is flagged with a notice and per-row tags', await page(`text('.demo-notice').includes('Demo data') && $$('tbody .tag').length === 24`));
  check('no upload or import control is shown before import exists, or it works', await page(`$$('input[type=file]').every((el) => !el.disabled)`));

  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await viewport(width, height);
    const overflow = await page(OVERFLOW);
    check(`no horizontal overflow or clipped controls at ${width}x${height}`, !overflow.page && !overflow.main && !overflow.table && overflow.clipped === 0, JSON.stringify(overflow));
    check(`all eight table columns are visible at ${width}x${height}`, (await page(`$$('thead th').filter((th) => th.getBoundingClientRect().width > 40).length`)) === 8);
    await screenshot(`overview-${width}x${height}`);
  }
  const weak = await page(CONTRAST);
  check('text contrast is at least 4.5:1', weak.length === 0, weak.join(', '));

  // --- Help text ---
  await viewport(1440, 900);
  await click(`$$('.metric .icon-btn')[2]`);
  check('metric definitions open from the help button', await page(`!$$('.metric-help')[2].hidden && $$('.metric .icon-btn')[2].getAttribute('aria-expanded') === 'true'`));
  await click(`$$('.metric .icon-btn')[2]`);

  // --- Category filter from the chart ---
  await click(`byText('.bar', 'Dimensional')`);
  await waitFor(`${rowCount} === 8`);
  check('clicking the Dimensional bar shows its 8 reports', (await page(countText)) === '8 of 24 reports' && await page(`$$('tbody td.col-category').every((td) => td.textContent === 'Dimensional')`));
  check('the selected bar is marked as pressed', await page(`byText('.bar', 'Dimensional').getAttribute('aria-pressed') === 'true'`));
  await screenshot('overview-filtered-1440x900');
  await click(`byText('.bar', 'Uncategorized')`);
  await waitFor(`${rowCount} === 2`);
  check('the Uncategorized bar shows the 2 reports with no category', await page(`$$('tbody td.col-category').every((td) => td.textContent.includes('Not recorded'))`));
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);

  // --- Search and status filters ---
  await type('.search input', 'tool wear');
  await waitFor(`${rowCount} === 3`);
  check('search finds the 3 reports whose cause is "Tool wear"', (await page(countText)) === '3 of 24 reports');
  check('the chart follows the search and still adds up', (await page(barSum)) === 3);
  await click(`byText('.toolbar .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);
  await choose('.toolbar select', 'Open');
  await waitFor(`${rowCount} === 6`);
  check('the status filter shows the 6 open reports', (await page(countText)) === '6 of 24 reports' && (await page(barSum)) === 6);
  await type('.search input', 'zzzz');
  await waitFor(`$('.no-rows') !== null`);
  check('filters that match nothing say so and offer to clear', await page(`text('.no-rows').includes('No reports match')`));
  await click(`byText('.no-rows .btn', 'Clear filters')`);
  await waitFor(`${rowCount} === 24`);

  // --- Detail panel by keyboard ---
  await page(`$('tbody .row-open').focus()`);
  await press('Enter');
  await waitFor(`$('.detail') !== null`);
  check('Enter on a row opens its detail panel and moves focus into it', await page(`$('.detail').contains(document.activeElement) && text('#detail-title') === $('tbody tr.is-selected .row-open').textContent`));
  const detail = await page(`text('.detail')`);
  check('the detail panel shows description, disposition and reported cause', ['Description', 'Disposition', 'Reported cause'].every((label) => detail.includes(label)));
  check('reported cause is marked as not a verified root cause', detail.includes('no verified root cause'));
  check('the detail panel identifies demo data', await page(`$('.detail .tag') !== null && text('.detail').includes('Synthetic demo data')`));
  await screenshot('detail-1440x900');
  await viewport(1280, 800);
  await screenshot('detail-1280x800');
  await viewport(1440, 900);
  await press('Escape');
  await waitFor(`$('.detail') === null`);
  check('Escape closes the panel and returns focus to the row', await page(`document.activeElement === $('tbody .row-open')`));

  // --- Unknown is not zero ---
  await type('.search input', 'SYN-NCR-0019');
  await waitFor(`${rowCount} === 1`);
  const zeroRow = await page(`[text('tbody td.col-qty'), text('tbody td.col-cost')]`);
  check('a missing quantity and a recorded zero cost look different', zeroRow[0].includes('Not recorded') && zeroRow[1] === '$0.00', JSON.stringify(zeroRow));
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  // --- Records view ---
  await click(`byText('.rail a', 'Records')`);
  await waitFor(`text('.page-head h1') === 'Records'`);
  check('the Records view lists all 24 reports without the chart', (await page(rowCount)) === 24 && await page(`$('.chart') === null`));
  check('the table header is sticky', await page(`getComputedStyle($('thead th')).position === 'sticky'`));
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await viewport(width, height);
    const overflow = await page(OVERFLOW);
    check(`Records view fits at ${width}x${height}`, !overflow.page && !overflow.main && !overflow.table && overflow.clipped === 0, JSON.stringify(overflow));
    await screenshot(`records-${width}x${height}`);
  }
  await viewport(390, 800);
  const narrow = await page(OVERFLOW);
  check('a 390px-wide screen has no clipped controls or sideways scrolling', !narrow.page && !narrow.main && narrow.clipped === 0, JSON.stringify(narrow));
  await screenshot('records-390x800');
  await viewport(1440, 900);

  // --- Persistence across a restart ---
  await stopServer();
  await startServer();
  await goto('#/overview');
  await waitFor(`${rowCount} === 24`);
  check('the 24 reports are still there after restarting the server', (await page(`text('.metric-value')`)) === '24');

  // --- Remove demo data ---
  await click(`byText('.demo-notice .btn', 'Remove demo data')`);
  await waitFor(`$('.empty') !== null`);
  check('removing demo data returns to the empty state', await page(`$('table') === null`));
  await stopServer();
  await startServer();
  await goto();
  check('the database is still empty after another restart', await page(`$('.empty') !== null`));

  const outside = requested.filter((url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('about:'));
  check('the page made no requests to anything but the local server', outside.length === 0, outside.join(', '));
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
  await sleep(300);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}

console.log(`\nScreenshots: ${shotsDir}`);
console.log(failures === 0 ? 'All browser checks passed.' : `${failures} browser check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
