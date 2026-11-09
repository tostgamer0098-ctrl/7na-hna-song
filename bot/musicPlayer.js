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
  StreamType,
  entersState,
} = require('@discordjs/voice');
const { Ytdl, Quality } = require('@distube/ytdl-core');

class MusicPlayer {
  constructor(io) {
    this.io = io; // socket.io server, used to push live updates to the website
    this.queue = []; // array of { title, url, requestedBy }
    this.player = createAudioPlayer();
    this.connection = null;
    this.subscription = null;
    this.connectedChannel = null;
    this.connectionStatus = VoiceConnectionStatus.Disconnected;
    this.isVoiceReady = false;
    this.current = null; // currently playing track
    this.volume = 100;
    this.loopMode = 'off';
    this.resource = null;
    this.isLoading = false;
    this.playbackGeneration = 0;
    this.skipRequested = false;
    this.suppressAutoAdvance = false;
    this.maintenanceState = { enabled: false, message: '' };
    this.lastError = null;
    this.youtube = new Ytdl({ timeoutMs: 45_000 });

    this.player.on(AudioPlayerStatus.Idle, () => {
      const finishedTrack = this.current;
      this.current = null;
      const shouldAdvance = !this.suppressAutoAdvance;
      this.suppressAutoAdvance = false;

      if (this.skipRequested) {
        this.skipRequested = false;
      } else if (finishedTrack && this.loopMode === 'song') {
        this.queue.unshift(finishedTrack);
      } else if (finishedTrack && this.loopMode === 'queue') {
        this.queue.push(finishedTrack);
      }

      this._broadcastState();
      if (shouldAdvance) void this._playNext();
    });

    this.player.on('error', (err) => {
      console.error('Audio player error:', err.message);
      this.current = null;
      this.lastError = `Playback error: ${err.message}`;
      void this._playNext();
    });
  }

  // Connect or switch the bot to a voice channel.
  async connect(channel) {
    if (!channel?.isVoiceBased?.()) {
      throw new Error('The selected channel is not a voice channel.');
    }

    this.connectedChannel = null;
    this.lastError = null;
    if (this.connection) {
      this.connection.destroy();
    }
    this.subscription = null;
    this.isVoiceReady = false;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    this.connection = connection;
    this.connectionStatus = connection.state.status;

    connection.on('stateChange', (oldState, newState) => {
      if (this.connection !== connection) return;

      this.connectionStatus = newState.status;
      if (newState.status !== VoiceConnectionStatus.Ready) {
        this.isVoiceReady = false;
      } else if (this.subscription) {
        this.isVoiceReady = true;
        this.lastError = null;
        void this._playNext();
      }

      console.log(`Discord voice connection: ${oldState.status} -> ${newState.status}`);
      this._broadcastState();
    });

    connection.on('error', (err) => {
      if (this.connection !== connection) return;
      console.error('Discord voice connection error:', err.message);
      this.lastError = `Discord voice connection error: ${err.message}`;
      this._broadcastState();
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      this.connectionStatus = connection.state.status;
      const detail = err.message === 'The operation was aborted'
        ? 'Timed out waiting for Discord to finish connecting.'
        : err.message;
      this.lastError = `${detail} Check that the bot can view, connect to, and speak in this channel.`;
      this._broadcastState();
      throw new Error(this.lastError);
    }

    this.subscription = connection.subscribe(this.player);
    this.isVoiceReady = true;
    this.connectionStatus = connection.state.status;
    this.connectedChannel = { id: channel.id, name: channel.name };
    this.lastError = null;
    console.log(`Joined voice channel: ${channel.name}`);
    this._broadcastState();
    void this._playNext();
  }

  // Add a song by URL or search text. Returns the track that was queued.
  async addSong(query, requestedBy = 'web') {
    const searchText = String(query || '').trim();
    if (!searchText) throw new Error('Enter a YouTube link or song name.');

    let url = searchText;
    let title = searchText;
    const isUrl = /^https?:\/\//i.test(searchText);

    if (!isUrl) {
      // Treat it as a search term
      const results = await this.youtube.search(searchText, { limit: 1 });
      if (!results.length) throw new Error('No results found for that search.');
      url = results[0].url;
      title = results[0].title;
    } else {
      const info = await this.youtube.getInfo(url);
      title = info.videoDetails.title;
    }

    const track = { title, url, requestedBy };
    this.queue.push(track);
    this.lastError = null;
    this._broadcastState();

    // If nothing is playing right now, start immediately
    if (!this.current && !this.isLoading) {
      void this._playNext();
    }

    return track;
  }

  skip() {
    if (!this.current && !this.isLoading) return false;

    this.playbackGeneration += 1;
    this.isLoading = false;
    this.skipRequested = true;
    const stopped = this.player.stop(true);
    if (!stopped) {
      this.skipRequested = false;
      if (this.queue.length) void this._playNext();
    }
    return true;
  }

  pause() {
    const paused = this.player.pause();
    this._broadcastState();
    return paused;
  }

  resume() {
    const resumed = this.player.unpause();
    this._broadcastState();
    return resumed;
  }

  togglePause() {
    if (
      this.player.state.status === AudioPlayerStatus.Paused
      || this.player.state.status === AudioPlayerStatus.AutoPaused
    ) {
      return this.resume();
    }
    return this.pause();
  }

  setVolume(value) {
    const volume = Number(value);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw new Error('Volume must be a whole number from 0 to 100.');
    }
    this.volume = volume;
    if (this.resource?.volume) this.resource.volume.setVolume(volume / 100);
    this._broadcastState();
    return this.volume;
  }

