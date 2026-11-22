// Runs `ollama serve` with this plugin's settings, then downloads the models listed in Settings.
import { S, BIN, log, sleep, supervise } from './lib.mjs';
import { pullMissing } from './models.mjs';

const base = `http://127.0.0.1:${S.port}`;
supervise(BIN.ollama, ['serve']);

if (S.pullOnStart !== false && (S.models ?? []).length) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      if ((await fetch(`${base}/api/version`)).ok) break;
    } catch {}
  }
  pullMissing().catch((e) => log(`Model download failed: ${e.message}`));
}
