# EasyServer plugins

Each folder here is a complete plugin. The `_shared` folder holds helpers that
`scripts/make-plugins.py` copies into each plugin, so it isn't a plugin itself.

| Folder | Plugin | Runs | Platforms |
| --- | --- | --- | --- |
| `apache` | Apache Web Server | Apache httpd with a private config | macOS, Linux, Windows |
| `converter` | Bulk File Converter | FFmpeg (+ LibreOffice for documents) watching an Inbox | macOS, Linux, Windows |
| `ollama` | Ollama | `ollama serve` with its own model folder | macOS, Linux, Windows |
| `cloud-storage` | Cloud Storage | rclone WebDAV server, optional backup to S3/B2/Drive | macOS, Linux, Windows |
| `plex` | Plex Media Server | Plex, with media folders and remote claim | macOS, Linux, Windows |
| `jellyfin` | Jellyfin | Jellyfin server with its own data folders | macOS, Linux, Windows |
| `cloudflare-tunnel` | Cloudflare Tunnel | cloudflared, quick or token tunnels | macOS, Linux, Windows |
| `xcode` | Xcode Builds | xcodebuild: build, test, archive | macOS |
| `remote-control` | Remote Control | RustDesk, power controls, screenshots | macOS, Linux, Windows |
| `minecraft` | Minecraft Server | Mojang's official Java Edition server | macOS, Linux, Windows |
| `docker` | Docker | A Docker Compose project | macOS, Linux, Windows |
| `kubernetes` | Kubernetes | A kind cluster in Docker | macOS, Linux, Windows |
| `terminal` | Terminal | ttyd web terminal with a password | macOS, Linux, Windows |

## Publish them to the store

1. Create a GitHub repository (for example `easyserver-plugins`) and push the contents of this
   `plugins` folder to it.
2. In Supabase, open the SQL editor and run this, with your GitHub username and repository:

```sql
insert into public.plugin_sources (github_url)
select 'https://github.com/YOUR-NAME/easyserver-plugins/tree/main/' || slug
from unnest(array['apache','converter','ollama','cloud-storage','plex','jellyfin','cloudflare-tunnel',
                  'xcode','remote-control','minecraft','docker','kubernetes','terminal']) as slug
on conflict (github_url) do nothing;
```

Discover picks them up right away. To hide one later, set its `enabled` to false.

## Change or add plugins

Edit the manifests in `scripts/make-plugins.py` (not the generated JSON), then run:

```bash
python scripts/make-plugins.py
```

```bash
node scripts/test/run-plugins.mjs
```

The test validates every manifest, renders every command for macOS, Linux and Windows, checks every
script parses, and then runs the plugins whose tools exist on the computer running the test.
For a brand-new plugin, [PLUGIN_PROMPT.md](../PLUGIN_PROMPT.md) lets an LLM write one for you.
