// Bulk File Converter: watches Inbox, converts with FFmpeg (images, audio, video) and LibreOffice
// (documents to PDF), writes results to Converted, and moves originals to Originals or Failed.
import fs from 'node:fs';
import path from 'node:path';
import { S, BIN, DATA, run, log, sleep, ensureDir, listFiles, isWin, isMac } from './lib.mjs';

export const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma', 'aiff', 'aif'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'm4v', 'flv', 'mpg', 'mpeg', 'gif', '3gp'],
  document: ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'odp', 'xls', 'xlsx', 'ods', 'pages', 'key', 'numbers'],
};
const dirs = {
  inbox: ensureDir(path.join(DATA, 'inbox')),
  converted: ensureDir(path.join(DATA, 'converted')),
  originals: ensureDir(path.join(DATA, 'originals')),
  failed: ensureDir(path.join(DATA, 'failed')),
};

export function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return Object.entries(KINDS).find(([, list]) => list.includes(ext))?.[0] ?? null;
}

/** FFmpeg arguments for one file, given the plugin's settings. */
export function ffmpegArgs(kind, src, dest, s = S) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src];
  if (kind === 'image') {
    const q = Number(s.imageQuality ?? 85);
    if (Number(s.maxWidth) > 0) args.push('-vf', `scale='min(${Number(s.maxWidth)},iw)':-2`);
    if (s.stripMetadata !== false) args.push('-map_metadata', '-1');
    if (s.imageFormat === 'jpg') args.push('-q:v', String(Math.max(2, Math.round(31 - (q / 100) * 29))));
    if (s.imageFormat === 'webp') args.push('-quality', String(q));
    if (s.imageFormat === 'avif') args.push('-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(Math.round(63 - q * 0.5)));
    args.push('-frames:v', '1');
  } else if (kind === 'audio') {
    const br = s.audioBitrate ?? '192k';
    const codec = { mp3: ['libmp3lame', true], m4a: ['aac', true], ogg: ['libvorbis', true], opus: ['libopus', true], flac: ['flac', false], wav: ['pcm_s16le', false] }[s.audioFormat ?? 'mp3'];
    args.push('-vn', '-c:a', codec[0]);
    if (codec[1]) args.push('-b:a', br);
  } else if (kind === 'video') {
    const fmt = s.videoFormat ?? 'mp4';
    const h = s.maxHeight && s.maxHeight !== 'keep' ? Number(s.maxHeight) : 0;
    if (fmt === 'gif') {
      args.push('-vf', `fps=12,scale=${h ? `-2:'min(${h},ih)'` : '480:-2'}:flags=lanczos`, '-loop', '0');
    } else {
      if (h) args.push('-vf', `scale=-2:'min(${h},ih)'`);
      const crf = String(s.videoQuality ?? 23);
      if (fmt === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-deadline', s.speed === 'fast' ? 'realtime' : 'good', '-c:a', 'libopus');
      else args.push('-c:v', 'libx264', '-preset', { fast: 'veryfast', medium: 'medium', slow: 'slow' }[s.speed ?? 'medium'], '-crf', crf, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k');
      if (fmt === 'mp4' || fmt === 'mov') args.push('-movflags', '+faststart');
    }
  }
  args.push(dest);
  return args;
}

function libreOffice() {
  const c = isMac
    ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
    : isWin
      ? ['C:/Program Files/LibreOffice/program/soffice.exe', 'C:/Program Files (x86)/LibreOffice/program/soffice.exe']
      : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/snap/bin/libreoffice'];
  return c.find((p) => fs.existsSync(p)) ?? null;
}

const human = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function moveTo(dir, src) {
  const rel = path.relative(dirs.inbox, src);
  let dest = path.join(dir, rel);
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) dest = dest.replace(/(\.[^.]*)?$/, `-${Date.now()}$1`);
  fs.renameSync(src, dest);
}

async function convert(src) {
  const kind = kindOf(src);
  const rel = path.relative(dirs.inbox, src);
  if (!kind) {
    log(`Skipped ${rel}: not a file type this converter handles.`);
    return moveTo(dirs.failed, src);
  }
  const outDir = ensureDir(path.join(dirs.converted, path.dirname(rel)));
  const base = path.basename(src, path.extname(src));
  let result;
  let dest;
  if (kind === 'document') {
    if (!S.docsToPdf) return log(`Skipped ${rel}: turn on “Documents to PDF” to convert documents.`), moveTo(dirs.failed, src);
    const soffice = libreOffice();
    if (!soffice) return log(`Skipped ${rel}: LibreOffice isn’t installed on this server.`), moveTo(dirs.failed, src);
    dest = path.join(outDir, `${base}.pdf`);
    result = await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, src], { stream: false, timeoutMs: 10 * 60_000 });
  } else {
    const ext = { image: S.imageFormat ?? 'webp', audio: S.audioFormat ?? 'mp3', video: S.videoFormat ?? 'mp4' }[kind];
    dest = path.join(outDir, `${base}.${ext}`);
    if (path.resolve(dest) === path.resolve(src)) dest = path.join(outDir, `${base}-converted.${ext}`);
    result = await run(BIN.ffmpeg, ffmpegArgs(kind, src, dest), { stream: false, timeoutMs: 6 * 3600_000 });
  }
  if (result.code === 0 && fs.existsSync(dest)) {
    log(`Converted ${rel} → ${path.relative(dirs.converted, dest)} (${human(fs.statSync(src).size)} → ${human(fs.statSync(dest).size)})`);
    if (S.keepOriginals === false) fs.rmSync(src, { force: true });
    else moveTo(dirs.originals, src);
  } else {
    log(`Failed ${rel}: ${result.out.trim().split('\n').slice(-3).join(' ') || `exit ${result.code}`}`);
    fs.rmSync(dest, { force: true });
    moveTo(dirs.failed, src);
  }
}

async function main() {
  const busy = new Set();
  const limit = Math.max(1, Number(S.concurrency ?? 2));
  log(`Watching Inbox. Images → ${S.imageFormat}, audio → ${S.audioFormat}, video → ${S.videoFormat}${S.docsToPdf ? ', documents → pdf' : ''}.`);
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  while (!stopping) {
    const now = Date.now();
    for (const f of listFiles(dirs.inbox)) {
      if (busy.size >= limit) break;
      if (busy.has(f) || f.endsWith('.part')) continue;
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (now - st.mtimeMs < 4000) continue; // still being written
      busy.add(f);
      convert(f)
        .catch((e) => log(`Error on ${path.basename(f)}: ${e.message}`))
        .finally(() => busy.delete(f));
    }
    await sleep(Math.max(2, Number(S.scanSeconds ?? 5)) * 1000);
  }
  while (busy.size) await sleep(500);
  process.exit(0);
}

if (process.argv[2] === 'retry') {
  for (const f of listFiles(dirs.failed)) {
    const dest = path.join(dirs.inbox, path.relative(dirs.failed, f));
    ensureDir(path.dirname(dest));
    fs.renameSync(f, dest);
  }
  console.log('Moved failed files back to Inbox. They convert on the next scan.');
} else if (process.argv[2] === 'clear') {
  const which = process.argv[3] === 'originals' ? dirs.originals : dirs.converted;
  for (const e of fs.readdirSync(which)) fs.rmSync(path.join(which, e), { recursive: true, force: true });
  console.log(`Emptied ${path.basename(which)}.`);
} else if (!process.env.ES_TEST) {
  main();
}
