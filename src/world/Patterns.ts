import { CONFIG } from '../game/Config';
import type { Random } from '../utils/Random';
import type { MotionSpec, SegmentPlan } from './SegmentPlan';

/**
 * Pattern catalogue. Each pattern writes obstacles, shards and power-ups into
 * a plan through the helper context. Lanes are picked at spawn time so the
 * same pattern reads differently every time. The validator has the final say
 * on whether a spawned plan is committed.
 */

export type RequiredAction = 'none' | 'jump' | 'slide' | 'laneChange';

export interface PatternContext {
  rng: Random;
  difficulty: number;
  /** Speed the player is expected to have when reaching this segment. */
  speed: number;
  laneCount: number;
  length: number;
  plan: SegmentPlan;
  /** False when a power-up spawned recently. */
  allowPowerUp: boolean;
  obstacle(defId: string, lane: number, d: number, motion?: MotionSpec): void;
  shardLine(lane: number, dStart: number, dEnd: number, spacing?: number, y?: number): void;
  /** Arc of shards over a jumpable obstacle centered at dCenter. */
  shardArc(lane: number, dCenter: number): void;
  /** Low shards to grab while sliding under something at dCenter. */
  shardLow(lane: number, dCenter: number): void;
  powerUp(lane: number, d: number): void;
  randomLane(): number;
  otherLanes(...exclude: number[]): number[];
  /** A random lane not in `exclude`, or any lane when none is left. */
  pickOther(...exclude: number[]): number;
}

export interface SegmentPattern {
  id: string;
  minDifficulty: number;
  maxDifficulty?: number;
  weight: number | ((difficulty: number) => number);
  /** 0 breather .. 3 demanding. */
  intensity: number;
  requiredAction: RequiredAction;
  /** Lanes the pattern typically blocks; the validator works from the spawned plan, this is documentation. */
  blockedLanes: number[];
  moving?: boolean;
  spawn: (ctx: PatternContext) => void;
}

const L = () => CONFIG.world.segmentLength;

