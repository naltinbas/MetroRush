import type * as THREE from 'three';
import { CONFIG } from '../game/Config';
import type { EventBus } from '../utils/EventBus';
import type { PatternGenerator } from './PatternGenerator';
import { Segment, type SegmentDeps } from './Segment';
import type { TrackBuilder } from './TrackBuilder';

export interface SpawnContext {
  difficulty: number;
  speed: number;
  attract: boolean;
}

/**
 * Ring of segments. Segments scroll toward +z; once the near edge is far
 * enough behind the player the segment is moved to the far end and refilled
 * with a freshly generated plan.
 */
export class SegmentManager {
  readonly segments: Segment[] = [];
  totalDistance = 0;
  private context: () => SpawnContext = () => ({ difficulty: 0, speed: CONFIG.movement.initialSpeed, attract: false });

  constructor(
    private readonly scene: THREE.Scene,
    track: TrackBuilder,
    private readonly deps: SegmentDeps,
    private readonly generator: PatternGenerator,
  ) {
    for (let i = 0; i < CONFIG.world.activeSegmentCount; i++) {
      const seg = new Segment(track);
      this.segments.push(seg);
      this.scene.add(seg.group);
    }
  }

  setContext(fn: () => SpawnContext): void {
    this.context = fn;
  }

  /** Track distance of the player (world z = 0). */
  get playerD(): number {
    return CONFIG.world.startOffset + this.totalDistance;
  }

  reset(seed: number | undefined): void {
    const L = CONFIG.world.segmentLength;
    this.totalDistance = 0;
    this.generator.reset(seed, CONFIG.world.startOffset);
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      seg.clear(this.deps);
      seg.startD = i * L;
      seg.z = CONFIG.world.startOffset - i * L;
      seg.group.position.set(0, 0, seg.z);
      this.fill(seg);
    }
  }

  private fill(seg: Segment): void {
    const ctx = this.context();
    const distanceAhead = Math.max(0, -seg.z);
    const timeToReach = distanceAhead / Math.max(1, ctx.speed);
    const mv = CONFIG.movement;
    const speedHigh = Math.min(mv.maxSpeed, ctx.speed + mv.speedAcceleration * timeToReach) + CONFIG.powerUps.sprint.bonusSpeed;
    const speedLow = Math.max(mv.initialSpeed, ctx.speed * 0.85);
    const plan = this.generator.generate({
      startD: seg.startD,
      difficulty: ctx.difficulty,
      speedLow,
      speedHigh,
      attract: ctx.attract,
    });
    seg.populate(plan, this.deps, this.generator.rng);
  }

  update(dt: number, speed: number, events: EventBus, time: number): void {
    const dz = speed * dt;
    this.totalDistance += dz;
    const L = CONFIG.world.segmentLength;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      seg.z += dz;
      seg.group.position.z = seg.z;
      seg.update(dt, speed, events, time);
    }
    // Recycle segments that are fully behind the camera.
    while (this.segments[0].z - L > CONFIG.world.recycleBehind) {
      const seg = this.segments.shift()!;
      const last = this.segments[this.segments.length - 1];
      seg.startD = last.startD + L;
      seg.z = last.z - L;
      seg.group.position.z = seg.z;
      this.segments.push(seg);
      this.fill(seg);
    }
  }

  /** Segments whose track range overlaps [playerD - back, playerD + ahead]. */
  forEachNear(back: number, ahead: number, fn: (seg: Segment) => void): void {
    const L = CONFIG.world.segmentLength;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      // Player sits at d = seg.z within this segment's local frame, so the
      // window [seg.z - back, seg.z + ahead] must overlap [0, L].
      if (seg.z + ahead < 0) continue;
      if (seg.z - back > L) continue;
      fn(seg);
    }
  }

  /** Segment containing the player, if any. */
  current(): Segment | null {
    const L = CONFIG.world.segmentLength;
    for (const seg of this.segments) if (seg.z >= 0 && seg.z <= L) return seg;
    return null;
  }
}
