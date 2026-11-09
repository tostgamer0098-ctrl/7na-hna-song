const { SlashCommandBuilder } = require('discord.js');

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Join your voice channel and play a song')
    .addStringOption((option) => option
      .setName('query')
      .setDescription('A song name or YouTube URL')
      .setRequired(true)),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback, clear the queue, and leave'),
  new SlashCommandBuilder().setName('queue').setDescription('Show upcoming songs'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current song'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume')
    .addIntegerOption((option) => option
      .setName('level')
      .setDescription('Volume from 0 to 100')
      .setMinValue(0)
      .setMaxValue(100)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set the loop mode')
    .addStringOption((option) => option
      .setName('mode')
      .setDescription('Off, repeat the song, or repeat the queue')
      .setRequired(true)
      .addChoices(
        { name: 'Off', value: 'off' },
        { name: 'Song', value: 'song' },
        { name: 'Queue', value: 'queue' }
      )),
  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the upcoming queue'),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the upcoming queue')
    .addIntegerOption((option) => option
      .setName('position')
      .setDescription('Position in the upcoming queue, starting at 1')
      .setMinValue(1)
      .setRequired(true)),
  new SlashCommandBuilder().setName('clear').setDescription('Clear the upcoming queue'),
  new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the current voice channel'),
].map((command) => command.toJSON());

async function registerSlashCommands(client, guildId) {
  if (!guildId) throw new Error('GUILD_ID is required to register guild slash commands.');

  const existing = await client.application.commands.fetch({ guildId });
  for (const definition of commandDefinitions) {
    const previous = existing.find((command) => command.name === definition.name);
    if (previous) {
      await previous.edit(definition);
    } else {
      await client.application.commands.create(definition, guildId);
    }
  }
}

async function getMemberVoiceChannel(interaction) {
  if (!interaction.guild) return null;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.voice.channel;
}

async function ensureConnected(channel, musicPlayer) {
  if (
    musicPlayer.connectedChannel?.id !== channel.id
    || !musicPlayer.isVoiceReady
  ) {
    await musicPlayer.connect(channel);
  }
}

async function handleSlashCommand(interaction, { musicPlayer, getMaintenanceState }) {
  if (!interaction.isChatInputCommand()) return;

  const maintenance = getMaintenanceState();
  if (maintenance.enabled) {
    const text = `Bot is under maintenance${maintenance.message ? `\n${maintenance.message}` : ''}`;
    return interaction.reply({ content: text, ephemeral: true });
  }

  const respond = async (content) => {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content });
    }
    return interaction.reply({ content, ephemeral: true });
  };

  try {
    switch (interaction.commandName) {
      case 'play': {
        await interaction.deferReply({ ephemeral: true });
        const channel = await getMemberVoiceChannel(interaction);
        if (!channel) return respond('Join a voice channel first, then use `/play` again.');
        await ensureConnected(channel, musicPlayer);
        const track = await musicPlayer.addSong(
          interaction.options.getString('query', true),
          interaction.user.tag
        );
        return respond(`Queued **${track.title}**.`);
      }
      case 'join': {
        await interaction.deferReply({ ephemeral: true });
        const channel = await getMemberVoiceChannel(interaction);
        if (!channel) return respond('Join a voice channel first, then use `/join`.');
        await ensureConnected(channel, musicPlayer);
        return respond(`Joined **${channel.name}**.`);
      }
      case 'leave': {
        if (!musicPlayer.leaveChannel()) return respond('I am not in a voice channel.');
        return respond('Left the voice channel. The upcoming queue is saved.');
      }
      case 'pause':
        return respond(musicPlayer.pause() ? 'Playback paused.' : 'Nothing is playing right now.');
      case 'resume':
        return respond(musicPlayer.resume() ? 'Playback resumed.' : 'Playback is not paused.');
      case 'skip':
        return respond(musicPlayer.skip() ? 'Skipped the current song.' : 'Nothing is playing right now.');
      case 'stop':
        musicPlayer.stopAndLeave();
        return respond('Playback stopped, the queue was cleared, and I left the channel.');
      case 'queue': {
        const upcoming = musicPlayer.queue.slice(0, 20);
        if (!upcoming.length) return respond('The upcoming queue is empty.');
        const lines = upcoming.map((track, index) => `${index + 1}. ${track.title}`);
        if (musicPlayer.queue.length > upcoming.length) {
          lines.push(`…and ${musicPlayer.queue.length - upcoming.length} more.`);
        }
        return respond(`**Upcoming songs**\n${lines.join('\n')}`);
      }
      case 'nowplaying':
        return respond(
          musicPlayer.current
            ? `Now playing: **${musicPlayer.current.title}**`
            : 'Nothing is playing right now.'
        );
      case 'volume': {
        const level = interaction.options.getInteger('level', true);
        musicPlayer.setVolume(level);
        return respond(`Volume set to ${level}%.`);
      }
      case 'loop': {
        const mode = interaction.options.getString('mode', true);
        musicPlayer.setLoopMode(mode);
        return respond(`Loop mode: **${mode}**.`);
      }
      case 'shuffle':
        return respond(
          musicPlayer.shuffle()
            ? 'The upcoming queue has been shuffled.'
            : 'Add at least two songs before shuffling.'
        );
      case 'remove': {
        const position = interaction.options.getInteger('position', true);
        const removed = musicPlayer.removeAt(position - 1);
        return respond(
          removed
            ? `Removed **${removed.title}** from the queue.`
            : `There is no song at queue position ${position}.`
        );
      }
      case 'clear': {
        const count = musicPlayer.clearQueue();
        return respond(count ? `Cleared ${count} upcoming song${count === 1 ? '' : 's'}.` : 'The queue is already empty.');
      }
      default:
        return respond('That command is not available.');
    }
  } catch (err) {
    console.error(`Slash command ${interaction.commandName} failed:`, err.message);
    return respond(`Could not complete that command: ${err.message}`);
  }
}

module.exports = {
  handleSlashCommand,
  registerSlashCommands,
};