export const PATTERNS: readonly SegmentPattern[] = [
  {
    id: 'intro_safe',
    minDifficulty: 0,
    maxDifficulty: -1, // never picked by weight; used for the opening stretch
    weight: 0,
    intensity: 0,
    requiredAction: 'none',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = Math.floor(ctx.laneCount / 2);
      ctx.shardLine(lane, 4, L() - 4, 2.2);
    },
  },
  {
    id: 'breather',
    minDifficulty: 0,
    weight: (d) => 3 + d * 2,
    intensity: 0,
    requiredAction: 'none',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      ctx.shardLine(lane, 3, 12, 2.2);
      if (ctx.rng.chance(0.5)) ctx.shardLine(ctx.pickOther(lane), 13, L() - 3, 2.2);
      if (ctx.rng.chance(0.6)) ctx.powerUp(ctx.randomLane(), L() - 6);
    },
  },
  {
    id: 'single_crate',
    minDifficulty: 0,
    weight: 6,
    intensity: 1,
    requiredAction: 'jump',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(9, 15);
      ctx.obstacle('crate', lane, d);
      ctx.shardArc(lane, d);
      const other = ctx.pickOther(lane);
      ctx.shardLine(other, d - 4, d + 4, 2);
    },
  },
  {
    id: 'low_cart',
    minDifficulty: 0.05,
    weight: 5,
    intensity: 1,
    requiredAction: 'jump',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(8, 16);
      ctx.obstacle('cart', lane, d);
      ctx.shardArc(lane, d);
      if (ctx.rng.chance(0.5)) ctx.obstacle('cones', ctx.pickOther(lane), d + ctx.rng.range(-3, 3));
    },
  },
  {
    id: 'broken_panel',
    minDifficulty: 0.1,
    weight: 4,
    intensity: 1,
    requiredAction: 'jump',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(8, 15);
      ctx.obstacle('rail_panel', lane, d);
      ctx.shardArc(lane, d);
      const side = ctx.pickOther(lane);
      ctx.shardLine(side, 3, L() - 3, 2.6, 1.0);
    },
  },
  {
    id: 'overhead_sign',
    minDifficulty: 0.1,
    weight: 5,
    intensity: 1,
    requiredAction: 'slide',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(8, 16);
      ctx.obstacle('sign_low', lane, d);
      ctx.shardLow(lane, d);
      ctx.shardLine(ctx.pickOther(lane), d + 3, L() - 2, 2.2);
    },
  },
  {
    id: 'pipe_all_lanes',
    minDifficulty: 0.2,
    weight: 5,
    intensity: 2,
    requiredAction: 'slide',
    blockedLanes: [],
    spawn: (ctx) => {
      const d = ctx.rng.range(9, 15);
      ctx.obstacle('pipe', 0, d);
      const lane = ctx.randomLane();
      ctx.shardLow(lane, d);
      ctx.shardLine(lane, d + 4, L() - 2, 2.2);
    },
  },
  {
    id: 'lane_block_single',
    minDifficulty: 0.15,
    weight: 6,
    intensity: 1,
    requiredAction: 'laneChange',
    blockedLanes: [1],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const def = ctx.rng.pick(['gate', 'crate_stack', 'container'] as const);
      const d = def === 'container' ? ctx.rng.range(6, 16) : ctx.rng.range(6, 18);
      ctx.obstacle(def, lane, d);
      const free = ctx.pickOther(lane);
      ctx.shardLine(free, Math.max(2, d - 5), Math.min(L() - 2, d + 6), 2.2);
    },
  },
  {
    id: 'two_lane_wall',
    minDifficulty: 0.3,
    weight: 6,
    intensity: 2,
    requiredAction: 'laneChange',
    blockedLanes: [0, 1],
    spawn: (ctx) => {
      // Wall covers two adjacent lanes; the remaining lane is the escape.
      const leftmost = ctx.rng.int(0, ctx.laneCount - 2);
      const d = ctx.rng.range(8, 16);
      ctx.obstacle('wall', leftmost, d);
      const escape = leftmost === 0 ? leftmost + 2 : leftmost - 1;
      if (escape >= 0 && escape < ctx.laneCount) ctx.shardLine(escape, d - 6, d + 5, 2.2);
    },
  },
  {
    id: 'tram_parked',
    minDifficulty: 0.25,
    weight: 5,
    intensity: 2,
    requiredAction: 'laneChange',
    blockedLanes: [0],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(7, 17);
      ctx.obstacle('tram_parked', lane, d);
      const free = ctx.pickOther(lane);
      ctx.shardLine(free, 3, L() - 3, 2.4);
      if (ctx.rng.chance(0.35)) ctx.obstacle('cones', ctx.pickOther(lane, free), ctx.rng.range(6, 18));
    },
  },
  {
    id: 'tram_incoming',
    minDifficulty: 0.4,
    weight: (d) => 3 + d * 5,
    intensity: 2,
    requiredAction: 'laneChange',
    blockedLanes: [0],
    moving: true,
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const travel = 8;
      ctx.obstacle('tram_moving', lane, L() - 5.5, { type: 'oncoming', speed: 11, travel });
      const free = ctx.pickOther(lane);
      ctx.shardLine(free, 4, L() - 4, 2.4);
    },
  },
  {
    id: 'jump_sequence',
    minDifficulty: 0.35,
    weight: 4,
    intensity: 2,
    requiredAction: 'jump',
    blockedLanes: [],
    spawn: (ctx) => {
      const a = ctx.randomLane();
      const b = ctx.pickOther(a);
      ctx.obstacle('crate', a, 6);
      ctx.obstacle(ctx.rng.pick(['cart', 'rail_panel']), b, 19);
      ctx.shardArc(a, 6);
      ctx.shardArc(b, 19);
    },
  },
  {
    id: 'slide_sequence',
    minDifficulty: 0.35,
    weight: 4,
    intensity: 2,
    requiredAction: 'slide',
    blockedLanes: [],
    spawn: (ctx) => {
      const a = ctx.randomLane();
      ctx.obstacle('sign_low', a, 6);
      const leftmost = ctx.rng.int(0, ctx.laneCount - 2);
      ctx.obstacle('bar', leftmost, 19);
      ctx.shardLow(a, 6);
      ctx.shardLow(leftmost === a ? leftmost + 1 : leftmost, 19);
    },
  },
  {
    id: 'risky_route',
    minDifficulty: 0.3,
    weight: 5,
    intensity: 2,
    requiredAction: 'none',
    blockedLanes: [],
    spawn: (ctx) => {
      // Jump lane has the reward, another lane has cones, the last is plain.
      const rich = ctx.randomLane();
      const others = ctx.otherLanes(rich);
      const clutter = ctx.rng.pick(others);
      const d = ctx.rng.range(9, 14);
      ctx.obstacle('crate', rich, d);
      ctx.shardArc(rich, d);
      ctx.shardLine(rich, d + 4, L() - 2, 1.6, 1.0);
      ctx.obstacle('cones', clutter, d + ctx.rng.range(-2, 2));
      ctx.powerUp(rich, L() - 3);
    },
  },
  {
    id: 'drone_sweep',
    minDifficulty: 0.45,
    weight: (d) => 2 + d * 4,
    intensity: 2,
    requiredAction: 'slide',
    blockedLanes: [],
    moving: true,
    spawn: (ctx) => {
      const d = ctx.rng.range(9, 15);
      const from = ctx.rng.int(0, ctx.laneCount - 2);
      const to = ctx.rng.chance(0.5) ? ctx.laneCount - 1 : from + 1;
      ctx.obstacle('drone', from, d, { type: 'lateral', laneFrom: from, laneTo: Math.max(to, from + 1), period: 2.6, phase: ctx.rng.range(0, Math.PI * 2) });
      ctx.shardLow(ctx.randomLane(), d);
      ctx.shardLine(ctx.randomLane(), d + 5, L() - 2, 2.2);
    },
  },
  {
    id: 'crossing_cart',
    minDifficulty: 0.5,
    weight: (d) => 2 + d * 4,
    intensity: 2,
    requiredAction: 'jump',
    blockedLanes: [],
    moving: true,
    spawn: (ctx) => {
      const d = ctx.rng.range(9, 15);
      ctx.obstacle('cart_crossing', 0, d, { type: 'lateral', laneFrom: 0, laneTo: ctx.laneCount - 1, period: 3.2, phase: ctx.rng.range(0, Math.PI * 2) });
      ctx.shardArc(ctx.randomLane(), d);
    },
  },
  {
    id: 'arm_swing',
    minDifficulty: 0.5,
    weight: 3,
    intensity: 2,
    requiredAction: 'slide',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      const d = ctx.rng.range(8, 15);
      ctx.obstacle('arm', lane, d);
      ctx.shardLow(lane, d);
      const cl = ctx.pickOther(lane);
      ctx.obstacle('cones', cl, d + 1);
    },
  },
  {
    id: 'mixed_gauntlet',
    minDifficulty: 0.6,
    weight: (d) => 3 + d * 3,
    intensity: 3,
    requiredAction: 'laneChange',
    blockedLanes: [0],
    spawn: (ctx) => {
      const blocked = ctx.randomLane();
      const others = ctx.otherLanes(blocked);
      const jumpLane = ctx.rng.pick(others);
      const slideLane = others.find((l) => l !== jumpLane) ?? jumpLane;
      ctx.obstacle('container', blocked, 9);
      ctx.obstacle('crate', jumpLane, 9);
      ctx.obstacle('sign_low', slideLane, 21);
      ctx.shardArc(jumpLane, 9);
      ctx.shardLow(slideLane, 21);
    },
  },
  {
    id: 'wall_then_pipe',
    minDifficulty: 0.7,
    weight: (d) => 2 + d * 3,
    intensity: 3,
    requiredAction: 'laneChange',
    blockedLanes: [0, 1],
    spawn: (ctx) => {
      const leftmost = ctx.rng.int(0, ctx.laneCount - 2);
      ctx.obstacle('wall', leftmost, 5);
      ctx.obstacle('pipe', 0, 20);
      const escape = leftmost === 0 ? leftmost + 2 : leftmost - 1;
      ctx.shardLine(escape, 2, 12, 2);
      ctx.shardLow(escape, 20);
    },
  },
  {
    id: 'power_run',
    minDifficulty: 0.2,
    weight: 2,
    intensity: 1,
    requiredAction: 'jump',
    blockedLanes: [],
    spawn: (ctx) => {
      const lane = ctx.randomLane();
      ctx.obstacle('crate', lane, 8);
      ctx.shardArc(lane, 8);
      ctx.powerUp(lane, 15);
      ctx.shardLine(ctx.pickOther(lane), 4, 12, 2.2);
    },
  },
  {
    id: 'double_block',
    minDifficulty: 0.55,
    weight: (d) => 2 + d * 3,
    intensity: 3,
    requiredAction: 'laneChange',
    blockedLanes: [0, 2],
    spawn: (ctx) => {
      // Two outer lanes blocked at different depths; middle lane has a jump.
      const mid = Math.floor(ctx.laneCount / 2);
      const outer = ctx.otherLanes(mid);
      ctx.obstacle('gate', outer[0], 6);
      ctx.obstacle('crate_stack', outer[outer.length - 1], 16);
      ctx.obstacle('cart', mid, 12);
      ctx.shardArc(mid, 12);
    },
  },
];

export function patternById(id: string): SegmentPattern | undefined {
  return PATTERNS.find((p) => p.id === id);
}

export function patternWeight(p: SegmentPattern, difficulty: number): number {
  return typeof p.weight === 'function' ? p.weight(difficulty) : p.weight;
}
