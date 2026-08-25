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
 *    must be clear of anything that needs a reaction for the crossing.
 *  - Blocks can never be stayed in.
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

export interface ValidationResult {
  ok: boolean;
  reason: string;
  endState: ValidatorState;
  reachableLanes: number[];
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

export class ReachabilityValidator {
  state: ValidatorState;

  constructor() {
    this.state = this.initialState(0, Math.floor(CONFIG.lanes.count / 2));
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
  }

  commit(result: ValidationResult): void {
    this.state = result.endState;
  }

  /** Converts a plan to per-lane merged intervals in absolute track distance. */
  buildIntervals(plan: SegmentPlan, startD: number, speedLow: number): { intervals: Interval[][]; error: string | null } {
    const laneCount = CONFIG.lanes.count;
    const length = CONFIG.world.segmentLength;
    const raw: Interval[][] = [];
    for (let i = 0; i < laneCount; i++) raw.push([]);
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

    const maxJumpDepth = Math.min(CONFIG.validator.maxJumpDepth, speedLow * 0.25);
    const maxSlideDepth = Math.min(CONFIG.validator.maxSlideDepth, speedLow * CONFIG.movement.slideDuration * 0.55);

    const merged: Interval[][] = raw.map((list) => {
      list.sort((a, b) => a.start - b.start);
      const out: Interval[] = [];
      for (const iv of list) {
        const last = out[out.length - 1];
        if (last && iv.start <= last.end + MERGE_GAP) {
          last.end = Math.max(last.end, iv.end);
          last.action = combine(last.action, iv.action);
        } else {
          out.push({ ...iv });
        }
      }
      for (const iv of out) {
        const depth = iv.end - iv.start;
        if (iv.action === 'jump' && depth > maxJumpDepth) iv.action = 'block';
        if (iv.action === 'slide' && depth > maxSlideDepth) iv.action = 'block';
      }
      return out;
    });
    return { intervals: merged, error };
  }

  validate(plan: SegmentPlan, startD: number, speedLow: number, speedHigh: number): ValidationResult {
    const { intervals, error } = this.buildIntervals(plan, startD, speedLow);
    const st = cloneState(this.state);
    if (error) return { ok: false, reason: error, endState: st, reachableLanes: [] };

    const cfg = CONFIG.validator;
    const mv = CONFIG.movement;
    const laneCount = CONFIG.lanes.count;
    const step = cfg.gridStep;
    const reaction = cfg.reactionTime * speedHigh;
    const chainReaction = cfg.laneChainReactionTime * speedHigh;
    const laneDist = mv.laneChangeDuration * speedHigh;
    const airTime = (2 * mv.jumpVelocity) / Math.abs(mv.gravity);
    const jumpBusy = airTime * cfg.jumpBusyFactor * speedHigh;
    const slideBusy = mv.slideDuration * cfg.slideBusyFactor * speedHigh;
    const zEnd = startD + CONFIG.world.segmentLength;

    const lanes = st.lanes;
    const pending = st.pendingArrival;

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

    for (let z = startD; z < zEnd; z += step) {
      // Lane-change arrivals scheduled earlier.
      for (let l = 0; l < laneCount; l++) {
        if (pending[l] <= z + step) {
          if (pending[l] < lanes[l].idle) lanes[l] = { idle: pending[l], lastAction: 'lane' };
          pending[l] = INF;
        }
      }

      const next: LaneState[] = lanes.map((l) => ({ idle: l.idle, lastAction: l.lastAction }));
      for (let l = 0; l < laneCount; l++) {
        const cur = lanes[l];
        if (cur.idle === INF) continue;

        // Option: start a lane change from here.
        const minStart = cur.idle + (cur.lastAction === 'lane' ? chainReaction : reaction);
        if (minStart <= z) {
          for (const dir of [-1, 1]) {
            const l2 = l + dir;
            if (l2 < 0 || l2 >= laneCount) continue;
            const arrive = z + laneDist;
            if (corridorClear(l, z, arrive) && corridorClear(l2, z, arrive + reaction)) {
              if (arrive < pending[l2]) pending[l2] = arrive;
            }
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
          if (cur.idle + reaction <= iv.start) {
            next[l].idle = iv.start + (iv.action === 'jump' ? jumpBusy : slideBusy);
            next[l].lastAction = iv.action;
          } else {
            next[l].idle = INF;
          }
        } else if (iv.start < startD && z === startD) {
          // Interval began in the previous segment; the carried state already accounts for it.
          if (cur.idle <= z) next[l].idle = INF;
        } else if (cur.idle <= z) {
          // Idle in the middle of an obstacle that needed an action: collision.
          next[l].idle = INF;
        }
      }
      for (let l = 0; l < laneCount; l++) lanes[l] = next[l];
    }

    // Flush arrivals that land exactly at the segment boundary.
    for (let l = 0; l < laneCount; l++) {
      if (pending[l] <= zEnd && pending[l] < lanes[l].idle) {
        lanes[l] = { idle: pending[l], lastAction: 'lane' };
        pending[l] = INF;
      }
    }

    const reachableLanes: number[] = [];
    for (let l = 0; l < laneCount; l++) if (lanes[l].idle !== INF || pending[l] !== INF) reachableLanes.push(l);
    const ok = reachableLanes.length > 0;
    return {
      ok,
      reason: ok ? 'ok' : 'no surviving lane',
      endState: { lanes, pendingArrival: pending },
      reachableLanes,
    };
  }
}

function combine(a: AvoidAction, b: AvoidAction): AvoidAction {
  if (a === 'clutter') return b;
  if (b === 'clutter') return a;
  if (a === b) return a;
  // jump + slide (or anything with block) in one compound cannot be cleared.
  return 'block';
}
