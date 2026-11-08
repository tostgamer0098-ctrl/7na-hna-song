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

const PORT = process.env.PORT || 5000;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

// ---------- Web server ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server);

const musicPlayer = new MusicPlayer(io);

io.on('connection', (socket) => {
  console.log('Website client connected');
  // Send current state immediately so the page isn't blank on load
  socket.emit('state', musicPlayer.getState());

  socket.on('addSong', async (query, ack) => {
    try {
      const track = await musicPlayer.addSong(query, 'web');
      if (ack) ack({ ok: true, track });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });

  socket.on('skip', () => musicPlayer.skip());
  socket.on('pause', () => musicPlayer.pause());
  socket.on('resume', () => musicPlayer.resume());
  socket.on('clearQueue', () => musicPlayer.clearQueue());
  socket.on('removeAt', (index) => musicPlayer.removeAt(index));
});

server.listen(PORT, () => {
  console.log(`Web control panel running on port ${PORT}`);
});

// ---------- Discord bot ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  if (VOICE_CHANNEL_ID) {
    try {
      const channel = await c.channels.fetch(VOICE_CHANNEL_ID);
      if (!channel?.isVoiceBased?.()) {
        throw new Error('VOICE_CHANNEL_ID does not point to a voice channel.');
      }

      const permissions = channel.permissionsFor(c.user);
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

      await musicPlayer.connect(channel);
    } catch (err) {
      console.error('Could not join the configured voice channel:', err.message);
      console.error('Check VOICE_CHANNEL_ID and the bot permissions for that voice channel.');
    }
  } else {
    console.log('No VOICE_CHANNEL_ID set yet. Use !join in a voice channel, or set it in .env.');
  }
});

// Simple Discord text commands, so it also works without the website
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
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
