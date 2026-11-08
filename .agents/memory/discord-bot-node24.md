---
name: Discord bot Node 24 setup
description: Compatibility notes for this Discord bot's native Opus dependency on Replit Node 24.
---

For clean installs on Replit's Node 24 runtime, use `@discordjs/opus` 0.11 or newer; older releases may lack a Node 24 prebuilt binary and fail when their bundled Opus source is compiled. Its `@discordjs/node-pre-gyp` dependency can select `tar@6.2.1`, which Replit's package firewall blocks; keep the scoped tar override on a patched compatible release.

**Why:** The imported Node 24 runtime could not install the older Opus package, and the firewall rejected its transitive tar version.

**How to apply:** When updating Discord bot dependencies or changing the Node runtime, verify a clean `npm install`, confirm the Opus module loads, and keep the transitive tar resolution compatible with both node-pre-gyp and the package firewall.
