/**
 * Pure data describing what a segment contains. Pattern generation produces a
 * plan, the reachability validator checks it, and only then does a Segment
 * turn it into meshes. Nothing here touches Three.js.
 */

export type AvoidAction = 'jump' | 'slide' | 'block' | 'clutter';

export type MotionSpec =
  /** Rail car driving toward the player. `travel` is how far (meters of track) it moves before braking. */
  | { type: 'oncoming'; speed: number; travel: number }
  /** Object sweeping sideways between two lanes with a cosine ping-pong. */
  | { type: 'lateral'; laneFrom: number; laneTo: number; period: number; phase: number };

export interface PlannedObstacle {
  defId: string;
  /** Leftmost lane the obstacle covers. */
  lane: number;
  /** Distance into the segment (0 = near edge, segmentLength = far edge). */
  d: number;
  motion?: MotionSpec;
}

export interface PlannedShard {
  lane: number;
  d: number;
  y: number;
}

export interface PlannedPowerUp {
  lane: number;
  d: number;
  kind: string;
}

export interface PlannedProp {
  kind: string;
  side: -1 | 1;
  d: number;
}

export interface SegmentPlan {
  patternId: string;
  /** 0 = breather, 3 = demanding. Used to avoid stacking hard patterns. */
  intensity: number;
  obstacles: PlannedObstacle[];
  shards: PlannedShard[];
  powerUps: PlannedPowerUp[];
  props: PlannedProp[];
}

export function emptyPlan(patternId: string, intensity = 0): SegmentPlan {
  return { patternId, intensity, obstacles: [], shards: [], powerUps: [], props: [] };
}
