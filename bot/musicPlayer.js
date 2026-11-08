// musicPlayer.js
// Handles the song queue and playback for ONE voice channel using @discordjs/voice.
// Keeping this in its own small class makes it easy to read and to control
// from both Discord commands AND the website (via server.js -> io events).

const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const play = require('play-dl');

class MusicPlayer {
  constructor(io) {
    this.io = io; // socket.io server, used to push live updates to the website
    this.queue = []; // array of { title, url, requestedBy }
    this.player = createAudioPlayer();
    this.connection = null;
    this.current = null; // currently playing track
    this.volume = 1; // 0.0 - 2.0
    this.resource = null;

    this.player.on(AudioPlayerStatus.Idle, () => {
      // Finished a track (or nothing was playing) -> play the next one
      this.current = null;
      this._playNext();
    });

    this.player.on('error', (err) => {
      console.error('Audio player error:', err.message);
      this.current = null;
      this._playNext();
    });
  }

  // Connect the bot to a voice channel. Call this once at startup.
  async connect(channel) {
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.connection.subscribe(this.player);
    console.log(`Joined voice channel: ${channel.name}`);
  }

  // Add a song by URL or search text. Returns the track that was queued.
  async addSong(query, requestedBy = 'web') {
    let url = query;
    let title = query;

    const isUrl = /^https?:\/\//i.test(query);

    if (!isUrl) {
      // Treat it as a search term
      const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
      if (!results.length) throw new Error('No results found for that search.');
      url = results[0].url;
      title = results[0].title;
    } else {
      const info = await play.video_basic_info(url);
      title = info.video_details.title;
    }

    const track = { title, url, requestedBy };
    this.queue.push(track);
    this._broadcastState();

    // If nothing is playing right now, start immediately
    if (!this.current) {
      this._playNext();
    }

    return track;
  }

  skip() {
    // Stopping the player triggers the "Idle" event above, which plays the next track
    this.player.stop();
  }

  pause() {
    this.player.pause();
    this._broadcastState();
  }

  resume() {
    this.player.unpause();
    this._broadcastState();
  }

  clearQueue() {
    this.queue = [];
    this._broadcastState();
  }

  removeAt(index) {
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      this._broadcastState();
    }
  }

  getState() {
    return {
      current: this.current,
      queue: this.queue,
      status: this.player.state.status,
    };
  }

  async _playNext() {
    const next = this.queue.shift();
    if (!next) {
      this._broadcastState();
      return;
    }

    try {
      const stream = await play.stream(next.url);
      this.resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
      });
      this.resource.volume.setVolume(this.volume);
      this.player.play(this.resource);
      this.current = next;
    } catch (err) {
      console.error('Failed to play track:', next.title, err.message);
      this.current = null;
      this._playNext(); // try the next song instead of getting stuck
    }

    this._broadcastState();
  }

  _broadcastState() {
    if (this.io) {
      this.io.emit('state', this.getState());
    }
  }
}

module.exports = MusicPlayer;
