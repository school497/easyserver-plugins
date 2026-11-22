// Power controls: lock, sleep, restart, shut down. Restart and Shut Down wait for the delay in Settings.
import { S, run, isWin, isMac, fail } from './lib.mjs';

const what = process.argv[2];
if (S.allowPower === false && what !== 'lock') fail('Power controls are turned off in Settings.');
const delay = Math.max(0, Number(S.powerDelay ?? 1));

const commands = {
  lock: isMac
    ? ['pmset', ['displaysleepnow']]
    : isWin
      ? ['rundll32.exe', ['user32.dll,LockWorkStation']]
      : ['loginctl', ['lock-sessions']],
  sleep: isMac ? ['pmset', ['sleepnow']] : isWin ? ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']] : ['systemctl', ['suspend']],
  restart: isMac
    ? ['osascript', ['-e', `delay ${delay * 60}`, '-e', 'tell application "System Events" to restart']]
    : isWin
      ? ['shutdown', ['/r', '/t', String(delay * 60)]]
      : ['shutdown', ['-r', `+${delay}`]],
  shutdown: isMac
    ? ['osascript', ['-e', `delay ${delay * 60}`, '-e', 'tell application "System Events" to shut down']]
    : isWin
      ? ['shutdown', ['/s', '/t', String(delay * 60)]]
      : ['shutdown', ['-h', `+${delay}`]],
  cancel: isWin ? ['shutdown', ['/a']] : isMac ? ['pkill', ['-f', 'tell application "System Events" to']] : ['shutdown', ['-c']],
};
if (!commands[what]) fail(`Unknown power command: ${what}`);
const [cmd, args] = commands[what];

if ((what === 'restart' || what === 'shutdown') && isMac) {
  // osascript waits for the delay, so detach it and report right away.
  const { spawn } = await import('node:child_process');
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
} else {
  const r = await run(cmd, args, { stream: false, timeoutMs: 20_000 });
  if (r.code !== 0) fail(r.out.trim() || `${what} failed (exit ${r.code}).`);
}
const done = {
  lock: 'Screen locked.',
  sleep: 'Going to sleep.',
  restart: delay ? `Restarting in ${delay} minute${delay === 1 ? '' : 's'}. Use Cancel Restart or Shut Down to stop it.` : 'Restarting now.',
  shutdown: delay ? `Shutting down in ${delay} minute${delay === 1 ? '' : 's'}. Use Cancel Restart or Shut Down to stop it.` : 'Shutting down now.',
  cancel: 'Cancelled the pending restart or shutdown.',
};
console.log(done[what]);
