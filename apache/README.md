# Apache Web Server — EasyServer plugin

Upload this folder to a GitHub repository (the folder can be the repo root or any sub-folder), then add
its URL to the `plugin_sources` table in Supabase, for example:

    https://github.com/YOU/easyserver-plugins/tree/main/apache

The app reads `easyserver.plugin.json` straight from GitHub and the server downloads exactly the files listed in `files`.
