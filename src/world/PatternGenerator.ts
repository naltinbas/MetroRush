import { isPowerUpId, POWER_UP_IDS, type PowerUpId } from '../entities/PowerUpDefinitions';
import { CONFIG, laneX } from '../game/Config';
import { Random } from '../utils/Random';
import { PATTERNS, patternById, patternWeight, type PatternContext, type SegmentPattern } from './Patterns';
import { ReachabilityValidator } from './ReachabilityValidator';
import { emptyPlan, type MotionSpec, type SegmentPlan } from './SegmentPlan';

export interface GenerationRequest {
  startD: number;
  difficulty: number;
  /** Lowest speed the player can have when reaching the segment. */
  speedLow: number;
  /** Highest speed the player can have when reaching the segment. */
  speedHigh: number;
  /** Menu backdrop: no obstacles at all. */
  attract: boolean;
}

const PROP_KINDS = ['sign', 'vent', 'spool', 'kiosk', 'barrels', 'antenna', 'holo', 'arch', 'crane'];

/**
 * Picks a pattern by difficulty-weighted random choice, spawns it into a
 * plan, and runs the plan through the reachability validator. Rejected plans
 * are retried with another pattern; after too many rejections a breather is
 * used so the track never stalls.
 */
export class PatternGenerator {
  rng: Random;
  readonly validator = new ReachabilityValidator();
  private recentIntensity: number[] = [];
  private segmentsSincePowerUp = 99;
  private lastPatternId = '';
  lastPatternId2 = '';
  /** Stats surfaced by the debug overlay. */
  rejected = 0;
  generated = 0;
  fallbacks = 0;

  constructor(seed?: number) {
    this.rng = new Random(seed);
  }

  reset(seed: number | undefined, startD: number): void {
    this.rng = new Random(seed);
    this.validator.reset(startD, Math.floor(CONFIG.lanes.count / 2));
    this.recentIntensity = [];
    this.segmentsSincePowerUp = 99;
    this.lastPatternId = '';
    this.rejected = 0;
    this.generated = 0;
    this.fallbacks = 0;
  }

  get seed(): number {
    return this.rng.seed;
  }

  generate(req: GenerationRequest): SegmentPlan {
    const cfg = CONFIG.difficulty;
    this.generated++;
    let plan: SegmentPlan | null = null;
    let chosen: SegmentPattern | null = null;

    if (req.attract) {
      const attract = emptyPlan('attract', 0);
      const res = this.validator.validate(attract, req.startD, req.speedLow, req.speedHigh);
      this.validator.commit(res);
      this.finish(attract, patternById('intro_safe')!);
      return attract;
    }
    if (req.startD < CONFIG.world.safeDistance) {
      chosen = patternById('intro_safe')!;
      plan = this.spawn(chosen, req);
      const res = this.validator.validate(plan, req.startD, req.speedLow, req.speedHigh);
      this.validator.commit(res);
      this.finish(plan, chosen);
      return plan;
    }

    const recent = this.recentIntensity.slice(-2).reduce((a, b) => a + b, 0);
    const forceBreather = recent >= cfg.intensityBudget;
    let candidates = PATTERNS.filter(
      (p) =>
        p.minDifficulty <= req.difficulty &&
        (p.maxDifficulty === undefined || p.maxDifficulty >= req.difficulty) &&
        patternWeight(p, req.difficulty) > 0 &&
        p.id !== this.lastPatternId,
    );
    if (forceBreather) candidates = candidates.filter((p) => p.intensity <= 1);

    for (let attempt = 0; attempt < cfg.maxPatternAttempts && candidates.length > 0; attempt++) {
      const pick = this.rng.weighted(candidates, (p) => patternWeight(p, req.difficulty));
      if (!pick) break;
      const candidate = this.spawn(pick, req);
      const res = this.validator.validate(candidate, req.startD, req.speedLow, req.speedHigh);
      if (res.ok) {
        this.validator.commit(res);
        plan = candidate;
        chosen = pick;
        if (CONFIG.debug.logPatterns) {
          console.debug(`[gen] ${pick.id} @${req.startD.toFixed(0)}m diff=${req.difficulty.toFixed(2)} lanes=[${res.reachableLanes.join(',')}]`);
        }
        break;
      }
      this.rejected++;
      if (CONFIG.debug.logPatterns) console.debug(`[gen] rejected ${pick.id} @${req.startD.toFixed(0)}m: ${res.reason}`);
      // Do not retry the same pattern this round; its lane roll may differ but odds are it is the wrong shape here.
      candidates = candidates.filter((p) => p !== pick);
    }

    if (!plan || !chosen) {
      this.fallbacks++;
      if (CONFIG.debug.logPatterns) console.debug(`[gen] fallback breather @${req.startD.toFixed(0)}m`);
      chosen = patternById('breather')!;
      plan = this.spawn(chosen, req);
      const res = this.validator.validate(plan, req.startD, req.speedLow, req.speedHigh);
      // A breather has no obstacles, so it always validates from any live state.
      this.validator.commit(res);
    }
    this.finish(plan, chosen);
    return plan;
  }

