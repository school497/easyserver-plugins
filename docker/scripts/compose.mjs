// Docker: runs a Compose project in the foreground so its logs stream to the plugin's Output,
// and stops it the way Settings says when the plugin stops.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, DATA, RUNTIME, run, supervise, ensureDocker, ensureDir, fail, log } from './lib.mjs';

const docker = BIN.docker;
const project = S.projectName || 'easyserver';
const projectDir = ensureDir(path.join(DATA, 'project'));

function composeFile() {
  if (S.source !== 'folder') return path.join(RUNTIME, 'compose.yaml');
  const f = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'].map((n) => path.join(projectDir, n)).find((p) => fs.existsSync(p));
  if (!f) fail('Upload a compose.yaml to Project Files, or switch Settings › Compose File to “Written Below”.');
  return f;
}

export function baseArgs() {
  const args = ['compose', '-p', project, '-f', composeFile(), '--project-directory', projectDir];
  const envFile = path.join(RUNTIME, 'compose.env');
  if (fs.existsSync(envFile) && fs.readFileSync(envFile, 'utf8').trim()) args.push('--env-file', envFile);
  return args;
}

const cmd = process.argv[2] ?? 'up';
await ensureDocker(docker);
if (cmd === 'up') {
  const check = await run(docker, [...baseArgs(), 'config', '--quiet'], { stream: false });
  if (check.code !== 0) fail(`The Compose file has a problem:\n${check.out.trim()}`);
  log(`Starting Compose project “${project}”.`);
  supervise(docker, [...baseArgs(), 'up', '--remove-orphans', '--pull', S.pullPolicy || 'missing', ...(S.build ? ['--build'] : [])], {
    onStop: (child) => child.kill('SIGINT'),
  });
} else if (cmd === 'stop') {
  const how = S.onStop || 'stop';
  if (how === 'keep') log('Leaving containers running.');
  else await run(docker, [...baseArgs(), how === 'down' ? 'down' : 'stop']);
} else if (cmd === 'ps') {
  await run(docker, [...baseArgs(), 'ps', '--all']);
} else if (cmd === 'pull') {
  await run(docker, [...baseArgs(), 'pull']);
} else if (cmd === 'build') {
  await run(docker, [...baseArgs(), 'build', '--pull']);
}
