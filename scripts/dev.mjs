// Runs the backend (with reload) and the Vite dev server together.
// Development data goes to ./data so it never touches your real Valynce data.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const env = {
  ...process.env,
  VALYNCE_DATA_DIR: process.env.VALYNCE_DATA_DIR || resolve(root, 'data'),
  // Must match the dev server address in vite.config.ts.
  VALYNCE_DEV_ORIGIN: 'http://127.0.0.1:5310',
};

const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'src/server/main.ts'], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, env, stdio: 'inherit' }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
