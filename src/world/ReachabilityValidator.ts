import { getObstacleDef } from '../entities/ObstacleDefinitions';
import { CONFIG } from '../game/Config';
import type { AvoidAction, SegmentPlan } from './SegmentPlan';

/**
 * Guarantees every committed segment can be survived.
 *
 * The track is walked in small distance steps. For each lane we keep the
 * earliest track distance at which a player in that lane could be idle
 * (not mid-jump/slide). Being idle earlier dominates being idle later, so one
 * number per lane is an exact summary of every reachable state.
 *
 *  - A required action (jump/slide) at an obstacle needs the player idle at
 *    least `reactionTime * speed` before the obstacle, and makes them busy
 *    for the action's duration.
 *  - Being idle inside a jump/slide interval means the obstacle was hit.
 *  - Lane changes take `laneChangeDuration * speed` meters and both lanes
 *    must be clear of anything that needs a reaction for the crossing. A
 *    chained double change only needs the middle lane clear while it is
 *    being crossed.
 *  - Blocks can never be stayed in.
 *
 * Each validation walks the previous committed segment again together with
 * the new one, so a player may react to the new segment while still in the
 * old one, arrivals across the boundary are checked against the obstacles
 * they land next to, and obstacles on both sides of the boundary merge into
 * compounds like any others.
 *
 * On top of the "some route exists" walk, every lane the player could be in
 * at the boundary is checked on its own: a lane a player was free to pick
 * must have a way through the new segment, given they see it coming from
 * about one segment out. Without this a pattern could be accepted because
 * lane 2 survives while a player baited into lane 0 by the previous
 * segment's shards has nowhere to go.
 *
 * Distances derived from reaction time use the highest speed the player may
 * reach before the segment; coverage limits use the lowest. Both err on the
 * side of rejecting a pattern.
 */

export type LastAction = 'none' | 'lane' | 'jump' | 'slide';

export interface LaneState {
  idle: number;
  lastAction: LastAction;
}

export interface ValidatorState {
  lanes: LaneState[];
  pendingArrival: number[];
}

interface Interval {
  lane: number;
  start: number;
  end: number;
  action: AvoidAction;
}

interface WalkParams {
  step: number;
  reaction: number;
  chainReaction: number;
  laneDist: number;
  jumpBusy: number;
  slideBusy: number;
}

export interface ValidationResult {
  ok: boolean;
  reason: string;
  /** State at the far end of the new segment. */
  endState: ValidatorState;
  /** State at the boundary where the new segment starts. */
  boundaryState: ValidatorState;
  reachableLanes: number[];
  /** Where the new segment starts, and its raw intervals; kept by commit(). */
  segmentStartD: number;
  rawIntervals: Interval[][];
}

const INF = Number.POSITIVE_INFINITY;
/** Obstacles closer than this along the track merge into one compound interval. */
const MERGE_GAP = 2.5;

function cloneState(s: ValidatorState): ValidatorState {
  return {
    lanes: s.lanes.map((l) => ({ idle: l.idle, lastAction: l.lastAction })),
    pendingArrival: s.pendingArrival.slice(),
  };
}

function emptyLanes(): Interval[][] {
  const out: Interval[][] = [];
  for (let i = 0; i < CONFIG.lanes.count; i++) out.push([]);
  return out;
}

export class ReachabilityValidator {
  /** State at the far end of the committed track (informational). */
  state: ValidatorState;
  /** State at the start of the last committed segment, where the next walk begins. */
  private windowState: ValidatorState;
  private windowStartD = 0;
  /** Unmerged intervals of the last committed segment. */
  private prevRaw: Interval[][] = emptyLanes();

  constructor() {
    this.state = this.initialState(0, Math.floor(CONFIG.lanes.count / 2));
    this.windowState = cloneState(this.state);
  }

  private initialState(startD: number, lane: number): ValidatorState {
    const lanes: LaneState[] = [];
    const pendingArrival: number[] = [];
    for (let i = 0; i < CONFIG.lanes.count; i++) {
      lanes.push({ idle: i === lane ? startD : INF, lastAction: 'none' });
      pendingArrival.push(INF);
    }
    return { lanes, pendingArrival };
  }