  private finish(plan: SegmentPlan, pattern: SegmentPattern): void {
    this.recentIntensity.push(pattern.intensity);
    if (this.recentIntensity.length > 4) this.recentIntensity.shift();
    this.lastPatternId2 = this.lastPatternId;
    this.lastPatternId = pattern.id;
    if (plan.powerUps.length > 0) this.segmentsSincePowerUp = 0;
    else this.segmentsSincePowerUp++;
    // Side props for every segment.
    const propCount = this.rng.int(2, 4);
    for (let i = 0; i < propCount; i++) {
      plan.props.push({
        kind: this.rng.pick(PROP_KINDS),
        side: this.rng.sign() as -1 | 1,
        d: this.rng.range(2, CONFIG.world.segmentLength - 2),
      });
    }
  }

  private spawn(pattern: SegmentPattern, req: GenerationRequest): SegmentPlan {
    const plan = emptyPlan(pattern.id, pattern.intensity);
    const rng = this.rng;
    const laneCount = CONFIG.lanes.count;
    const length = CONFIG.world.segmentLength;
    const allowPowerUp =
      !req.attract && this.segmentsSincePowerUp >= CONFIG.difficulty.minSegmentsBetweenPowerUps && rng.chance(0.55);
    let powerUpPlaced = false;

    const ctx: PatternContext = {
      rng,
      difficulty: req.difficulty,
      speed: req.speedHigh,
      laneCount,
      length,
      plan,
      allowPowerUp,
      obstacle: (defId, lane, d, motion?: MotionSpec) => {
        lane = Math.max(0, Math.min(laneCount - 1, Math.round(lane)));
        plan.obstacles.push({ defId, lane, d, motion });
      },
      shardLine: (lane, dStart, dEnd, spacing = 2, y = 1.0) => {
        lane = Math.max(0, Math.min(laneCount - 1, lane));
        const a = Math.max(1, dStart);
        const b = Math.min(length - 1, dEnd);
        for (let d = a; d <= b + 1e-6; d += spacing) plan.shards.push({ lane, d, y });
      },
      shardArc: (lane, dCenter) => {
        const offsets = [-2.8, -1.4, 0, 1.4, 2.8];
        const heights = [1.3, 2.1, 2.6, 2.1, 1.3];
        for (let i = 0; i < offsets.length; i++) {
          const d = dCenter + offsets[i];
          if (d < 0.5 || d > length - 0.5) continue;
          plan.shards.push({ lane, d, y: heights[i] });
        }
      },
      shardLow: (lane, dCenter) => {
        for (const off of [-1.6, 0, 1.6]) {
          const d = dCenter + off;
          if (d < 0.5 || d > length - 0.5) continue;
          plan.shards.push({ lane, d, y: 0.55 });
        }
      },
      powerUp: (lane, d) => {
        if (!allowPowerUp || powerUpPlaced) return;
        powerUpPlaced = true;
        plan.powerUps.push({ lane, d, kind: this.pickPowerUp(req.difficulty) });
      },
      randomLane: () => rng.int(0, laneCount - 1),
      otherLanes: (...exclude) => {
        const out: number[] = [];
        for (let l = 0; l < laneCount; l++) if (!exclude.includes(l)) out.push(l);
        return out;
      },
    };
    pattern.spawn(ctx);
    return plan;
  }

  private pickPowerUp(difficulty: number): PowerUpId {
    // Shields matter more once the track gets busy; boots are most useful early.
    const weights: Record<PowerUpId, number> = {
      magnet: 3,
      shield: 2 + difficulty * 2,
      amplifier: 3,
      sprint: 2,
      autoHop: 2.5 - difficulty,
    };
    const id = this.rng.weighted(POWER_UP_IDS, (p) => weights[p]) ?? 'magnet';
    return isPowerUpId(id) ? id : 'magnet';
  }

  /** Used by the debug overlay to show where a lane sits. */
  laneLabel(lane: number): string {
    return `${lane} (x=${laneX(lane).toFixed(1)})`;
  }
}
