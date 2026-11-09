// server.js
// Entry point: starts the Discord bot AND the website (Express + Socket.io)
// in the same process, so both share the same MusicPlayer instance.

require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, GatewayIntentBits, Events, PermissionFlagsBits } = require('discord.js');

const MusicPlayer = require('./bot/musicPlayer');
const AdminAccess = require('./bot/adminAccess');
const { loadMaintenanceState, saveMaintenanceState } = require('./bot/maintenanceStore');
const { handleSlashCommand, registerSlashCommands } = require('./bot/slashCommands');

const PORT = process.env.PORT || 5000;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const MAINTENANCE_FILE = path.join(__dirname, 'data', 'maintenance.json');
const ADMIN_ENTRY_RESPONSE_MS = 150;

// ---------- Web server ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '4kb' }));

const server = http.createServer(app);
const io = new Server(server);

const musicPlayer = new MusicPlayer(io);
const adminAccess = new AdminAccess({
  getAdminCode: () => process.env.ADMIN_CODE,
  getSessionSecret: () => process.env.SESSION_SECRET,
});
let maintenanceState = loadMaintenanceState(MAINTENANCE_FILE);
musicPlayer.setMaintenanceState(maintenanceState);

function assertVoiceChannelPermissions(channel, botUser) {
  const permissions = channel.permissionsFor(botUser);
  const requiredPermissions = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.Connect, 'Connect'],
    [PermissionFlagsBits.Speak, 'Speak'],
  ];
  const missingPermissions = requiredPermissions
    .filter(([permission]) => !permissions?.has(permission))
    .map(([, label]) => label);

  if (missingPermissions.length) {
    throw new Error(`The bot is missing channel permissions: ${missingPermissions.join(', ')}.`);
  }
}

function maintenanceReply() {
  return `Bot is under maintenance${maintenanceState.message ? `\n${maintenanceState.message}` : ''}`;
}

function controlError(socket, ack) {
  const error = maintenanceReply();
  if (typeof ack === 'function') ack({ ok: false, error });
  else socket.emit('controlError', error);
}

function requireControlAccess(socket, ack) {
  const wasAdmin = socket.data.isAdmin;
  const sessionId = adminAccess.sessionIdFromCookieHeader(socket.handshake.headers.cookie);
  socket.data.isAdmin = Boolean(sessionId);
  socket.data.adminSessionId = sessionId;
  if (wasAdmin && !sessionId) socket.emit('session', { isAdmin: false });
  if (!maintenanceState.enabled || socket.data.isAdmin) return true;
  controlError(socket, ack);
  return false;
}

