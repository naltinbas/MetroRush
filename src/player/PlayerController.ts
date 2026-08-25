import { CONFIG, laneX } from '../game/Config';
import type { InputManager } from '../game/InputManager';
import type { EventBus } from '../utils/EventBus';
import { easeOutCubic, lerp } from '../utils/MathUtils';
import { PlayerModel } from './PlayerModel';
import { PlayerState } from './PlayerState';

export type GraceKind = 'none' | 'stumble' | 'shield';

/**
 * Player simulation. The player never moves forward: the world scrolls past.
 * Everything here is lateral (lane) and vertical (jump/slide) motion plus the
 * state bookkeeping collision needs.
 */
export class PlayerController {
  readonly model = new PlayerModel();

  x = 0;
  y = 0;
  vy = 0;
  lane: number;
  targetLane: number;
  private laneStartX = 0;
  private laneT = 1;
  laneChanging = false;
  private laneDir = 0;
  lateralVelocity = 0;

  airborne = false;
  sliding = false;
  private slideTimer = 0;
  private slideQueued = false;
  private stumbleTimer = 0;
  private graceTimer = 0;
  graceKind: GraceKind = 'none';
  crashed = false;
  crashTimer = 0;
  private runPhase = 0;
  private time = 0;
  /** Set by PowerUpManager; makes small obstacles auto-jump. */
  autoHopArmed = false;

  constructor(private readonly events: EventBus) {
    this.lane = Math.floor(CONFIG.lanes.count / 2);
    this.targetLane = this.lane;
    this.x = laneX(this.lane);
    this.model.root.position.set(this.x, 0, 0);
  }

  get height(): number {
    return this.sliding ? CONFIG.player.slideHeight : CONFIG.player.height;
  }

  get state(): PlayerState {
    if (this.crashed) return PlayerState.CRASHED;
    if (this.graceKind === 'shield' && this.graceTimer > 0) return PlayerState.REVIVING;
    if (this.stumbleTimer > 0) return PlayerState.STUMBLING;
    if (this.sliding) return PlayerState.SLIDING;
    if (this.airborne) return this.vy > 0 ? PlayerState.JUMPING : PlayerState.FALLING;
    if (this.laneChanging) return this.laneDir < 0 ? PlayerState.LANE_CHANGE_LEFT : PlayerState.LANE_CHANGE_RIGHT;
    return PlayerState.RUNNING;
  }

  get stumbling(): boolean {
    return this.stumbleTimer > 0;
  }

  /** 1 = full speed. Drops during a stumble and recovers over stumbleDuration. */
  get speedFactor(): number {
    if (this.stumbleTimer <= 0) return 1;
    const t = 1 - this.stumbleTimer / CONFIG.movement.stumbleDuration;
    return lerp(CONFIG.movement.stumbleSpeedFactor, 1, t);
  }

  get invulnerable(): boolean {
    return this.graceKind === 'shield' && this.graceTimer > 0;
  }

  get clutterProtected(): boolean {
    return this.graceTimer > 0;
  }

  reset(): void {
    this.lane = Math.floor(CONFIG.lanes.count / 2);
    this.targetLane = this.lane;
    this.x = laneX(this.lane);
    this.y = 0;
    this.vy = 0;
    this.laneT = 1;
    this.laneChanging = false;
    this.lateralVelocity = 0;
    this.airborne = false;
    this.sliding = false;
    this.slideTimer = 0;
    this.slideQueued = false;
    this.stumbleTimer = 0;
    this.graceTimer = 0;
    this.graceKind = 'none';
    this.crashed = false;
    this.crashTimer = 0;
    this.autoHopArmed = false;
    this.model.resetPose();
    this.model.root.position.set(this.x, 0, 0);
  }

  // ---- actions ----------------------------------------------------------

  changeLane(dir: number): boolean {
    if (this.crashed) return false;
    const next = this.targetLane + dir;
    if (next < 0 || next >= CONFIG.lanes.count) return false;
    this.targetLane = next;
    this.laneStartX = this.x;
    this.laneT = 0;
    this.laneChanging = true;
    this.laneDir = dir;
    this.events.emit('laneChange', { dir });
    return true;
  }

