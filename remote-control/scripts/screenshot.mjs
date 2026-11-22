// Takes a screenshot of the server's screen into Screenshots (download it from the app).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, run, ensureDir, isWin, isMac, fail, stamp } from './lib.mjs';

const file = path.join(ensureDir(path.join(DATA, 'screenshots')), `screen-${stamp()}.png`);
let ok = false;
if (isMac) {
  ok = (await run('screencapture', ['-x', file], { stream: false })).code === 0;
} else if (isWin) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;
$img=New-Object System.Drawing.Bitmap $b.Width,$b.Height;
$g=[System.Drawing.Graphics]::FromImage($img);
$g.CopyFromScreen($b.Left,$b.Top,0,0,$img.Size);
$img.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
  ok = (await run('powershell.exe', ['-NoProfile', '-Command', ps], { stream: false })).code === 0;
} else {
  for (const [cmd, args] of [
    ['gnome-screenshot', ['-f', file]],
    ['grim', [file]],
    ['spectacle', ['-b', '-n', '-o', file]],
    ['scrot', [file]],
    ['import', ['-window', 'root', file]],
  ]) {
    if ((await run(cmd, args, { stream: false, timeoutMs: 20_000 })).code === 0 && fs.existsSync(file)) {
      ok = true;
      break;
    }
  }
}
if (!ok || !fs.existsSync(file)) {
  fail(isMac ? 'Couldn’t capture the screen. Allow Screen Recording for EasyServer in System Settings › Privacy & Security.' : 'Couldn’t capture the screen. Is someone signed in with a display?');
}
console.log(`Saved ${path.basename(file)} to Screenshots.`);
