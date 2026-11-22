// Minimal RCON client (Source RCON protocol, as used by Minecraft) plus the plugin's console commands.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { S, DATA, fail, log, sleep } from './lib.mjs';

export function rconPassword() {
  if (S.rconPassword) return S.rconPassword;
  const f = path.join(DATA, 'rcon.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(18).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
export const rconPort = () => Number(S.rconPort ?? 25575);

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

/** Runs commands over RCON; resolves with their responses. */
export function rcon(commands, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: rconPort() });
    const out = [];
    let buf = Buffer.alloc(0);
    let step = -1;
    const t = setTimeout(() => (sock.destroy(), reject(new Error('RCON timed out'))), timeoutMs);
    const next = () => {
      step++;
      if (step >= commands.length) {
        clearTimeout(t);
        sock.end();
        return resolve(out);
      }
      sock.write(packet(step + 2, 2, commands[step]));
    };
    sock.on('connect', () => sock.write(packet(1, 3, rconPassword())));
    sock.on('error', (e) => (clearTimeout(t), reject(e)));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0) + 4) {
        const len = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const body = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (step === -1) {
          if (id === -1) return clearTimeout(t), sock.destroy(), reject(new Error('RCON password rejected'));
          next();
        } else {
          out.push(body);
          next();
        }
      }
    });
  });
}

export async function waitForRcon(ms = 5 * 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await rcon(['list'], { timeoutMs: 3000 });
      return true;
    } catch {
      await sleep(5000);
    }
  }
  return false;
}

/** Makes Settings › Operators and Allowed Players true on the running server. */
export async function applyPlayers() {
  const cmds = [...(S.operators ?? []).map((p) => `op ${p}`)];
  if (S.whitelist) cmds.push(...(S.whitelistPlayers ?? []).map((p) => `whitelist add ${p}`), 'whitelist reload');
  if (!cmds.length) return;
  const res = await rcon(cmds);
  res.filter(Boolean).forEach((r) => log(r));
}

const cmd = process.argv[2];
const run = async (cmds) => {
  try {
    const res = await rcon(cmds);
    console.log(res.filter(Boolean).join('\n') || 'Done.');
  } catch (e) {
    fail(`The server isn’t accepting commands yet (${e.message}). It may still be starting.`);
  }
};
if (process.argv[1]?.endsWith('rcon.mjs')) {
  if (cmd === 'stop') {
    try {
      await rcon(['say Server is stopping…', 'stop'], { timeoutMs: 15_000 });
      await sleep(8000);
    } catch {}
  } else if (cmd === 'list') await run(['list']);
  else if (cmd === 'save') await run(['save-all flush']);
  else if (cmd === 'players') await applyPlayers().then(() => console.log('Applied operators and allowed players.'));
  else if (cmd === 'weather') await run(['weather clear']);
  else if (cmd === 'day') await run(['time set day']);
}
