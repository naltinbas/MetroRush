import { CONFIG } from '../game/Config';
import type { EventBus } from '../utils/EventBus';

/**
 * score += distance * multiplier
 * score += shardValue * multiplier
 * score += nearMissBonus * multiplier
 * score += timeRate * dt * multiplier
 * multiplier = baseMultiplier(distance milestones) * amplifier
 */
export class ScoreSystem {
  score = 0;
  distance = 0;
  shards = 0;
  streak = 0;
  nearMisses = 0;
  elapsed = 0;
  baseMultiplier = 1;
  effectMultiplier = 1;

  constructor(private readonly events: EventBus) {}

  get multiplier(): number {
    return this.baseMultiplier * this.effectMultiplier;
  }

  reset(): void {
    this.score = 0;
    this.distance = 0;
    this.shards = 0;
    this.streak = 0;
    this.nearMisses = 0;
    this.elapsed = 0;
    this.baseMultiplier = 1;
    this.effectMultiplier = 1;
  }

  update(dt: number, distanceDelta: number, effectMultiplier: number): void {
    const cfg = CONFIG.score;
    const before = this.multiplier;
    this.distance += distanceDelta;
    this.elapsed += dt;
    this.effectMultiplier = effectMultiplier;
    this.baseMultiplier = Math.min(cfg.maxBaseMultiplier, 1 + Math.floor(this.distance / cfg.multiplierStep));
    const m = this.multiplier;
    this.score += distanceDelta * cfg.distanceRate * m + cfg.timeRate * dt * m;
    if (m !== before) this.events.emit('multiplierChanged', { multiplier: m });
  }

  addShard(): number {
    this.shards++;
    this.streak++;
    this.score += CONFIG.score.shardValue * this.multiplier;
    return this.streak;
  }

  addNearMiss(): number {
    this.nearMisses++;
    const bonus = CONFIG.score.nearMissBonus * this.multiplier;
    this.score += bonus;
    return bonus;
  }

  penalty(): void {
    this.score = Math.max(0, this.score - CONFIG.score.stumblePenalty);
    this.streak = 0;
  }
}
