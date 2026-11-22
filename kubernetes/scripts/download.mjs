// Install step: node download.mjs <url> <destination>
import { download, fail } from './lib.mjs';

const [url, dest] = process.argv.slice(2);
if (!url || !dest) fail('usage: download.mjs <url> <destination>');
await download(url, dest);
