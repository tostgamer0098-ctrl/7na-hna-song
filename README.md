# Discord Music Bot + Web Control Panel

A Discord music bot you can also control from a website (play/pause/skip/queue),
built to run entirely from your phone using Replit.

## What's inside
- `server.js` — runs the Discord bot and the website together
- `bot/musicPlayer.js` — queue + playback logic
- `public/index.html` — the control panel website
- `.env.example` — template for your secret keys

## Setup (all from your phone browser)

### 1. Create the Discord bot
1. Go to https://discord.com/developers/applications
2. Click **New Application**, name it, create it.
3. Go to the **Bot** tab -> **Reset Token** -> copy the token (save it somewhere safe, you'll need it in step 3).
4. On the same Bot tab, turn ON **Message Content Intent**.
5. Go to **OAuth2 -> URL Generator**. Check `bot` and `applications.commands`. In the permissions box below, check:
   `Connect`, `Speak`, `Send Messages`, `View Channels`.
6. Copy the generated URL at the bottom, open it in a new tab, and invite the bot to your server.

### 2. Get your IDs
In Discord: Settings -> Advanced -> turn on **Developer Mode**.
- Right-click your server icon -> **Copy Server ID** -> this is `GUILD_ID`
- Right-click the voice channel you want the bot to play in -> **Copy Channel ID** -> this is `VOICE_CHANNEL_ID`

### 3. Put the project on Replit
1. Go to https://replit.com and sign up / log in (works fine on mobile browser).
2. Create a new Repl -> **Import from upload** (or "Create Repl" -> Node.js, then upload these files into it).
3. Upload all the files/folders from this project, keeping the same folder structure.
4. In Replit, open the **Secrets** tool (padlock icon in the sidebar) and add:
   - `DISCORD_TOKEN` = the token from step 1
   - `GUILD_ID` = your server ID
   - `VOICE_CHANNEL_ID` = your voice channel ID
    - `SESSION_SECRET` = a long random value for signing admin sessions
    - `ADMIN_CODE` = a private code you choose for hidden admin access
   (Don't put these in a real `.env` file on Replit — use Secrets instead, it's safer and does the same job.)
5. Click **Run**. The app registers the slash commands in `GUILD_ID` when the bot logs in.
   The console should show `Logged in as YourBot#1234` and, when voice permissions are valid,
   `Joined voice channel: ...`.

### 4. Open the control panel
Replit gives your project a live URL in the webview pane. Open it to use the phone-friendly
control panel: paste a voice channel ID to join, search or paste a YouTube link, and use the
play/pause, skip, stop, volume, loop, shuffle, and queue controls.

Submitting your `ADMIN_CODE` in the voice-channel ID field opens the admin popup. It contains
the maintenance toggle and optional visitor message. The code is verified on the server and
must only be stored in Replit Secrets.

### 5. Keep it running
Free Replit projects sleep when nobody's using them. Options:
- Use Replit's "Always On" feature (paid tier), or
- Move it to Railway.app or Render.com later for free always-on hosting (same files work, just set
  the same environment variables there instead of Replit Secrets).

## Using it from Discord
Slash commands are registered in `GUILD_ID` when the bot starts:
- `/play query:<song name or URL>`, `/pause`, `/resume`, `/skip`, `/stop`
- `/queue`, `/nowplaying`, `/volume level:<0-100>`, `/loop mode:<off|song|queue>`
- `/shuffle`, `/remove position:<number>`, `/clear`, `/join`, `/leave`

The existing text commands remain available in a server text channel:
- `!join` — bot joins your current voice channel
- `!play <song name or link>` — adds a song
- `!skip`, `!pause`, `!resume`, `!queue`

When maintenance mode is on, commands receive an ephemeral maintenance reply, playback stops,
the queue clears, and regular website controls are disabled. Maintenance state is saved under
`data/maintenance.json` and survives app restarts.

## Notes
- This streams audio from YouTube via `@distube/ytdl-core`. If a link fails, try searching by song name instead.
- Everything here is your own bot in your own server — nothing here touches other people's
  accounts, passwords, or data.
