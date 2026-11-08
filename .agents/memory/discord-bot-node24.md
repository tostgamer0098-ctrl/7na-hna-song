---
name: Discord bot streaming setup
description: Compatibility notes for Discord voice and YouTube audio streaming on Replit.
---

For clean installs on Replit's Node 24 runtime, use `@discordjs/opus` 0.11 or newer; older releases may lack a Node 24 prebuilt binary and fail when their bundled Opus source is compiled. Its `@discordjs/node-pre-gyp` dependency can select `tar@6.2.1`, which Replit's package firewall blocks; keep the scoped tar override on a patched compatible release.

The old `@discordjs/voice` 0.16 line can time out when joining current Discord voice channels. The 0.19 line includes current DAVE support. The project’s `play-dl` 1.9.7 could search and inspect YouTube videos but failed when opening audio streams; the maintained `@distube/ytdl-core` package successfully returned audio data. Feed its readable stream to Discord voice as `StreamType.Arbitrary` so the bundled `ffmpeg-static` handles conversion.

**Why:** On 2026-11-08, the bot logged in but failed voice connection with an aborted operation and `play-dl` failed with invalid URLs. Updating voice support and the YouTube resolver resulted in a ready voice connection and a playing track.

**How to apply:** When updating Discord bot dependencies or changing the Node runtime, verify a clean install, confirm Opus loads, join the configured voice channel, and test a YouTube audio stream. Keep transitive tar resolution compatible with both node-pre-gyp and Replit's package firewall.
