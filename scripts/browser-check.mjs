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

async function upload(selector, path) {
  const { root: doc } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.nodeId, selector });
  await cdp('DOM.setFileInputFiles', { nodeId, files: [path] });
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
  check('the empty state offers "Load demo data" and a link to CSV import', await page(`byText('.empty .btn', 'Load demo data') !== undefined && byText('.empty a.btn', 'Import a CSV file')?.getAttribute('href') === '#/import'`));
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
  const squeezed = `$$('thead th').filter((th) => th.offsetWidth > 0).map((th) => Math.round(th.getBoundingClientRect().width))`;
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await viewport(width, height);
    const widths = await page(squeezed);
    check(`with the panel open at ${width}x${height}, no table column is squeezed unreadable`, widths.every((w) => w >= 72) && await page(`$('thead th.col-category').offsetWidth > 0`), JSON.stringify(widths));
    await screenshot(`detail-${width}x${height}`);
  }
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
  await page(`$('.main').scrollTo(0, 400)`);
  await sleep(100);
  check('the table header stays in view while the list scrolls', await page(`Math.abs($('thead th').getBoundingClientRect().top - $('.main').getBoundingClientRect().top) < 2`));
  await page(`$('.main').scrollTo(0, 0)`);
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

  // --- CSV import ---
  const exampleCsv = join(root, 'fixtures', 'ncr-import-example.csv');
  const chips = `$$('.chip').map((el) => el.textContent.trim())`;
  await click(`byText('.rail a', 'Import')`);
  await waitFor(`text('.page-head h1') === 'Import CSV'`);
  check('the Import view starts with only a file chooser', await page(`$('input[type=file]') !== null && $('.map-grid') === null`));
  await upload('input[type=file]', exampleCsv);
  await waitFor(`$('.chips') !== null`);
  check('every column of the example file is matched to a field', await page(`$$('.map-row select').length === 12 && $$('.map-row select').every((el) => el.value !== '')`));
  check('the unambiguous ISO date format is detected', await page(`$('.settings select').value === 'YMD'`));
  check('the preview counts 11 to import, 4 errors, 2 repeats and 1 blank row',
    JSON.stringify(await page(chips)) === JSON.stringify(['11 will be imported', '4 with errors', '2 repeated in the file', '1 blank']), JSON.stringify(await page(chips)));
  check('each skipped row is listed with its row number and reason', await page(`$$('#skipped-title ~ .table-wrap tbody tr').length === 6 && text('#skipped-title ~ .table-wrap').includes('NCR ID is empty.') && text('#skipped-title ~ .table-wrap').includes('not a real calendar date')`));
  check('nothing is stored by previewing', (await (await fetch(base + '/api/ncrs')).json()).records.length === 24);
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await viewport(width, height);
    const overflow = await page(OVERFLOW);
    check(`Import view fits at ${width}x${height}`, !overflow.page && !overflow.main && overflow.clipped === 0, JSON.stringify(overflow));
    await screenshot(`import-${width}x${height}`);
  }
  await viewport(1440, 900);
  const weakImport = await page(CONTRAST.replace("const selectors = [", "const selectors = ['.hint', '.chip', '.map-row label', '.map-example', '.settings label span', '.table-plain td', '.file-name', "));
  check('Import view text contrast is at least 4.5:1', weakImport.length === 0, weakImport.join(', '));

  await choose('#map-ncrNumber', 'Not in this file');
  await waitFor(`$('#step-check ~ .alert') !== null`);
  check('unmapping the NCR ID blocks the import with an explanation', await page(`text('#step-check ~ .alert').includes('NCR ID') && byText('.button-row .btn', 'Import').disabled`));
  await choose('#map-ncrNumber', 'NCR No');
  await waitFor(`$('#step-check ~ .alert') === null && !byText('.button-row .btn', 'Import').disabled`);

  await type('.currency-input', 'gbp');
  await waitFor(`$$('.hint').every((el) => !el.textContent.includes('will be stored as currency unspecified'))`);
  check('a chosen currency applies to costs that state none', await page(`$('.currency-input').value === 'GBP'`));
  await type('.currency-input', '');
  await page(`(() => { const el = $('.currency-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`$$('.hint').some((el) => el.textContent.includes('will be stored as currency unspecified'))`);

  await click(`byText('.button-row .btn', 'Import 11 reports')`);
  await waitFor(`$('.import-done') !== null`);
  check('the result states what was imported and what was not', await page(`text('.import-done').includes('Imported 11 reports from ncr-import-example.csv') && text('.import-done').includes('6 rows were not imported')`));
  await screenshot('import-done-1440x900');

  await click(`byText('.import-done a', 'View records')`);
  await waitFor(`text('.page-head h1') === 'Records' && ${rowCount} === 35`);
  check('the records list now holds 24 demo and 11 imported reports', (await page(countText)) === '35 reports' && await page(`text('.demo-notice').includes('24 of 35 reports are synthetic')`));
  await type('.search input', 'EX-NCR-0107');
  await waitFor(`${rowCount} === 1`);
  check('an imported report is not tagged as demo data', await page(`$('tbody .tag') === null`));
  check('a cost with no currency is shown with the unspecified mark, not a dollar sign', await page(`text('tbody td.col-cost').includes('210.00') && text('tbody td.col-cost').includes('currency unspecified') && !text('tbody td.col-cost').includes('$')`), await page(`text('tbody td.col-cost')`));
  await click(`$('tbody .row-open')`);
  await waitFor(`$('.detail') !== null`);
  const imported = await page(`text('.detail')`);
  check('the detail panel traces the report to its file and row', imported.includes('ncr-import-example.csv') && /Row in file\s*8/.test(imported) && imported.includes('Currency unspecified'), imported);
  await click(`$('.source-row summary')`);
  check('the original file row can be inspected', await page(`$('.source-row').open && text('.source-row').includes('Bath concentration low')`));
  await screenshot('detail-imported-1440x900');
  await press('Escape');
  await waitFor(`$('.detail') === null`);
  await click(`byText('.toolbar .btn', 'Clear filters')`);

  // --- Mixed currencies on the overview ---
  await click(`byText('.rail a', 'Overview')`);
  await waitFor(`$$('.metric').length === 3`);
  const costs = await page(`$$('.metric-costs li').map((li) => li.textContent.replace(/\\s+/g, ' ').trim())`);
  check('recorded cost shows one total per currency and never a combined sum',
    costs.length === 3 && costs[0].startsWith('€3,580.40') && costs[1].startsWith('$22,535.25') && costs[2].startsWith('210.00') && costs[2].includes('Currency unspecified'), JSON.stringify(costs));
  const mixed = await page(`$$('.metric').map((m) => [m.querySelector('.metric-value')?.textContent.trim() ?? null, m.querySelector('.metric-coverage').textContent])`);
  check('report and unit totals include the imported rows', mixed[0][0] === '35' && mixed[1][0] === '2,618' && mixed[1][1] === 'Quantity recorded in 30 of 35 reports.' && mixed[2][1].startsWith('Cost recorded in 29 of 35 reports.'), JSON.stringify(mixed));
  check('chart bars add up to all 35 reports', (await page(barSum)) === 35);
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await viewport(width, height);
    const overflow = await page(OVERFLOW);
    check(`overview with three currencies fits at ${width}x${height}`, !overflow.page && !overflow.main && overflow.clipped === 0, JSON.stringify(overflow));
    await screenshot(`overview-mixed-${width}x${height}`);
  }
  await viewport(1440, 900);

  // --- Importing the same file again ---
  await click(`byText('.rail a', 'Import')`);
  await waitFor(`text('.page-head h1') === 'Import CSV'`);
  check('the earlier import is listed with its counts', await page(`text('#previous-imports ~ .table-wrap').includes('ncr-import-example.csv')`));
  await upload('input[type=file]', exampleCsv);
  await waitFor(`$('.chips') !== null`);
  check('importing the same file again would add nothing', JSON.stringify(await page(chips)) === JSON.stringify(['0 will be imported', '4 with errors', '13 already stored', '1 blank']) && await page(`byText('.button-row .btn', 'Import').disabled`), JSON.stringify(await page(chips)));

  // --- Persistence across a restart ---
  await stopServer();
  await startServer();
  await goto('#/records');
  await waitFor(`${rowCount} === 35`);
  check('all 35 reports are still there after restarting the server', (await page(countText)) === '35 reports');
  await type('.search input', 'EX-NCR-0105');
  await waitFor(`${rowCount} === 1`);
  await click(`$('tbody .row-open')`);
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
  check('removing the import returns to the empty state', await page(`$('table') === null`));
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