function secureCookieOptions(req) {
  return {
    httpOnly: true,
    secure: Boolean(req.secure),
    sameSite: 'strict',
    path: '/',
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

io.use((socket, next) => {
  const sessionId = adminAccess.sessionIdFromCookieHeader(socket.handshake.headers.cookie);
  socket.data.isAdmin = Boolean(sessionId);
  socket.data.adminSessionId = sessionId;
  next();
});

app.post('/api/channel-entry', async (req, res) => {
  const startedAt = Date.now();
  const result = adminAccess.classifyEntry(req.body?.value, req.ip || 'unknown');

  if (result === 'admin') {
    try {
      const session = adminAccess.createSession();
      res.cookie(AdminAccess.cookieName(), session.token, {
        ...secureCookieOptions(req),
        maxAge: session.maxAge,
      });
    } catch (err) {
      // Keep the response indistinguishable from an ordinary channel entry.
      console.error('Could not create admin session:', err.message);
      await delay(Math.max(0, ADMIN_ENTRY_RESPONSE_MS - (Date.now() - startedAt)));
      return res.json({ result: 'normal' });
    }
  }

  await delay(Math.max(0, ADMIN_ENTRY_RESPONSE_MS - (Date.now() - startedAt)));
  return res.json({ result });
});

app.get('/api/admin/status', adminAccess.requireAdmin, (req, res) => {
  res.json({ maintenance: maintenanceState });
});

app.put('/api/admin/maintenance', adminAccess.requireAdmin, (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Maintenance mode must be ON or OFF.' });
  }

  try {
    maintenanceState = saveMaintenanceState(MAINTENANCE_FILE, {
      enabled: req.body.enabled,
      message: typeof req.body.message === 'string' ? req.body.message : '',
    });
  } catch (err) {
    console.error('Could not save maintenance state:', err.message);
    return res.status(500).json({ error: 'Could not save maintenance settings.' });
  }

  musicPlayer.setMaintenanceState(maintenanceState);
  if (maintenanceState.enabled) musicPlayer.stopPlayback({ clearQueue: true });
  return res.json({ maintenance: maintenanceState });
});

app.post('/api/admin/logout', adminAccess.requireAdmin, (req, res) => {
  const sessionId = req.adminSessionId;
  adminAccess.revokeSession(sessionId);
  res.clearCookie(AdminAccess.cookieName(), secureCookieOptions(req));
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.adminSessionId === sessionId) socket.disconnect(true);
  }
  return res.json({ ok: true });
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

io.on('connection', (socket) => {
  console.log('Website client connected');
  // Send current state immediately so the page isn't blank on load
  socket.emit('state', musicPlayer.getState());
  socket.emit('session', { isAdmin: socket.data.isAdmin });

  socket.on('joinChannel', async (channelId, ack) => {
    if (!requireControlAccess(socket, ack)) return;
    try {
      if (!client.isReady()) {
        throw new Error('The Discord bot is not connected yet. Try again shortly.');
      }

      const id = String(channelId || '').trim();
      if (!id) throw new Error('Enter a Discord voice channel ID.');
      if (!/^\d{17,20}$/.test(id)) {
        throw new Error('Enter a valid Discord channel ID.');
      }

      let channel;
      try {
        channel = await client.channels.fetch(id);
      } catch (err) {
        if (err.code === 10003 || err.code === 50001) {
          throw new Error('Channel not found or the bot cannot access it.');
        }
        throw err;
      }

      if (!channel?.isVoiceBased?.()) {
        throw new Error('That ID does not identify a voice channel.');
      }

      assertVoiceChannelPermissions(channel, client.user);
      await musicPlayer.connect(channel);
      if (typeof ack === 'function') {
        ack({ ok: true, channel: { id: channel.id, name: channel.name } });
      }
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
      else socket.emit('controlError', err.message);
    }
  });

  socket.on('addSong', async (query, ack) => {
    if (!requireControlAccess(socket, ack)) return;
    try {
      const track = await musicPlayer.addSong(query, 'web');
      if (ack) ack({ ok: true, track });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });

  socket.on('togglePause', () => {
    if (requireControlAccess(socket) && !musicPlayer.togglePause()) {
      socket.emit('controlError', 'Nothing is playing right now.');
    }
  });
  socket.on('skip', () => {
    if (requireControlAccess(socket) && !musicPlayer.skip()) {
      socket.emit('controlError', 'Nothing is playing right now.');
    }
  });
  socket.on('stop', () => {
    if (requireControlAccess(socket)) musicPlayer.stopAndLeave();
  });
  socket.on('setVolume', (value) => {
    if (!requireControlAccess(socket)) return;
    try {
      musicPlayer.setVolume(value);
    } catch (err) {
      socket.emit('controlError', err.message);
    }
  });
  socket.on('setLoopMode', (mode) => {
    if (!requireControlAccess(socket)) return;
    try {
      musicPlayer.setLoopMode(mode);
    } catch (err) {
      socket.emit('controlError', err.message);
    }
  });
  socket.on('shuffle', () => {
    if (requireControlAccess(socket) && !musicPlayer.shuffle()) {
      socket.emit('controlError', 'Add at least two songs before shuffling.');
    }
  });
  socket.on('clearQueue', () => {
    if (requireControlAccess(socket)) musicPlayer.clearQueue();
  });
  socket.on('removeAt', (index) => {
    if (!requireControlAccess(socket)) return;
    const removed = musicPlayer.removeAt(Number(index));
    if (!removed) socket.emit('controlError', 'That song is no longer in the queue.');
  });
});

server.listen(PORT, () => {
  console.log(`Web control panel running on port ${PORT}`);
});

// ---------- Discord bot ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  try {
    await registerSlashCommands(c, GUILD_ID);
    console.log('Registered guild slash commands.');
  } catch (err) {
    console.error('Could not register slash commands:', err.message);
  }

  if (maintenanceState.enabled) {
    console.log('Maintenance mode is active; skipping the startup voice join.');
    return;
  }

  if (VOICE_CHANNEL_ID) {
    try {
      const channel = await c.channels.fetch(VOICE_CHANNEL_ID);
      if (!channel?.isVoiceBased?.()) {
        throw new Error('VOICE_CHANNEL_ID does not point to a voice channel.');
      }

      assertVoiceChannelPermissions(channel, c.user);
      await musicPlayer.connect(channel);
    } catch (err) {
      console.error('Could not join the configured voice channel:', err.message);
      console.error('Check VOICE_CHANNEL_ID and the bot permissions for that voice channel.');
    }
  } else {
    console.log('No VOICE_CHANNEL_ID set yet. Use !join in a voice channel, or set it in .env.');
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleSlashCommand(interaction, {
    musicPlayer,
    getMaintenanceState: () => maintenanceState,
  }).catch((err) => console.error('Slash interaction failed:', err.message));
});

// Simple Discord text commands, so it also works without the website
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (maintenanceState.enabled) {
    return message.reply(maintenanceReply());
  }
  const [cmd, ...rest] = message.content.trim().split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case '!join': {
      const channel = message.member?.voice?.channel;
      if (!channel) return message.reply('Join a voice channel first!');
      try {
        await musicPlayer.connect(channel);
        await message.reply(`Joined **${channel.name}**.`);
      } catch (err) {
        await message.reply(`Could not join the voice channel: ${err.message}`);
      }
      break;
    }
    case '!play': {
      if (!arg) return message.reply('Usage: `!play <song name or YouTube URL>`');
      try {
        const track = await musicPlayer.addSong(arg, message.author.tag);
        message.reply(`Queued: **${track.title}**`);
      } catch (err) {
        message.reply(`Error: ${err.message}`);
      }
      break;
    }
    case '!skip':
      musicPlayer.skip();
      message.reply('Skipped.');
      break;
    case '!pause':
      musicPlayer.pause();
      message.reply('Paused.');
      break;
    case '!resume':
      musicPlayer.resume();
      message.reply('Resumed.');
      break;
    case '!queue': {
      const state = musicPlayer.getState();
      const lines = state.queue.map((t, i) => `${i + 1}. ${t.title}`);
      message.reply(
        `Now playing: ${state.current ? state.current.title : 'nothing'}\n` +
          (lines.length ? lines.join('\n') : 'Queue is empty.')
      );
      break;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