  reset(startD: number, lane: number): void {
    this.state = this.initialState(startD, lane);
    this.windowState = cloneState(this.state);
    this.windowStartD = startD;
    this.prevRaw = emptyLanes();
  }

  commit(result: ValidationResult): void {
    this.state = result.endState;
    this.windowState = result.boundaryState;
    this.windowStartD = result.segmentStartD;
    this.prevRaw = result.rawIntervals;
  }

  /** Converts a plan to per-lane raw intervals in absolute track distance. */
  private rawIntervals(plan: SegmentPlan, startD: number): { raw: Interval[][]; error: string | null } {
    const laneCount = CONFIG.lanes.count;
    const length = CONFIG.world.segmentLength;
    const raw = emptyLanes();
    let error: string | null = null;
    for (const o of plan.obstacles) {
      const def = getObstacleDef(o.defId);
      let laneFrom = o.lane;
      let laneTo = o.lane + def.laneSpan - 1;
      let dStart = o.d - def.depth / 2;
      const dEnd = o.d + def.depth / 2;
      if (o.motion?.type === 'lateral') {
        laneFrom = Math.min(o.motion.laneFrom, o.motion.laneTo);
        laneTo = Math.max(o.motion.laneFrom, o.motion.laneTo);
      } else if (o.motion?.type === 'oncoming') {
        dStart -= o.motion.travel;
      }
      if (dStart < 0 || dEnd > length) {
        error = `${o.defId} extends outside the segment (${dStart.toFixed(1)}..${dEnd.toFixed(1)})`;
      }
      laneFrom = Math.max(0, laneFrom);
      laneTo = Math.min(laneCount - 1, laneTo);
      for (let l = laneFrom; l <= laneTo; l++) {
        raw[l].push({ lane: l, start: startD + dStart, end: startD + dEnd, action: def.avoid });
      }
    }
    return { raw, error };
  }

  /**
   * Merges two raw interval sets per lane into compounds and applies the
   * depth limits. Obstacles almost touching merge whatever they are; two
   * obstacles needing the same action also merge when one jump or one slide
   * at the low end of the speed range covers both, so a sign followed by a
   * bar a few meters later reads as a single slide instead of a dead lane.
   */
  private mergeLanes(a: Interval[][], b: Interval[][], speedLow: number): Interval[][] {
    const maxJumpDepth = Math.min(CONFIG.validator.maxJumpDepth, speedLow * 0.25);
    const maxSlideDepth = Math.min(CONFIG.validator.maxSlideDepth, speedLow * CONFIG.movement.slideDuration * 0.55);
    const out: Interval[][] = [];
    for (let l = 0; l < CONFIG.lanes.count; l++) {
      const list = a[l].concat(b[l]).sort((x, y) => x.start - y.start);
      const merged: Interval[] = [];
      for (const iv of list) {
        const last = merged[merged.length - 1];
        const touching = last !== undefined && iv.start <= last.end + MERGE_GAP;
        const oneAction =
          last !== undefined &&
          last.action === iv.action &&
          ((iv.action === 'slide' && iv.end - last.start <= maxSlideDepth) || (iv.action === 'jump' && iv.end - last.start <= maxJumpDepth));
        if (last && (touching || oneAction)) {
          last.end = Math.max(last.end, iv.end);
          last.action = combine(last.action, iv.action);
        } else {
          merged.push({ ...iv });
        }
      }
      for (const iv of merged) {
        const depth = iv.end - iv.start;
        if (iv.action === 'jump' && depth > maxJumpDepth) iv.action = 'block';
        if (iv.action === 'slide' && depth > maxSlideDepth) iv.action = 'block';
      }
      out.push(merged);
    }
    return out;
  }

