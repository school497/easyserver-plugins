// Model management for the Ollama plugin: pull, create from Modelfiles, remove unlisted.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, DATA, run, log, ensureDir, fail } from './lib.mjs';

const base = `http://127.0.0.1:${S.port}`;

async function installed() {
  const r = await fetch(`${base}/api/tags`).catch(() => null);
  if (!r?.ok) fail('Ollama isn’t running. Start the plugin first.');
  return (await r.json()).models.map((m) => m.name);
}
const norm = (n) => (n.includes(':') ? n : `${n}:latest`);

export async function pullMissing() {
  const have = new Set((await installed()).map(norm));
  const want = (S.models ?? []).filter((m) => !have.has(norm(m)));
  if (!want.length) return log('All listed models are downloaded.');
  for (const m of want) {
    log(`Downloading ${m}…`);
    const { code } = await run(BIN.ollama, ['pull', m]);
    log(code === 0 ? `${m} is ready.` : `Couldn’t download ${m} (exit ${code}). Check the name at ollama.com/library.`);
  }
}

async function createFromModelfiles() {
  const dir = ensureDir(path.join(DATA, 'modelfiles'));
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  if (!files.length) return log('Upload a Modelfile to Modelfiles first. Each file becomes a model named after the file.');
  for (const f of files) {
    const name = path.basename(f, path.extname(f)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    log(`Creating model ${name} from ${f}…`);
    const { code } = await run(BIN.ollama, ['create', name, '-f', path.join(dir, f)]);
    log(code === 0 ? `Created ${name}.` : `Couldn’t create ${name} (exit ${code}).`);
  }
}

async function removeUnlisted() {
  const keep = new Set((S.models ?? []).map(norm));
  const custom = new Set(fs.readdirSync(ensureDir(path.join(DATA, 'modelfiles'))).map((f) => norm(path.basename(f, path.extname(f)).toLowerCase())));
  for (const m of await installed()) {
    if (keep.has(norm(m)) || custom.has(norm(m))) continue;
    const { code } = await run(BIN.ollama, ['rm', m], { stream: false });
    log(code === 0 ? `Removed ${m}.` : `Couldn’t remove ${m}.`);
  }
  log('Done.');
}

const cmd = process.argv[2];
if (cmd === 'pull') await pullMissing();
else if (cmd === 'create') await createFromModelfiles();
else if (cmd === 'prune') await removeUnlisted();