  setLoopMode(mode) {
    if (!['off', 'song', 'queue'].includes(mode)) {
      throw new Error('Loop mode must be off, song, or queue.');
    }
    this.loopMode = mode;
    this._broadcastState();
    return this.loopMode;
  }

  shuffle() {
    if (this.queue.length < 2) return false;
    for (let index = this.queue.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[swapIndex]] = [this.queue[swapIndex], this.queue[index]];
    }
    this._broadcastState();
    return true;
  }

  stopPlayback({ clearQueue = false } = {}) {
    this.playbackGeneration += 1;
    this.isLoading = false;
    this.current = null;
    this.resource = null;
    this.lastError = null;
    if (clearQueue) this.queue = [];

    this.suppressAutoAdvance = true;
    const stopped = this.player.stop(true);
    if (!stopped) this.suppressAutoAdvance = false;
    this._broadcastState();
  }

  leaveChannel({ clearQueue = false } = {}) {
    const wasConnected = Boolean(this.connection || this.connectedChannel);
    this.isVoiceReady = false;
    this.stopPlayback({ clearQueue });

    if (this.connection) this.connection.destroy();
    this.connection = null;
    this.subscription = null;
    this.connectedChannel = null;
    this.connectionStatus = VoiceConnectionStatus.Disconnected;
    this._broadcastState();
    return wasConnected;
  }

  stopAndLeave() {
    this.leaveChannel({ clearQueue: true });
  }

  setMaintenanceState(state) {
    this.maintenanceState = {
      enabled: Boolean(state?.enabled),
      message: typeof state?.message === 'string' ? state.message : '',
    };
    this._broadcastState();
  }

  clearQueue() {
    const count = this.queue.length;
    this.queue = [];
    this._broadcastState();
    return count;
  }

  removeAt(index) {
    if (index >= 0 && index < this.queue.length) {
      const [removed] = this.queue.splice(index, 1);
      this._broadcastState();
      return removed;
    }
    return null;
  }

  getState() {
    return {
      current: this.current,
      queue: this.queue,
      status: this.player.state.status,
      volume: this.volume,
      loopMode: this.loopMode,
      voiceStatus: this.connectionStatus,
      voiceChannel: this.connectedChannel,
      maintenance: this.maintenanceState,
      error: this.lastError,
    };
  }

  async _playNext() {
    if (this.isLoading || this.current) return;

    if (!this.isVoiceReady || this.connection?.state.status !== VoiceConnectionStatus.Ready) {
      this.lastError = 'Join a Discord voice channel before starting playback.';
      this._broadcastState();
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      this._broadcastState();
      return;
    }

    const generation = this.playbackGeneration;
    this.isLoading = true;
    this._broadcastState();

    try {
      const info = await this.youtube.getInfo(next.url);
      if (generation !== this.playbackGeneration) return;
      const stream = this.youtube.download(info, {
        quality: Quality.HighestAudio,
        filter: { hasAudio: true, hasVideo: false },
      });
      this.resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });
      this.resource.volume.setVolume(this.volume / 100);
      this.player.play(this.resource);
      this.current = next;
      this.lastError = null;
    } catch (err) {
      if (generation === this.playbackGeneration) {
        console.error('Failed to play track:', next.title, err.message);
        this.current = null;
        this.lastError = `Failed to play "${next.title}": ${err.message}`;
      }
    } finally {
      if (generation === this.playbackGeneration) {
        this.isLoading = false;
        this._broadcastState();
      }
    }

    if (generation === this.playbackGeneration && !this.current && this.queue.length) {
      void this._playNext();
    }
  }

  _broadcastState() {
    if (this.io) {
      this.io.emit('state', this.getState());
    }
  }
}

module.exports = MusicPlayer;