  private params(speedHigh: number): WalkParams {
    const cfg = CONFIG.validator;
    const mv = CONFIG.movement;
    const airTime = (2 * mv.jumpVelocity) / Math.abs(mv.gravity);
    return {
      step: cfg.gridStep,
      reaction: cfg.reactionTime * speedHigh,
      chainReaction: cfg.laneChainReactionTime * speedHigh,
      laneDist: mv.laneChangeDuration * speedHigh,
      jumpBusy: airTime * cfg.jumpBusyFactor * speedHigh,
      slideBusy: mv.slideDuration * cfg.slideBusyFactor * speedHigh,
    };
  }

  validate(plan: SegmentPlan, startD: number, speedLow: number, speedHigh: number): ValidationResult {
    const { raw, error } = this.rawIntervals(plan, startD);
    const failed = (reason: string): ValidationResult => ({
      ok: false,
      reason,
      endState: cloneState(this.state),
      boundaryState: cloneState(this.windowState),
      reachableLanes: [],
      segmentStartD: startD,
      rawIntervals: raw,
    });
    if (error) return failed(error);

    const intervals = this.mergeLanes(this.prevRaw, raw, speedLow);
    const p = this.params(speedHigh);
    const zEnd = startD + CONFIG.world.segmentLength;

    // Some route from the committed track through the new segment.
    const union = this.walk(cloneState(this.windowState), this.windowStartD, zEnd, intervals, p, startD);
    if (union.reachable.length === 0) return failed('no surviving lane');

    // Every lane a player could be in at the boundary has to work on its own.
    const boundary = union.boundary;
    for (let l = 0; l < CONFIG.lanes.count; l++) {
      const live = boundary.lanes[l].idle !== INF || boundary.pendingArrival[l] !== INF;
      if (!live) continue;
      const start = this.singleLaneStart(l, startD, intervals, p);
      const single = this.walk(start.state, start.z0, zEnd, intervals, p);
      if (single.reachable.length === 0) return failed(`lane ${l} has no way through`);
    }

    return {
      ok: true,
      reason: 'ok',
      endState: { lanes: union.lanes, pendingArrival: union.pending },
      boundaryState: boundary,
      reachableLanes: union.reachable,
      segmentStartD: startD,
      rawIntervals: raw,
    };
  }

  /**
   * Start state for the per-lane check: the player has settled in `lane`
   * about one segment before the boundary and can see the new segment.
   */
  private singleLaneStart(lane: number, startD: number, intervals: Interval[][], p: WalkParams): { state: ValidatorState; z0: number } {
    const lookback = Math.min(CONFIG.world.segmentLength, p.reaction + 2 * p.laneDist + p.chainReaction + 1);
    let z0 = startD - lookback;
    let idle = z0 - p.reaction;
    let lastAction: LastAction = 'none';
    for (const iv of intervals[lane]) {
      if (iv.action === 'clutter' || iv.end <= z0 || iv.start >= startD) continue;
      if (iv.action === 'block') {
        // They can only have entered this lane after the block.
        z0 = Math.max(z0, iv.end + 0.01);
        idle = z0;
        lastAction = 'lane';
      } else if (iv.start <= z0 && iv.end > z0) {
        // Mid-action over an obstacle that straddles the start of the window.
        idle = iv.start + (iv.action === 'jump' ? p.jumpBusy : p.slideBusy);
        lastAction = iv.action;
      }
    }
    const state = this.initialState(0, -1);
    state.lanes[lane] = { idle, lastAction };
    return { state, z0 };
  }

