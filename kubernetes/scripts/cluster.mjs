// Kubernetes: a local cluster made with kind (Kubernetes in Docker). Starting the plugin creates
// or resumes the cluster, writes a kubeconfig to Cluster Access and applies Manifests; stopping
// it pauses, deletes or keeps the cluster as Settings says.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, DATA, RUNTIME, run, ensureDocker, ensureDir, fail, log, sleep } from './lib.mjs';

const name = S.clusterName || 'easyserver';
const access = ensureDir(path.join(DATA, 'access'));
const manifests = ensureDir(path.join(DATA, 'manifests'));
const kubeconfig = path.join(access, 'kubeconfig.yaml');
const kind = (args, opts) => run(BIN.kind, args, opts);
const kubectl = (args, opts) => run(BIN.kubectl, ['--kubeconfig', kubeconfig, ...args], opts);

export function kindConfig(s = S) {
  const lines = [
    'kind: Cluster',
    'apiVersion: kind.x-k8s.io/v1alpha4',
    `name: ${s.clusterName || 'easyserver'}`,
    'networking:',
    `  apiServerAddress: "${s.exposeApi ? '0.0.0.0' : '127.0.0.1'}"`,
    `  apiServerPort: ${Number(s.apiPort ?? 6443)}`,
    'nodes:',
    '  - role: control-plane',
  ];
  if (s.nodeImage) lines.push(`    image: ${s.nodeImage}`);
  if (s.ingressPorts !== false) {
    lines.push(
      '    kubeadmConfigPatches:',
      '      - |',
      '        kind: InitConfiguration',
      '        nodeRegistration:',
      '          kubeletExtraArgs:',
      '            node-labels: "ingress-ready=true"',
      '    extraPortMappings:',
      `      - containerPort: 80\n        hostPort: ${Number(s.httpPort ?? 8088)}`,
      `      - containerPort: 443\n        hostPort: ${Number(s.httpsPort ?? 8443)}`,
    );
  }
  for (let i = 0; i < Number(s.workers ?? 0); i++) lines.push('  - role: worker', ...(s.nodeImage ? [`    image: ${s.nodeImage}`] : []));
  return lines.join('\n') + '\n';
}

async function exists() {
  const r = await kind(['get', 'clusters'], { stream: false });
  return r.out.split(/\s+/).includes(name);
}
async function nodeContainers() {
  const r = await run(BIN.docker, ['ps', '-a', '--filter', `label=io.x-k8s.kind.cluster=${name}`, '--format', '{{.Names}}'], { stream: false });
  return r.out.split(/\s+/).filter(Boolean);
}

async function applyManifests() {
  const files = fs.readdirSync(manifests).filter((f) => /\.(ya?ml|json)$/i.test(f));
  if (!files.length) return log('No manifests to apply. Upload YAML files to Manifests.');
  await kubectl(['apply', '-R', '-f', manifests]);
}

async function up() {
  await ensureDocker(BIN.docker);
  if (await exists()) {
    log(`Resuming cluster “${name}”.`);
    const nodes = await nodeContainers();
    if (nodes.length) await run(BIN.docker, ['start', ...nodes], { stream: false });
  } else {
    const cfg = path.join(RUNTIME, 'kind.yaml');
    fs.writeFileSync(cfg, kindConfig());
    log(`Creating cluster “${name}”. The first run downloads a node image and takes a few minutes.`);
    const r = await kind(['create', 'cluster', '--config', cfg, '--kubeconfig', kubeconfig, '--wait', '5m']);
    if (r.code !== 0) fail('Couldn’t create the cluster. See the output above.');
  }
  await kind(['export', 'kubeconfig', '--name', name, '--kubeconfig', kubeconfig], { stream: false });
  for (let i = 0; i < 60; i++) {
    if ((await kubectl(['get', '--raw', '/readyz'], { stream: false })).code === 0) break;
    await sleep(3000);
  }
  log('Cluster is ready. Download kubeconfig.yaml from Cluster Access to use kubectl from another computer.');
  if (S.applyOnStart !== false) await applyManifests();

  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  let healthy = true;
  while (!stopping) {
    await sleep(15_000);
    const ok = (await kubectl(['get', '--raw', '/readyz'], { stream: false, timeoutMs: 10_000 })).code === 0;
    if (ok !== healthy) log(ok ? 'API server is healthy again.' : 'API server isn’t answering.');
    healthy = ok;
  }
  process.exit(0);
}

async function down() {
  const how = S.onStop || 'stop';
  if (how === 'keep') return log('Leaving the cluster running.');
  if (how === 'delete') {
    await kind(['delete', 'cluster', '--name', name]);
    fs.rmSync(kubeconfig, { force: true });
    return;
  }
  const nodes = await nodeContainers();
  if (nodes.length) await run(BIN.docker, ['stop', ...nodes]);
  log('Cluster paused. It resumes when the plugin starts.');
}

const cmd = process.argv[2] ?? 'up';
if (cmd === 'up') await up();
else if (cmd === 'stop') await down();
else if (cmd === 'apply') await applyManifests();
else if (cmd === 'delete') {
  await kind(['delete', 'cluster', '--name', name]);
  fs.rmSync(kubeconfig, { force: true });
  log('Cluster deleted. Starting the plugin creates a new one.');
} else if (cmd === 'config') process.stdout.write(kindConfig());
