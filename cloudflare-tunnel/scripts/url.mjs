// Prints the tunnel's public address: the random trycloudflare.com URL in Quick mode,
// or a reminder of where named-tunnel hostnames are configured.
import fs from 'node:fs';
import path from 'node:path';
import { S } from './lib.mjs';

if (S.mode === 'token') {
  console.log('Named tunnels use the public hostnames set in Cloudflare Zero Trust › Networks › Tunnels › Public Hostname.');
} else {
  const logFile = path.join(process.env.ES_LOGS_DIR ?? '', 'process.log');
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-400_000) : '';
  const urls = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  console.log(urls ? `Your site is public at:\n${urls[urls.length - 1]}\n\nThis address changes every time the tunnel restarts.` : 'No public address yet. Start the plugin and try again in a few seconds.');
}
