// Minecraft launcher: checks the EULA, keeps server.jar on the chosen version, writes
// server.properties from Settings, runs Java, and applies operators once the world is up.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, log, fail, supervise } from './lib.mjs';
import { fetchServer, installedVersion, serverDir } from './fetch-server.mjs';
import { applyPlayers, rcon, rconPassword, rconPort, waitForRcon } from './rcon.mjs';

if (!S.eula) fail('Turn on “I Accept the Minecraft EULA” in Settings (see aka.ms/MinecraftEULA), then start again.');

const wanted = S.version || 'latest';
if (!fs.existsSync(path.join(serverDir, 'server.jar')) || (wanted !== 'latest' && installedVersion() !== wanted)) await fetchServer({ force: true });
log(`Minecraft ${installedVersion() ?? ''} starting with ${S.memory} MB of memory.`);

export function writeProperties() {
  const file = path.join(serverDir, 'server.properties');
  const props = new Map();
  if (fs.existsSync(file))
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) props.set(line.slice(0, i), line.slice(i + 1));
    }
  const set = {
    'server-port': S.port,
    motd: S.motd,
    'max-players': S.maxPlayers,
    gamemode: S.gamemode,
    difficulty: S.difficulty,
    hardcore: !!S.hardcore,
    pvp: S.pvp !== false,
    'online-mode': S.onlineMode !== false,
    'white-list': !!S.whitelist,
    'enforce-whitelist': !!S.whitelist,
    'level-name': S.levelName || 'world',
    'level-seed': S.seed ?? '',
    'view-distance': S.viewDistance,
    'simulation-distance': S.simulationDistance,
    'spawn-protection': S.spawnProtection,
    'allow-flight': !!S.allowFlight,
    'enable-command-block': !!S.commandBlocks,
    'enable-rcon': true,
    'rcon.port': rconPort(),
    'rcon.password': rconPassword(),
    'broadcast-rcon-to-ops': false,
  };
  for (const [k, v] of Object.entries(set)) if (v !== undefined) props.set(k, String(v));
  fs.writeFileSync(file, `# Managed by EasyServer. Change these in the plugin's Settings.\n${[...props].map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');
writeProperties();

const mem = Number(S.memory ?? 2048);
supervise(BIN.java, [`-Xms${Math.min(1024, mem)}M`, `-Xmx${mem}M`, '-jar', 'server.jar', 'nogui'], {
  cwd: serverDir,
  stdin: true,
  onStop: (child) => {
    // Save the world before exiting.
    child.stdin.write('stop\n');
    setTimeout(() => child.kill('SIGKILL'), 60_000).unref();
  },
});

if (await waitForRcon()) {
  log('World is up. Players can join.');
  await applyPlayers().catch((e) => log(`Couldn’t apply operators: ${e.message}`));
  await rcon(['list']).then((r) => log(r[0])).catch(() => {});
}
