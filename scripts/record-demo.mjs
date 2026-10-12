// Records a 20-second demo of the Pareto chart: the same ten reports ranked by
// NCR count, affected quantity and recorded cost, with a different category
// leading each time. Usage: npm run build && npm run demo:record
//
// It drives the built app in headless Chrome against a throwaway database
// loaded with the synthetic file fixtures/pareto-check.csv, captures frames,
// and encodes them with Chrome's own recorder, so no video tool is needed.
// The result goes to demo/out/, which is git-ignored.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'demo', 'out');
const work = mkdtempSync(join(tmpdir(), 'valynce-demo-'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const [WIDTH, HEIGHT, FPS, SECONDS] = [1280, 720, 10, 20];

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
if (!existsSync(join(root, 'dist/server/main.js'))) {
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

async function until(test, what, timeout = 10000) {
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

// ---------- the app, with only the hand-checkable synthetic reports ----------

const appPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
const server = spawn(process.execPath, ['dist/server/main.js'], {
  cwd: root,
  env: { ...process.env, VALYNCE_DATA_DIR: join(work, 'data'), VALYNCE_PORT: String(appPort), VALYNCE_DEV_ORIGIN: '' },
  stdio: 'ignore',
});
await until(async () => (await fetch(`${base}/api/ncrs`)).ok, 'the Valynce server');
const imported = await fetch(`${base}/api/import/commit`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fileName: 'pareto-check.csv', text: readFileSync(join(root, 'fixtures', 'pareto-check.csv'), 'utf8') }),
});
if (!imported.ok) throw new Error(`Could not load the demo reports: ${await imported.text()}`);

// ---------- Chrome ----------

const debugPort = await freePort();
const chrome = spawn(
  chromePath,
  ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(work, 'chrome')}`, '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'],
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
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
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
async function page(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression: `(async () => { const byText = (s, t) => [...document.querySelectorAll(s)].find((el) => el.textContent.trim().includes(t)); return (${expression}); })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error');
  return result.result.value;
}

// A pointer and a caption drawn over the page for the recording only. They are not part of the app.
const OVERLAY = `(() => {
  const style = document.createElement('style');
  style.textContent = \`
    #demo-pointer { position: fixed; z-index: 99; left: 640px; top: 420px; width: 18px; height: 18px; margin: -9px 0 0 -9px;
      border-radius: 50%; background: rgb(26 27 30 / 0.85); border: 2px solid #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
      transition: left 600ms cubic-bezier(0.2, 0, 0, 1), top 600ms cubic-bezier(0.2, 0, 0, 1), transform 120ms; pointer-events: none; }
    #demo-pointer.down { transform: scale(0.7); }
    /* The caption has its own strip under the app, so it never covers anything. */
    body { min-height: 0; padding-bottom: 56px; }
    .app { min-height: calc(100dvh - 56px); }
    .rail { height: calc(100dvh - var(--appbar-h) - 56px); }
    #demo-caption { position: fixed; z-index: 98; left: 0; right: 0; bottom: 0; height: 56px; display: grid; place-items: center;
      background: #1a1b1e; color: #fff; font: 500 17px/1.3 'Inter Variable', system-ui, sans-serif; }
  \`;
  const pointer = Object.assign(document.createElement('div'), { id: 'demo-pointer' });
  const caption = Object.assign(document.createElement('div'), { id: 'demo-caption' });
  document.body.append(style, pointer, caption);
})()`;

const caption = (text) => page(`(document.querySelector('#demo-caption').textContent = ${JSON.stringify(text)})`);
const pointTo = (finder) =>
  page(`(() => { const box = (${finder}).getBoundingClientRect(); const p = document.querySelector('#demo-pointer'); p.style.left = box.left + box.width / 2 + 'px'; p.style.top = box.top + box.height / 2 + 'px'; })()`);
async function press(finder) {
  await page(`document.querySelector('#demo-pointer').classList.add('down')`);
  await sleep(120);
  await page(`(${finder}).click()`);
  await page(`document.querySelector('#demo-pointer').classList.remove('down')`);
}

// What happens when, in seconds from the start.
const SCRIPT = [
  [0, () => caption('Ten reports ranked by NCR count: Labeling has the most, 4 of 10.')],
  [4.2, () => pointTo(`byText('.seg button', 'Affected quantity')`)],
  [5, () => press(`byText('.seg button', 'Affected quantity')`)],
  [5.2, () => caption('The same reports by affected quantity: Dimensional leads with 100 of 200 units.')],
  [9.7, () => pointTo(`byText('.seg button', 'Recorded cost')`)],
  [10.5, () => press(`byText('.seg button', 'Recorded cost')`)],
  [10.7, () => caption('By recorded cost: Material leads with $850 of $1,000.')],
  [14.6, () => pointTo(`byText('.bar', 'Material')`)],
  [15.4, () => press(`byText('.bar', 'Material')`)],
  [15.6, () => caption('Selecting a category lists its reports. The ranking shows where, not why.')],
  [16.6, () => page(`(() => { const head = document.querySelector('.pareto-colhead'); window.scrollTo({ top: window.scrollY + head.getBoundingClientRect().top - 60, behavior: 'smooth' }); })()`)],
];

let failed = null;
try {
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}/#/overview` });
  await until(() => page(`document.querySelectorAll('.bar').length === 4`), 'the Pareto chart');
  await page(OVERLAY);
  await sleep(500);

  // ---------- capture ----------
  const frames = [];
  const steps = [...SCRIPT];
  const started = Date.now();
  for (let index = 0; index < SECONDS * FPS; index += 1) {
    const due = started + (index * 1000) / FPS;
    while (steps.length > 0 && started + steps[0][0] * 1000 <= Date.now()) await steps.shift()[1]();
    if (Date.now() < due) await sleep(due - Date.now());
    const { data } = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    frames.push(data);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'valynce-pareto-demo-poster.jpg'), Buffer.from(frames.at(-1), 'base64'));

  // ---------- encode, by replaying the frames onto a canvas that Chrome records ----------
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await page(`(window.frames_ = [], 0)`);
  for (const data of frames) await page(`(window.frames_.push(${JSON.stringify(data)}), 0)`);
  const video = await page(`(async () => {
    const images = await Promise.all(window.frames_.map((data) => createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }))));
    const canvas = Object.assign(document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} });
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    context.drawImage(images[0], 0, 0);
    const type = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const stream = canvas.captureStream(${FPS});
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((done) => (recorder.onstop = done));
    recorder.start();
    const begin = performance.now();
    for (let i = 0; i < images.length; i += 1) {
      const wait = begin + (i * 1000) / ${FPS} - performance.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      context.drawImage(images[i], 0, 0);
    }
    await new Promise((done) => setTimeout(done, ${1000 / FPS}));
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type, base64: btoa(binary) };
  })()`);

  const file = join(outDir, `valynce-pareto-demo.${video.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
  writeFileSync(file, Buffer.from(video.base64, 'base64'));
  console.log(`Recorded ${frames.length} frames (${SECONDS} s at ${FPS} fps, ${WIDTH}x${HEIGHT}) as ${video.type}`);
  console.log(file);
} catch (error) {
  failed = error;
} finally {
  socket.close();
  chrome.kill();
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
if (failed) {
  console.error(`Recording failed: ${failed.message}`);
  process.exit(1);
}