  jump(auto = false): boolean {
    if (this.crashed || this.airborne) return false;
    if (this.sliding) this.endSlide();
    this.vy = CONFIG.movement.jumpVelocity;
    this.airborne = true;
    this.y = Math.max(this.y, 0.001);
    if (!auto) this.events.emit('jump', {});
    else this.events.emit('jump', {});
    return true;
  }

  slide(): boolean {
    if (this.crashed || this.sliding) return false;
    if (this.airborne) {
      // Fast-fall, then slide on landing.
      this.vy = Math.min(this.vy, CONFIG.movement.fastFallVelocity);
      this.slideQueued = true;
      return true;
    }
    this.sliding = true;
    this.slideTimer = CONFIG.movement.slideDuration;
    this.events.emit('slide', {});
    return true;
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideTimer = 0;
  }

  stumble(): void {
    if (this.crashed) return;
    this.stumbleTimer = CONFIG.movement.stumbleDuration;
    this.graceTimer = CONFIG.player.graceAfterStumble;
    this.graceKind = 'stumble';
    this.events.emit('stumble', { x: this.x, y: this.y + 1, z: 0 });
  }

  /** Called when the shield absorbed a hit: short full invulnerability. */
  shieldGrace(): void {
    this.graceTimer = CONFIG.player.graceAfterShield;
    this.graceKind = 'shield';
    this.model.pulseShield();
  }

  crash(): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = 0;
    this.sliding = false;
    this.laneChanging = false;
    this.events.emit('crash', { x: this.x, y: this.y + 1, z: 0 });
  }

  // ---- simulation ---------------------------------------------------------

  update(dt: number, input: InputManager | null, speed: number): void {
    this.time += dt;
    const prevX = this.x;

    if (this.crashed) {
      this.crashTimer += dt;
      this.animate(dt);
      return;
    }

    if (input) this.readInput(input);

    // Lane interpolation (ease-out so the start is snappy).
    if (this.laneChanging) {
      this.laneT += dt / CONFIG.movement.laneChangeDuration;
      const k = easeOutCubic(Math.min(1, this.laneT));
      this.x = lerp(this.laneStartX, laneX(this.targetLane), k);
      if (this.laneT >= 1) {
        this.x = laneX(this.targetLane);
        this.laneChanging = false;
        this.lane = this.targetLane;
      }
    }
    this.lateralVelocity = dt > 0 ? (this.x - prevX) / dt : 0;

    // Vertical motion.
    if (this.airborne) {
      this.vy += CONFIG.movement.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.events.emit('land', {});
        if (this.slideQueued) {
          this.slideQueued = false;
          this.slide();
        }
      }
    }

    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.endSlide();
    }
    if (this.stumbleTimer > 0) this.stumbleTimer -= dt;
    if (this.graceTimer > 0) {
      this.graceTimer -= dt;
      if (this.graceTimer <= 0) this.graceKind = 'none';
    }

    this.runPhase += (speed / 1.9) * dt;
    this.animate(dt);
  }

  private readInput(input: InputManager): void {
    const buffer = CONFIG.player.inputBuffer;
    if (input.consume('left', buffer)) this.changeLane(-1);
    if (input.consume('right', buffer)) this.changeLane(1);
    // Jump stays buffered while airborne so a press just before landing fires.
    if (!this.airborne && input.consume('jump', buffer)) this.jump();
    if (input.consume('slide', buffer)) this.slide();
  }

  private animate(dt: number): void {
    this.model.root.position.set(this.x, this.y, 0);
    this.model.animate(dt, {
      runPhase: this.runPhase,
      airborne: this.airborne,
      vy: this.vy,
      sliding: this.sliding,
      slideT: this.sliding ? 1 - this.slideTimer / CONFIG.movement.slideDuration : 0,
      stumbleT: this.stumbleTimer > 0 ? 1 - this.stumbleTimer / CONFIG.movement.stumbleDuration : 0,
      crashed: this.crashed,
      crashT: this.crashTimer,
      lateralVel: this.lateralVelocity,
      invulnerable: this.invulnerable,
      time: this.time,
    });
  }

  /** Idle animation for the menu backdrop. */
  idle(dt: number, speed: number): void {
    this.time += dt;
    this.runPhase += (speed / 1.9) * dt;
    this.lateralVelocity = 0;
    this.animate(dt);
  }
}
