// Backs up the world to Backups as a .tar.gz, pausing saves while it copies.
// tar ships with macOS, Linux and Windows 10+.
import fs from 'node:fs';
import path from 'node:path';
import { S, DATA, run, ensureDir, fail, log, stamp } from './lib.mjs';
import { rcon } from './rcon.mjs';

const serverDir = path.join(DATA, 'server');
const world = S.levelName || 'world';
if (!fs.existsSync(path.join(serverDir, world))) fail(`There’s no world called “${world}” yet. Start the server once first.`);
const backups = ensureDir(path.join(DATA, 'backups'));
const file = path.join(backups, `${world}-${stamp()}.tar.gz`);

let live = false;
try {
  await rcon(['save-off', 'save-all flush']);
  live = true;
  log('Saving paused while the backup is made.');
} catch {
  log('Server isn’t running; backing up the files as they are.');
}
const parts = [world, `${world}_nether`, `${world}_the_end`].filter((p) => fs.existsSync(path.join(serverDir, p)));
// Windows' own tar (bsdtar) rather than any GNU tar on PATH, which reads "C:" as a remote host.
// The archive path is relative to Backups for the same reason; session.lock is held by the running server.
const winTar = 'C:/Windows/System32/tar.exe';
const tar = process.platform === 'win32' && fs.existsSync(winTar) ? winTar : 'tar';
const r = await run(tar, ['--exclude', 'session.lock', '-czf', path.basename(file), '-C', serverDir, ...parts], { cwd: backups });
if (live) await rcon(['save-on']).catch(() => {});
if (r.code !== 0) fail('Backup failed.');

const keep = Math.max(1, Number(S.keepBackups ?? 10));
const all = fs.readdirSync(backups).filter((f) => f.startsWith(`${world}-`) && f.endsWith('.tar.gz')).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(backups, old));
log(`Backed up to ${path.basename(file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB). Keeping the newest ${keep}.`);
