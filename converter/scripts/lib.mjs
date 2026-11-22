// Shared helpers for EasyServer plugin scripts. Each plugin ships its own copy (scripts/lib.mjs),
// so plugins stay self-contained. Runs on EasyServer's built-in runtime ("@node"): Node 20+ or Bun.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const S = JSON.parse(process.env.ES_SETTINGS || '{}');
export const BIN = JSON.parse(process.env.ES_BIN || '{}');
export const FILES = JSON.parse(process.env.ES_FILES || '{}');
export const DATA = process.env.ES_DATA_DIR || process.cwd();
export const RUNTIME = process.env.ES_RUNTIME_DIR || process.cwd();
export const PLUGIN = process.env.ES_PLUGIN_DIR || process.cwd();
export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

export const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Runs a command to completion. Resolves { code, out }; output also streams to ours unless stream:false. */
export function run(cmd, args = [], { stream = true, cwd, env, input, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: 127, out: String(e.message) });
    }
    const on = (d) => {
      const s = d.toString();
      out += s;
      if (out.length > 2e6) out = out.slice(-1e6);
      if (stream) process.stdout.write(s);
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    if (input != null) child.stdin.end(input);
    const t = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: 127, out: out + e.message });
    });
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out });
    });
  });
}

/** Starts a long-running child sharing our output, forwards stop signals, and exits when it does. */
export function supervise(cmd, args, { env, cwd, stdin = false, onStop } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: [stdin ? 'pipe' : 'ignore', 'inherit', 'inherit'], windowsHide: true });
  const stop = (sig) => (onStop ? onStop(child, sig) : child.kill(sig));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 0 : 1)));
  child.on('error', (e) => fail(`Couldn't start ${cmd}: ${e.message}`));
  return child;
}

/** Downloads a URL to a file atomically (optionally checking SHA-1) and marks it executable. */
export async function download(url, dest, { sha1, executable = true } = {}) {
  ensureDir(path.dirname(dest));
  log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`Download failed (HTTP ${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) fail('Download is corrupted (checksum mismatch).');
  fs.writeFileSync(dest + '.part', buf);
  fs.renameSync(dest + '.part', dest);
  if (executable && !isWin) fs.chmodSync(dest, 0o755);
  log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to ${dest}`);
}

/** Makes sure the Docker engine answers, starting Docker Desktop or the docker service if needed. */
export async function ensureDocker(docker) {
  const ok = async () => (await run(docker, ['info'], { stream: false, timeoutMs: 20_000 })).code === 0;
  if (await ok()) return;
  log('Docker isn’t running. Starting it…');
  try {
    if (isMac) await run('open', ['-a', 'Docker'], { stream: false });
    else if (isWin) {
      const exe = 'C:/Program Files/Docker/Docker/Docker Desktop.exe';
      if (fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else await run('sudo', ['-n', 'systemctl', 'start', 'docker'], { stream: false });
  } catch {}
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    if (await ok()) return log('Docker is ready.');
  }
  fail('Docker didn’t start. Open Docker Desktop (or run: sudo systemctl start docker), then start this plugin again.');
}

export function listFiles(dir, { recursive = true } = {}) {
  const out = [];
  const walk = (d) => {
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) recursive && walk(full);
      else if (e.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out;
}

export const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

/** Command + args to run another script of this plugin with the same runtime (Node, Electron or the EasyServer CLI). */
export function selfCommand(script, ...args) {
  const exe = process.execPath;
  const compiledBun = process.versions.bun && !/^bun(\.exe)?$/i.test(path.basename(exe));
  return [exe, [...(compiledBun ? ['__run-script'] : []), script, ...args]];
}
