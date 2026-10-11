import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where Valynce keeps its database. This is a per-user data folder, never the
 * package folder or the npm cache, so updating or reinstalling keeps the records.
 * Set VALYNCE_DATA_DIR to use a different folder.
 */
export function resolveDataDir(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (env.VALYNCE_DATA_DIR) return resolve(env.VALYNCE_DATA_DIR);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Valynce');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Valynce');
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'valynce');
}
