import { CONFIG } from '../game/Config';
import { clamp01 } from '../utils/MathUtils';

/**
 * Speed ramps with time survived; pattern difficulty ramps with distance.
 * Both are monotonic so a long run never gets easier.
 */
export class DifficultySystem {
  elapsed = 0;
  difficulty = 0;
  baseSpeed = CONFIG.movement.initialSpeed;

  reset(): void {
    this.elapsed = 0;
    this.difficulty = 0;
    this.baseSpeed = CONFIG.movement.initialSpeed;
  }

  update(dt: number, distance: number): void {
    const mv = CONFIG.movement;
    this.elapsed += dt;
    this.baseSpeed = Math.min(mv.maxSpeed, mv.initialSpeed + mv.speedAcceleration * this.elapsed);
    this.difficulty = clamp01(distance / CONFIG.difficulty.rampDistance);
  }

  /** 0..1 progress toward max speed, used for camera FOV and audio intensity. */
  get speedProgress(): number {
    const mv = CONFIG.movement;
    return clamp01((this.baseSpeed - mv.initialSpeed) / (mv.maxSpeed - mv.initialSpeed));
  }
}
