/**
 * Every sound is synthesized on the fly from oscillators and filtered noise.
 * The AudioContext is created lazily on the first user gesture (browsers
 * refuse to start audio before one).
 */

export type SfxName =
  | 'jump'
  | 'land'
  | 'slide'
  | 'lane'
  | 'shard'
  | 'powerup'
  | 'shieldBreak'
  | 'stumble'
  | 'crash'
  | 'gameOver'
  | 'menu'
  | 'nearMiss'
  | 'horn'
  | 'pause'
  | 'expire';

interface ToneOpts {
  freq: number;
  freqEnd?: number;
  type?: OscillatorType;
  duration: number;
  gain?: number;
  attack?: number;
  delay?: number;
  detune?: number;
  filterFreq?: number;
}

interface NoiseOpts {
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  delay?: number;
  attack?: number;
}

// A-minor pentatonic-ish material for the loop; frequencies in Hz.
const BASS_LINE = [55, 55, 0, 55, 65.41, 0, 55, 0, 49, 49, 0, 49, 73.42, 0, 65.41, 0];
const LEAD_LINE = [220, 261.63, 329.63, 261.63, 220, 329.63, 392, 329.63, 196, 246.94, 293.66, 246.94, 196, 293.66, 349.23, 293.66];
const KICK_STEPS = [0, 4, 8, 12, 14];
const HAT_STEPS = [2, 6, 10, 14, 15];
const STEP_SECONDS = 60 / 118 / 4;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterName | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private nextStepTime = 0;
  /** Set while the game is paused so menu clicks cannot wake the context. */
  private paused = false;
  private musicPlaying = false;
  private intensity = 0;

  muted = false;
  sfxVolume = 0.8;
  musicVolume = 0.5;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Call from a user gesture (click / keydown). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 1400;
      this.musicBus = ctx.createGain();
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.master);
      const len = ctx.sampleRate * 1.5;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
      this.applyVolumes();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void {
    this.paused = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    this.paused = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * 0.9, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.32, t, 0.05);
  }

  /** 0 = calm, 1 = sprint. Opens the music filter and brightens the loop. */
  setMusicIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (this.ctx && this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(1400 + this.intensity * 5200, this.ctx.currentTime, 0.15);
    }
  }

  // ---- primitives -------------------------------------------------------

  private tone(o: ToneOpts, bus: GainNode | null = this.sfxBus): void {
    if (!this.ctx || !bus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + o.duration);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const attack = o.attack ?? 0.005;
    const peak = o.gain ?? 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
    let last: AudioNode = osc;
    if (o.filterFreq) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filterFreq;
      last.connect(f);
      last = f;
    }
    last.connect(g);
    g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + o.duration + 0.02);
  }

  private noise(o: NoiseOpts, bus: GainNode | null = this.sfxBus): void {
    if (!this.ctx || !this.noiseBuffer || !bus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t0 + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(t0);
    src.stop(t0 + o.duration + 0.02);
  }

  // ---- effects ----------------------------------------------------------

  play(name: SfxName, pitch = 1): void {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'jump':
        this.tone({ freq: 320 * pitch, freqEnd: 720 * pitch, type: 'triangle', duration: 0.18, gain: 0.22 });
        this.noise({ duration: 0.1, gain: 0.05, filter: 'highpass', freq: 2500 });
        break;
      case 'land':
        this.tone({ freq: 140, freqEnd: 70, type: 'sine', duration: 0.09, gain: 0.16 });
        break;
      case 'slide':
        this.noise({ duration: 0.28, gain: 0.16, filter: 'lowpass', freq: 2200, freqEnd: 400, q: 0.8 });
        break;
      case 'lane':
        this.noise({ duration: 0.12, gain: 0.11, filter: 'bandpass', freq: 900, freqEnd: 2600, q: 1.6 });
        this.tone({ freq: 500, freqEnd: 640, type: 'sine', duration: 0.07, gain: 0.06 });
        break;
      case 'shard':
        this.tone({ freq: 880 * pitch, freqEnd: 1320 * pitch, type: 'sine', duration: 0.11, gain: 0.14 });
        this.tone({ freq: 1760 * pitch, type: 'sine', duration: 0.08, gain: 0.05, delay: 0.03 });
        break;
      case 'powerup':
        this.tone({ freq: 523, type: 'square', duration: 0.12, gain: 0.08, filterFreq: 2500 });
        this.tone({ freq: 659, type: 'square', duration: 0.12, gain: 0.08, delay: 0.09, filterFreq: 2500 });
        this.tone({ freq: 784, type: 'square', duration: 0.12, gain: 0.08, delay: 0.18, filterFreq: 2500 });
        this.tone({ freq: 1046, type: 'triangle', duration: 0.3, gain: 0.12, delay: 0.27 });
        break;
      case 'expire':
        this.tone({ freq: 660, freqEnd: 440, type: 'triangle', duration: 0.2, gain: 0.08 });
        break;
      case 'shieldBreak':
        this.noise({ duration: 0.35, gain: 0.22, filter: 'highpass', freq: 3000, freqEnd: 1200 });
        this.tone({ freq: 900, freqEnd: 180, type: 'sawtooth', duration: 0.35, gain: 0.12, filterFreq: 3000 });
        break;
      case 'stumble':
        this.tone({ freq: 160, freqEnd: 90, type: 'triangle', duration: 0.14, gain: 0.18 });
        this.noise({ duration: 0.12, gain: 0.1, filter: 'lowpass', freq: 1200 });
        break;
      case 'crash':
        this.tone({ freq: 90, freqEnd: 30, type: 'sine', duration: 0.45, gain: 0.5 });
        this.noise({ duration: 0.4, gain: 0.3, filter: 'lowpass', freq: 3000, freqEnd: 200 });
        this.noise({ duration: 0.18, gain: 0.15, filter: 'highpass', freq: 4000 });
        break;
      case 'gameOver':
        this.tone({ freq: 440, type: 'triangle', duration: 0.35, gain: 0.14, delay: 0.1 });
        this.tone({ freq: 349.2, type: 'triangle', duration: 0.35, gain: 0.14, delay: 0.38 });
        this.tone({ freq: 261.6, type: 'triangle', duration: 0.7, gain: 0.16, delay: 0.66 });
        this.tone({ freq: 130.8, type: 'sine', duration: 0.9, gain: 0.14, delay: 0.66 });
        break;
      case 'menu':
        this.tone({ freq: 640, type: 'triangle', duration: 0.06, gain: 0.1 });
        this.tone({ freq: 960, type: 'triangle', duration: 0.08, gain: 0.06, delay: 0.03 });
        break;
      case 'pause':
        this.tone({ freq: 520, freqEnd: 390, type: 'triangle', duration: 0.12, gain: 0.1 });
        break;
      case 'nearMiss':
        this.noise({ duration: 0.16, gain: 0.14, filter: 'bandpass', freq: 3200, freqEnd: 600, q: 2 });
        this.tone({ freq: 1500, freqEnd: 2200, type: 'sine', duration: 0.1, gain: 0.05 });
        break;
      case 'horn':
        this.tone({ freq: 392, type: 'sawtooth', duration: 0.45, gain: 0.09, filterFreq: 1800 });
        this.tone({ freq: 311, type: 'sawtooth', duration: 0.45, gain: 0.09, filterFreq: 1800, detune: 6 });
        this.tone({ freq: 392, type: 'sawtooth', duration: 0.3, gain: 0.08, filterFreq: 1800, delay: 0.55 });
        this.tone({ freq: 311, type: 'sawtooth', duration: 0.3, gain: 0.08, filterFreq: 1800, delay: 0.55, detune: 6 });
        break;
    }
  }

  // ---- music ------------------------------------------------------------

  startMusic(): void {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 30);
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicBus) return;
    const lookahead = 0.15;
    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.playStep(this.musicStep, this.nextStepTime - this.ctx.currentTime);
      this.nextStepTime += STEP_SECONDS;
      this.musicStep = (this.musicStep + 1) % 32;
    }
  }

  private playStep(step: number, delay: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const bass = BASS_LINE[s];
    if (bass > 0) {
      this.tone({ freq: bass, type: 'sawtooth', duration: STEP_SECONDS * 1.8, gain: 0.2, delay, filterFreq: 420 + this.intensity * 500 }, this.musicBus);
      this.tone({ freq: bass * 2, type: 'triangle', duration: STEP_SECONDS * 1.2, gain: 0.08, delay }, this.musicBus);
    }
    const lead = LEAD_LINE[s] * (bar === 1 ? 1.5 : 1);
    if (s % 2 === 0 || this.intensity > 0.5) {
      this.tone({ freq: lead, type: 'square', duration: STEP_SECONDS * 0.9, gain: 0.05 + this.intensity * 0.03, delay, filterFreq: 1800 }, this.musicBus);
    }
    if (KICK_STEPS.includes(s)) {
      this.tone({ freq: 150, freqEnd: 40, type: 'sine', duration: 0.16, gain: 0.5, delay }, this.musicBus);
    }
    if (HAT_STEPS.includes(s)) {
      this.noise({ duration: 0.05, gain: 0.05, filter: 'highpass', freq: 7000, delay }, this.musicBus);
    }
    if (s === 8 || s === 0) {
      this.noise({ duration: 0.12, gain: 0.06, filter: 'bandpass', freq: 1800, q: 0.6, delay }, this.musicBus);
    }
  }
}

type BiquadFilterName = BiquadFilterNode;
