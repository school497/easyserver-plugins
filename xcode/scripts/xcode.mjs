// Xcode CLI: builds, tests and archives projects uploaded to Projects, putting zipped products
// in Builds. `watch` (the plugin's process) rebuilds automatically after uploads settle.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, DATA, run, log, sleep, ensureDir, listFiles, fail, stamp, selfCommand } from './lib.mjs';

const projects = ensureDir(path.join(DATA, 'projects'));
const builds = ensureDir(path.join(DATA, 'builds'));
const derived = ensureDir(path.join(DATA, 'derived'));
const xcodebuild = BIN.xcodebuild ?? '/usr/bin/xcodebuild';

function findProject() {
  if (S.project) {
    const p = path.join(projects, S.project);
    if (!fs.existsSync(p)) fail(`Couldn’t find ${S.project} in Projects.`);
    return p;
  }
  const found = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.name.endsWith('.xcworkspace') && !full.includes('.xcodeproj/')) found.push([0, full]);
      else if (e.name.endsWith('.xcodeproj')) found.push([1, full]);
      else if (e.name !== 'Pods' && e.name !== 'build') walk(full, depth + 1);
    }
  };
  walk(projects, 0);
  found.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length);
  if (!found.length) fail('Upload a folder containing an .xcodeproj or .xcworkspace to Projects first.');
  return found[0][1];
}

const containerArgs = (p) => (p.endsWith('.xcworkspace') ? ['-workspace', p] : ['-project', p]);

async function schemes(p) {
  const r = await run(xcodebuild, ['-list', '-json', ...containerArgs(p)], { stream: false });
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    return (j.workspace ?? j.project).schemes ?? [];
  } catch {
    fail(`xcodebuild couldn’t read the project:\n${r.out.trim()}`);
  }
}

async function simulator() {
  const r = await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { stream: false });
  const devices = Object.entries(JSON.parse(r.out).devices)
    .filter(([rt]) => rt.includes('iOS'))
    .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
    .flatMap(([, list]) => list);
  return devices.find((d) => d.name.startsWith('iPhone')) ?? devices[0];
}

async function xcode(kind) {
  const p = findProject();
  const scheme = S.scheme || (await schemes(p))[0];
  if (!scheme) fail('No schemes found. Share a scheme in Xcode (Product › Scheme › Manage Schemes › Shared).');
  let destination = S.destination || 'generic/platform=iOS Simulator';
  if (kind === 'test' && destination.startsWith('generic/platform=iOS')) {
    const sim = await simulator();
    if (!sim) fail('No iOS simulators are installed. Open Xcode › Settings › Platforms to add one.');
    destination = `platform=iOS Simulator,id=${sim.udid}`;
  }
  const archivePath = path.join(builds, `${scheme}-${stamp()}.xcarchive`);
  const args = [
    ...containerArgs(p),
    '-scheme', scheme,
    '-configuration', kind === 'archive' ? 'Release' : S.configuration || 'Debug',
    '-destination', destination,
    '-derivedDataPath', derived,
    ...(kind === 'archive' ? ['-archivePath', archivePath] : []),
    ...(S.clean ? ['clean'] : []),
    kind === 'test' ? 'test' : kind === 'archive' ? 'archive' : 'build',
    ...(S.skipSigning !== false && kind !== 'archive' ? ['CODE_SIGNING_ALLOWED=NO'] : []),
    ...(S.extraArgs ?? []),
  ];
  log(`xcodebuild ${kind}: ${path.relative(projects, p)} · ${scheme} · ${destination}`);
  const started = Date.now();
  const r = await run(xcodebuild, args, { cwd: path.dirname(p) });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.code !== 0) fail(`${kind} failed after ${secs}s. The errors are above.`);
  if (kind === 'archive') {
    const zip = archivePath.replace(/\.xcarchive$/, '.xcarchive.zip');
    await run('ditto', ['-c', '-k', '--keepParent', archivePath, zip], { stream: false });
    fs.rmSync(archivePath, { recursive: true, force: true });
    return log(`Archived in ${secs}s → Builds/${path.basename(zip)}`);
  }
  if (kind === 'build') {
    const products = listFiles(path.join(derived, 'Build', 'Products'), { recursive: true })
      .map((f) => f.slice(0, f.indexOf('.app/') + 4))
      .filter((f, i, a) => f.endsWith('.app') && a.indexOf(f) === i);
    for (const app of products) {
      const zip = path.join(builds, `${path.basename(app, '.app')}-${stamp()}.app.zip`);
      await run('ditto', ['-c', '-k', '--keepParent', app, zip], { stream: false });
      log(`Built ${path.basename(app)} → Builds/${path.basename(zip)}`);
    }
  }
  log(`${kind} succeeded in ${secs}s.`);
}

async function watch() {
  log('Ready. Upload a project to Projects, or use the Build, Test and Archive actions.');
  let last = '';
  let quietSince = 0;
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  while (!stopping) {
    await sleep(5000);
    if (!S.buildOnUpload) continue;
    const sig = listFiles(projects)
      .filter((f) => !f.includes('xcuserdata'))
      .map((f) => `${f}:${fs.statSync(f).mtimeMs}`)
      .join('|');
    if (sig === last) {
      if (quietSince && Date.now() - quietSince > 10_000 && sig) {
        quietSince = 0;
        const [exe, args] = selfCommand(process.argv[1], 'build');
        await run(exe, args);
      }
      continue;
    }
    last = sig;
    quietSince = Date.now();
  }
  process.exit(0);
}

const cmd = process.argv[2] ?? 'watch';
if (cmd === 'watch') await watch();
else if (cmd === 'schemes') {
  const p = findProject();
  console.log(`${path.relative(projects, p)}\n\nSchemes:\n${(await schemes(p)).map((s) => `  ${s}`).join('\n')}`);
} else if (cmd === 'simulators') {
  await run('xcrun', ['simctl', 'list', 'devices', 'available']);
} else await xcode(cmd);