  /**
   * Walks the DP from z0 to z1. When `boundaryAt` is given, the state at that
   * distance is snapshotted before any transition at that step.
   */
  private walk(
    state: ValidatorState,
    z0: number,
    z1: number,
    intervals: Interval[][],
    p: WalkParams,
    boundaryAt?: number,
  ): { lanes: LaneState[]; pending: number[]; reachable: number[]; boundary: ValidatorState } {
    const laneCount = CONFIG.lanes.count;
    const step = p.step;
    let lanes = state.lanes;
    const pending = state.pendingArrival;
    let boundary: ValidatorState | null = null;

    const covering = (lane: number, a: number, b: number): Interval | null => {
      const list = intervals[lane];
      for (let i = 0; i < list.length; i++) {
        const iv = list[i];
        if (iv.start < b && iv.end > a) return iv;
      }
      return null;
    };
    const corridorClear = (lane: number, a: number, b: number): boolean => {
      const list = intervals[lane];
      for (let i = 0; i < list.length; i++) {
        const iv = list[i];
        if (iv.action !== 'clutter' && iv.start < b && iv.end > a) return false;
      }
      return true;
    };
    const arrive = (l: number, at: number): void => {
      // The landing lane must be clear around the arrival, even when the
      // change was scheduled before this window and never saw these obstacles.
      if (at < lanes[l].idle && corridorClear(l, at - p.laneDist, at + p.reaction)) lanes[l] = { idle: at, lastAction: 'lane' };
    };

    for (let z = z0; z < z1 - 1e-9; z += step) {
      if (boundaryAt !== undefined && boundary === null && z >= boundaryAt - 1e-9) {
        boundary = cloneState({ lanes, pendingArrival: pending });
      }
      for (let l = 0; l < laneCount; l++) {
        if (pending[l] <= z + step) {
          arrive(l, pending[l]);
          pending[l] = INF;
        }
      }

      const next: LaneState[] = lanes.map((l) => ({ idle: l.idle, lastAction: l.lastAction }));
      for (let l = 0; l < laneCount; l++) {
        const cur = lanes[l];
        if (cur.idle === INF) continue;

        // Option: start a lane change from here, possibly straight through to the lane beyond.
        const minStart = cur.idle + (cur.lastAction === 'lane' ? p.chainReaction : p.reaction);
        if (minStart <= z) {
          for (const dir of [-1, 1]) {
            const l2 = l + dir;
            if (l2 < 0 || l2 >= laneCount) continue;
            const at2 = z + p.laneDist;
            if (!corridorClear(l, z, at2)) continue;
            if (corridorClear(l2, z, at2 + p.reaction) && at2 < pending[l2]) pending[l2] = at2;
            const l3 = l2 + dir;
            if (l3 < 0 || l3 >= laneCount) continue;
            const at3 = at2 + p.chainReaction + p.laneDist;
            if (corridorClear(l2, z, at3) && corridorClear(l3, at2 + p.chainReaction, at3 + p.reaction) && at3 < pending[l3]) pending[l3] = at3;
          }
        }

        // Option: stay in this lane through [z, z+step).
        const iv = covering(l, z, z + step);
        if (!iv || iv.action === 'clutter') continue;
        if (iv.action === 'block') {
          next[l].idle = INF;
          continue;
        }
        const firstStep = iv.start >= z && iv.start < z + step;
        if (firstStep) {
          if (cur.idle + p.reaction <= iv.start) {
            next[l].idle = iv.start + (iv.action === 'jump' ? p.jumpBusy : p.slideBusy);
            next[l].lastAction = iv.action;
          } else {
            next[l].idle = INF;
          }
        } else if (cur.idle < z + step) {
          // Idle somewhere inside an obstacle that needed an action: collision.
          next[l].idle = INF;
        }
      }
      lanes = next;
    }

    for (let l = 0; l < laneCount; l++) {
      if (pending[l] <= z1) {
        arrive(l, pending[l]);
        pending[l] = INF;
      }
    }
    if (boundary === null) boundary = cloneState({ lanes, pendingArrival: pending });

    const reachable: number[] = [];
    for (let l = 0; l < laneCount; l++) if (lanes[l].idle !== INF || pending[l] !== INF) reachable.push(l);
    return { lanes, pending, reachable, boundary };
  }
}

function combine(a: AvoidAction, b: AvoidAction): AvoidAction {
  if (a === 'clutter') return b;
  if (b === 'clutter') return a;
  if (a === b) return a;
  // jump + slide (or anything with block) in one compound cannot be cleared.
  return 'block';
}
