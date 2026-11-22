// Remote Control: keeps RustDesk running for remote desktop, and applies the unattended-access password.
import { S, BIN, run, log, supervise, isWin, isMac, fail } from './lib.mjs';

async function rustdeskId() {
  const r = await run(BIN.rustdesk, ['--get-id'], { stream: false, timeoutMs: 15_000 });
  return r.out.trim().split(/\s+/).pop();
}

const cmd = process.argv[2] ?? 'run';
if (cmd === 'id') {
  const id = await rustdeskId();
  if (!id || !/^\d{6,}$/.test(id)) fail('RustDesk hasn’t created an ID yet. Start the plugin, wait a few seconds, and try again.');
  console.log(`RustDesk ID: ${id}\n\nIn the RustDesk app on your other device, enter this ID and the password from Settings.`);
} else {
  if (S.password) {
    const r = await run(BIN.rustdesk, ['--password', S.password], { stream: false, timeoutMs: 20_000 });
    log(r.code === 0 ? 'Unattended-access password applied.' : `Couldn’t set the password (${r.out.trim() || `exit ${r.code}`}). ${isWin ? 'Run EasyServer as administrator once' : isMac ? 'Set it in RustDesk › Settings › Security' : 'Run: sudo rustdesk --password …'} instead.`);
  }
  supervise(BIN.rustdesk, isWin || isMac ? [] : ['--server']);
  setTimeout(async () => {
    const id = await rustdeskId().catch(() => '');
    if (id) log(`RustDesk ID: ${id}`);
  }, 8000);
}
