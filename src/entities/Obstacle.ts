import * as THREE from 'three';
import { laneX } from '../game/Config';
import type { EventBus } from '../utils/EventBus';
import { lerp } from '../utils/MathUtils';
import type { MotionSpec } from '../world/SegmentPlan';
import { Entity, type AABB } from './Entity';
import type { ObstacleDef } from './ObstacleDefinitions';

/**
 * A placed obstacle instance. The mesh is a child of the segment group, so
 * its position is expressed in segment space (z = -d).
 */
export class Obstacle extends Entity {
  readonly object: THREE.Object3D;
  motion: MotionSpec | undefined;

  /** Current centre x, updated for lateral movers. */
  x = 0;
  /** Current distance into the segment, updated for oncoming movers. */
  dNow = 0;
  /** How far dNow decreased this frame (used to sweep collisions). */
  dDelta = 0;
  private time = 0;
  private activated = false;
  private horned = false;
  private traveled = 0;

  hit = false;
  passed = false;
  nearMissCandidate = false;

  private releaseFn: ((o: Obstacle) => void) | null = null;

  constructor(readonly def: ObstacleDef) {
    super();
    this.object = def.build();
  }

  bindPool(fn: (o: Obstacle) => void): void {
    this.releaseFn = fn;
  }

  place(lane: number, d: number, motion: MotionSpec | undefined, rngPhase: number): void {
    this.lane = lane;
    this.d = d;
    this.dNow = d;
    this.dDelta = 0;
    this.motion = motion;
    this.time = rngPhase;
    this.activated = false;
    this.horned = false;
    this.traveled = 0;
    this.hit = false;
    this.passed = false;
    this.nearMissCandidate = false;
    this.active = true;
    this.x = (laneX(lane) + laneX(lane + this.def.laneSpan - 1)) / 2;
    if (motion?.type === 'lateral') this.x = laneX(motion.laneFrom);
    this.object.position.set(this.x, 0, -d);
    this.object.visible = true;
    const beam = this.object.getObjectByName('beam');
    if (beam) beam.visible = false;
  }

  /**
   * @param segZ world z of the owning segment's near edge
   * @param speed current world scroll speed
   */
  update(dt: number, segZ: number, speed: number, events: EventBus): void {
    this.time += dt;
    this.dDelta = 0;
    const m = this.motion;
    if (m?.type === 'oncoming') {
      const worldZ = segZ - this.dNow;
      if (!this.activated) {
        const travelTime = m.travel / m.speed;
        const activationDist = speed * travelTime * 0.55 + 6;
        if (!this.horned && worldZ > -(activationDist + speed * 0.9)) {
          this.horned = true;
          events.emit('tramHorn', {});
          const beam = this.object.getObjectByName('beam');
          if (beam) beam.visible = true;
        }
        if (worldZ > -activationDist) this.activated = true;
      } else if (this.traveled < m.travel) {
        const step = Math.min(m.speed * dt, m.travel - this.traveled);
        this.dNow -= step;
        this.traveled += step;
        this.dDelta = step;
        this.object.position.z = -this.dNow;
        if (this.traveled >= m.travel) {
          const beam = this.object.getObjectByName('beam');
          if (beam) beam.visible = false;
        }
      }
    } else if (m?.type === 'lateral') {
      const u = 0.5 - 0.5 * Math.cos((this.time / m.period) * Math.PI * 2 + m.phase);
      this.x = lerp(laneX(m.laneFrom), laneX(m.laneTo), u);
      this.object.position.x = this.x;
    }
    if (this.def.animate) this.def.animate(this.object, this.time);
  }

  writeBounds(out: AABB): void {
    const def = this.def;
    out.minX = this.x - def.width / 2;
    out.maxX = this.x + def.width / 2;
    out.minY = def.yMin;
    out.maxY = def.yMax;
    out.minD = this.dNow - def.depth / 2;
    out.maxD = this.dNow + def.depth / 2;
  }

  /** True when the obstacle is one the player must react to (not clutter). */
  get fatal(): boolean {
    return this.def.avoid !== 'clutter';
  }

  release(): void {
    this.active = false;
    this.object.visible = false;
    if (this.object.parent) this.object.parent.remove(this.object);
    if (this.releaseFn) this.releaseFn(this);
  }
}
