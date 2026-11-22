// Media folders for media-server plugins: prints the paths to add as libraries.
import path from 'node:path';
import { DATA, ensureDir } from './lib.mjs';

export const MEDIA = ['Movies', 'TV Shows', 'Music', 'Photos'];
export function mediaPaths() {
  return MEDIA.map((m) => [m, ensureDir(path.join(DATA, 'media', m.toLowerCase().replace(/\s+/g, '-')))]);
}

if (process.argv[2] === 'paths') {
  console.log('Add these folders as libraries in the server’s web app:\n');
  for (const [name, p] of mediaPaths()) console.log(`${name.padEnd(9)} ${p}`);
}
