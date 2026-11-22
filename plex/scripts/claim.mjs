// Links this Plex Media Server to a Plex account with a claim token from plex.tv/claim,
// so a server with no screen can be set up remotely.
import { S, fail } from './lib.mjs';

const token = String(S.claimToken ?? '').trim();
if (!token.startsWith('claim-')) fail('Paste a claim token from plex.tv/claim into Settings first (it starts with “claim-” and lasts 4 minutes).');
const res = await fetch(`http://127.0.0.1:32400/myplex/claim?token=${encodeURIComponent(token)}`, {
  method: 'POST',
  headers: { 'X-Plex-Client-Identifier': 'easyserver', 'X-Plex-Product': 'EasyServer' },
}).catch((e) => fail(`Plex isn’t answering on port 32400: ${e.message}`));
if (res.ok) console.log('This server is now linked to your Plex account. Open Plex to add libraries.');
else fail(`Plex refused the claim (HTTP ${res.status}). Tokens expire after 4 minutes; get a new one and try again.`);
