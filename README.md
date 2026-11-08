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
5. Go to **OAuth2 -> URL Generator**. Check `bot`. In the permissions box below, check:
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
   (Don't put these in a real `.env` file on Replit — use Secrets instead, it's safer and does the same job.)
5. Click **Run**. The console should show `Logged in as YourBot#1234` and `Joined voice channel: ...`.

### 4. Open the control panel
Replit gives your project a live URL (shown at the top of the webview pane, usually
`https://your-repl-name.your-username.repl.co`). Open that URL — that's your control panel.
Add a song by pasting a YouTube link or typing a song name, then hit play/pause/skip.

### 5. Keep it running
Free Replit projects sleep when nobody's using them. Options:
- Use Replit's "Always On" feature (paid tier), or
- Move it to Railway.app or Render.com later for free always-on hosting (same files work, just set
  the same environment variables there instead of Replit Secrets).

## Using it from Discord too
You don't need the website at all to use basic commands in your server's text channel:
- `!join` — bot joins your current voice channel
- `!play <song name or link>` — adds a song
- `!skip`, `!pause`, `!resume`, `!queue`

## Notes
- This streams audio from YouTube via `play-dl`. If a link fails, try searching by song name instead.
- Everything here is your own bot in your own server — nothing here touches other people's
  accounts, passwords, or data.
