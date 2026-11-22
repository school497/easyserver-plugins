// Downloads the official Minecraft: Java Edition server from Mojang's version manifest,
// verifying its SHA-1. Writes server/server.jar and server/version.txt.
import fs from 'node:fs';
import path from 'node:path';
import { S, DATA, download, ensureDir, fail, log } from './lib.mjs';

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const serverDir = ensureDir(path.join(DATA, 'server'));
export const installedVersion = () => {
  try {
    return fs.readFileSync(path.join(serverDir, 'version.txt'), 'utf8').trim();
  } catch {
    return null;
  }
};

export async function resolveVersion(wanted = S.version || 'latest') {
  const m = await (await fetch(MANIFEST)).json();
  const id = wanted === 'latest' ? m.latest.release : wanted === 'snapshot' ? m.latest.snapshot : wanted;
  const v = m.versions.find((x) => x.id === id);
  if (!v) fail(`Minecraft ${id} doesn’t exist. Use “latest” or a version like 1.21.4.`);
  const meta = await (await fetch(v.url)).json();
  const server = meta.downloads?.server;
  if (!server) fail(`Minecraft ${id} has no dedicated server download.`);
  return { id, url: server.url, sha1: server.sha1, java: meta.javaVersion?.majorVersion };
}

export async function fetchServer({ force = false } = {}) {
  const v = await resolveVersion();
  if (!force && installedVersion() === v.id && fs.existsSync(path.join(serverDir, 'server.jar'))) return log(`Minecraft ${v.id} is already installed.`), v;
  log(`Downloading Minecraft server ${v.id}${v.java ? ` (needs Java ${v.java})` : ''}…`);
  await download(v.url, path.join(serverDir, 'server.jar'), { sha1: v.sha1, executable: false });
  fs.writeFileSync(path.join(serverDir, 'version.txt'), v.id);
  log(`Installed Minecraft ${v.id}.`);
  return v;
}

if (process.argv[1]?.endsWith('fetch-server.mjs')) {
  if (process.argv[2] === '--dry-run') console.log(JSON.stringify(await resolveVersion(process.argv[3] || 'latest')));
  else await fetchServer({ force: process.argv.includes('--force') });
}
