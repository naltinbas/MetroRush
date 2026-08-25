import * as THREE from 'three';
import { PowerUpManager } from '../entities/PowerUpManager';
import { POWER_UP_DEFS } from '../entities/PowerUpDefinitions';
import { PlayerController } from '../player/PlayerController';
import { CameraController } from '../systems/CameraController';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DifficultySystem } from '../systems/DifficultySystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import { ScoreSystem } from '../systems/ScoreSystem';
import { UIManager } from '../ui/UIManager';
import { EventBus } from '../utils/EventBus';
import { damp } from '../utils/MathUtils';
import { WorldManager } from '../world/WorldManager';
import { AudioManager } from './AudioManager';
import { applyQuality, CONFIG, type QualityLevel, type ThemeId } from './Config';
import { GameState } from './GameState';
import { InputManager } from './InputManager';
import { SaveManager } from './SaveManager';

/**
 * Wires every system together and owns the state machine:
 * MENU -> PLAYING <-> PAUSED, PLAYING -> GAME_OVER -> PLAYING | MENU.
 */
export class Game {
  state: GameState = GameState.MENU;

  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cameraController: CameraController;
  readonly events = new EventBus();
  readonly input = new InputManager();
  readonly audio = new AudioManager();
  readonly save = new SaveManager();
  readonly ui: UIManager;
  readonly player: PlayerController;
  readonly world: WorldManager;
  readonly powerUps: PowerUpManager;
  readonly score: ScoreSystem;
  readonly difficulty = new DifficultySystem();
  readonly particles: ParticleSystem;
  readonly collision: CollisionSystem;

  private speed = 0;
  private lastFrame = 0;
  private crashTimer = 0;
  private gameOverShownAt = 0;
  private elapsed = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private dustTimer = 0;
  private running = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = this.createRenderer();
    this.container.appendChild(this.renderer.domElement);
    this.cameraController = new CameraController(window.innerWidth / window.innerHeight);

    this.player = new PlayerController(this.events);
    this.scene.add(this.player.model.root);
    this.world = new WorldManager(this.scene, this.events);
    this.powerUps = new PowerUpManager(this.events, this.player);
    this.score = new ScoreSystem(this.events);
    this.particles = new ParticleSystem();
    this.scene.add(this.particles.mesh);
    this.collision = new CollisionSystem(this.scene, this.player, this.world, this.powerUps, this.score, this.events);
    this.collision.setDebug(CONFIG.debug.showColliders);

    this.world.setSpawnContext(() => ({
      difficulty: this.difficulty.difficulty,
      speed: this.state === GameState.PLAYING ? this.difficulty.baseSpeed : CONFIG.movement.initialSpeed,
      attract: this.state === GameState.MENU,
    }));

    this.ui = new UIManager({
      onPlay: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onMainMenu: () => this.toMenu(),
      onToggleSound: () => this.toggleSound(),
      onSfxVolume: (v) => {
        this.audio.init();
        this.audio.setSfxVolume(v);
        this.save.set('sfxVolume', v);
      },
      onMusicVolume: (v) => {
        this.audio.init();
        this.audio.setMusicVolume(v);
        this.save.set('musicVolume', v);
      },
      onQuality: (q) => this.setQuality(q),
      onTheme: (t) => this.setTheme(t),
      onMenuSound: () => {
        this.audio.init();
        this.audio.play('menu');
      },
    });

    this.applySavedSettings();
    this.bindEvents();
    this.world.reset(CONFIG.debug.seed ?? undefined);
    this.ui.showScreen('menu');
    this.ui.showDebug(CONFIG.debug.enabled);
    this.ui.updateMenuStats(this.save.get('bestScore'), this.save.get('bestDistance'), this.save.get('runs'));

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === GameState.PLAYING) this.pause();
    });
    this.onResize();
  }

  private createRenderer(): THREE.WebGLRenderer {
    const canvas = document.createElement('canvas');
    const probe = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!probe) throw new Error('WebGL is not available in this browser.');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = CONFIG.render.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
  }

  private applySavedSettings(): void {
    const quality = CONFIG.quality !== 'high' ? CONFIG.quality : this.save.get('quality');
    applyQuality(quality);
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.world.configureShadows();
    const savedTheme = this.save.get('theme') as ThemeId;
    const theme = new URLSearchParams(location.search).get('theme') ? CONFIG.theme : savedTheme;
    if (theme && theme !== CONFIG.theme) this.world.applyTheme(theme);
    this.audio.muted = this.save.get('muted');
    this.audio.sfxVolume = this.save.get('sfxVolume');
    this.audio.musicVolume = this.save.get('musicVolume');
    this.ui.syncSettings(this.audio.muted, this.audio.sfxVolume, this.audio.musicVolume, CONFIG.quality, CONFIG.theme);
  }

  private bindEvents(): void {
    const ev = this.events;
    ev.on('shardCollected', ({ x, y, z, streak }) => {
      this.audio.play('shard', 1 + Math.min(streak, 24) * 0.02);
      this.particles.shardBurst(x, y, z);
    });
    ev.on('powerUpCollected', ({ id, x, y, z }) => {
      const def = POWER_UP_DEFS[id as keyof typeof POWER_UP_DEFS];
      this.audio.play('powerup');
      this.particles.pickupBurst(x, y, z, def ? def.color : 0xffffff);
      this.ui.float(def ? def.name : id, 'good');
    });
    ev.on('powerUpExpired', () => this.audio.play('expire'));
    ev.on('shieldBroken', ({ x, y, z }) => {
      this.audio.play('shieldBreak');
      this.cameraController.shake(0.6);
      this.particles.shieldBurst(x, y, z);
      this.ui.float('Shield absorbed the hit', 'neutral');
    });
    ev.on('stumble', ({ x, y, z }) => {
      this.audio.play('stumble');
      this.cameraController.shake(0.35);
      this.particles.sparks(x, y, z, false);
      this.ui.float(`-${CONFIG.score.stumblePenalty}`, 'bad');
    });
    ev.on('crash', ({ x, y, z }) => {
      this.audio.play('crash');
      this.cameraController.shake(1.0);
      this.particles.sparks(x, y, z, true);
      this.crashTimer = 0;
    });
    ev.on('nearMiss', ({ bonus }) => {
      this.audio.play('nearMiss');
      this.cameraController.shake(0.12);
      this.ui.float(`Near miss +${Math.round(bonus)}`, 'good');
    });
    ev.on('laneChange', () => this.audio.play('lane'));
    ev.on('jump', () => this.audio.play('jump'));
    ev.on('slide', () => this.audio.play('slide'));
    ev.on('land', () => this.audio.play('land'));
    ev.on('tramHorn', () => this.audio.play('horn'));
    ev.on('multiplierChanged', ({ multiplier }) => {
      if (this.state === GameState.PLAYING) this.ui.float(`Multiplier x${multiplier}`, 'good');
    });
  }

  // ---- state transitions --------------------------------------------------------

  startRun(): void {
    this.audio.init();
    this.state = GameState.PLAYING;
    this.player.reset();
    this.powerUps.reset();
    this.score.reset();
    this.difficulty.reset();
    this.particles.clear();
    this.cameraController.reset();
    this.speed = CONFIG.movement.initialSpeed;
    this.crashTimer = 0;
    this.elapsed = 0;
    this.world.reset(CONFIG.debug.seed ?? undefined);
    this.input.clear();
    this.audio.resume();
    this.audio.startMusic();
    this.audio.setMusicIntensity(0);
    this.ui.showScreen('hud');
    this.ui.updateHud({ score: 0, distance: 0, shards: 0, multiplier: 1, effects: [] });
  }

  pause(): void {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.audio.play('pause');
    this.audio.suspend();
    this.ui.showScreen('pause');
  }

  resume(): void {
    if (this.state !== GameState.PAUSED) return;
    this.state = GameState.PLAYING;
    this.input.clear();
    this.audio.resume();
    this.ui.showScreen('hud');
    this.lastFrame = performance.now();
  }

  private gameOver(): void {
    this.state = GameState.GAME_OVER;
    this.gameOverShownAt = performance.now();
    this.audio.play('gameOver');
    this.audio.stopMusic();
    const result = this.save.recordRun(this.score.score, this.score.distance, this.score.shards);
    this.ui.showGameOver({
      score: this.score.score,
      distance: this.score.distance,
      shards: this.score.shards,
      bestScore: this.save.get('bestScore'),
      bestDistance: this.save.get('bestDistance'),
      newBestScore: result.newBestScore,
      newBestDistance: result.newBestDistance,
    });
    this.ui.updateMenuStats(this.save.get('bestScore'), this.save.get('bestDistance'), this.save.get('runs'));
    this.input.clear();
  }

  toMenu(): void {
    this.state = GameState.MENU;
    this.audio.stopMusic();
    this.audio.resume();
    this.player.reset();
    this.powerUps.reset();
    this.particles.clear();
    this.cameraController.reset();
    this.speed = CONFIG.movement.menuIdleSpeed;
    this.world.reset(CONFIG.debug.seed ?? undefined);
    this.input.clear();
    this.ui.showScreen('menu');
  }

  private toggleSound(): boolean {
    this.audio.init();
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    this.save.set('muted', muted);
    return muted;
  }

  private setQuality(q: QualityLevel): void {
    applyQuality(q);
    this.save.set('quality', q);
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.world.configureShadows();
    // Materials compiled with shadows need a recompile when the flag flips.
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
    this.onResize();
  }

  private setTheme(t: ThemeId): void {
    this.world.applyTheme(t);
    this.save.set('theme', t);
  }

  // ---- loop ----------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.input.attach();
    this.lastFrame = performance.now();
    this.speed = CONFIG.movement.menuIdleSpeed;
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));
    // Cap large deltas (tab switches, hitches) so physics never explodes.
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
    this.update(dt);
    this.renderer.render(this.scene, this.cameraController.camera);
    if (CONFIG.debug.enabled) this.updateDebug();
  }

  private update(dt: number): void {
    this.handleGlobalInput();
    switch (this.state) {
      case GameState.MENU:
        this.updateMenu(dt);
        break;
      case GameState.PLAYING:
        this.updatePlaying(dt);
        break;
      case GameState.PAUSED:
        break;
      case GameState.GAME_OVER:
        this.updateGameOver(dt);
        break;
    }
  }

  private handleGlobalInput(): void {
    const input = this.input;
    if (this.ui.controlsOpen) {
      input.clear();
      return;
    }
    switch (this.state) {
      case GameState.MENU:
        if (input.consume('confirm', 0.3)) this.startRun();
        input.consume('pause', 0);
        break;
      case GameState.PLAYING:
        if (input.consume('pause', 0.3)) this.pause();
        input.consume('confirm', 0);
        input.consume('restart', 0);
        break;
      case GameState.PAUSED:
        if (input.consume('pause', 0.3) || input.consume('confirm', 0.3)) this.resume();
        else if (input.consume('restart', 0.3)) this.startRun();
        break;
      case GameState.GAME_OVER:
        if (performance.now() - this.gameOverShownAt > 350) {
          if (input.consume('confirm', 0.3) || input.consume('restart', 0.3)) this.startRun();
        } else {
          input.clear();
        }
        break;
    }
  }

  private updateMenu(dt: number): void {
    this.elapsed += dt;
    this.speed = damp(this.speed, CONFIG.movement.menuIdleSpeed, 2, dt);
    this.player.idle(dt, this.speed);
    this.world.update(dt, this.speed);
    this.particles.update(dt, this.speed);
    this.cameraController.update(dt, this.player, this.speed, false, 0);
  }

  private updatePlaying(dt: number): void {
    this.elapsed += dt;
    this.difficulty.update(dt, this.score.distance);
    const sprint = this.powerUps.isActive('sprint');
    if (this.player.crashed) {
      this.speed = damp(this.speed, 0, 6, dt);
      this.crashTimer += dt;
    } else {
      const target = this.difficulty.baseSpeed * this.player.speedFactor + this.powerUps.speedBonus;
      this.speed = damp(this.speed, target, 8, dt);
    }
    const delta = this.speed * dt;

    this.player.update(dt, this.player.crashed ? null : this.input, this.speed);
    this.world.update(dt, this.speed);
    this.collision.update(dt, delta, this.speed);
    this.powerUps.update(dt);
    if (!this.player.crashed) this.score.update(dt, delta, this.powerUps.scoreMultiplier);

    // Effects.
    if (!this.player.airborne && !this.player.crashed) {
      this.dustTimer += dt;
      const interval = 0.06;
      while (this.dustTimer > interval) {
        this.dustTimer -= interval;
        this.particles.dust(this.player.x + (Math.random() - 0.5) * 0.4, 0.3, this.speed);
      }
    }
    if (sprint) this.particles.speedLines(dt, this.speed);
    this.particles.update(dt, this.speed);
    this.cameraController.update(dt, this.player, this.speed, sprint, this.difficulty.speedProgress);
    this.audio.setMusicIntensity(sprint ? 1 : this.difficulty.speedProgress * 0.6);

    this.ui.updateHud({
      score: this.score.score,
      distance: this.score.distance,
      shards: this.score.shards,
      multiplier: this.score.multiplier,
      effects: this.powerUps.list(),
    });

    if (this.player.crashed && this.crashTimer > 1.1) this.gameOver();
  }

  private updateGameOver(dt: number): void {
    this.speed = damp(this.speed, 0, 6, dt);
    this.player.update(dt, null, this.speed);
    this.world.update(dt, this.speed);
    this.particles.update(dt, this.speed);
    this.cameraController.update(dt, this.player, this.speed, false, this.difficulty.speedProgress);
  }

  private updateDebug(): void {
    const seg = this.world.segments.current();
    const info = this.renderer.info.render;
    const gen = this.world.generator;
    const text = [
      `fps ${this.fps}   draw calls ${info.calls}   tris ${info.triangles}`,
      `state ${this.state}   player ${this.player.state}`,
      `speed ${this.speed.toFixed(1)} m/s   base ${this.difficulty.baseSpeed.toFixed(1)}   difficulty ${this.difficulty.difficulty.toFixed(2)}`,
      `lane ${this.player.targetLane}   x ${this.player.x.toFixed(2)}   y ${this.player.y.toFixed(2)}`,
      `segments ${this.world.segments.segments.length}   pattern ${seg?.plan?.patternId ?? '-'}   next ${this.world.segments.segments[1]?.plan?.patternId ?? '-'}`,
      `seed ${gen.seed}   generated ${gen.generated}   rejected ${gen.rejected}`,
      `particles ${this.particles.alive}   pools ${this.world.obstacles.stats()}`,
    ].join('\n');
    this.ui.setDebug(text);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio) * CONFIG.render.resolutionScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.cameraController.resize(w / h);
  }

  dispose(): void {
    this.running = false;
    this.input.detach();
    this.audio.stopMusic();
    this.world.dispose();
    this.particles.dispose();
    this.renderer.dispose();
  }
}
