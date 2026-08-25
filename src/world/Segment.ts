import * as THREE from 'three';
import { Shard } from '../entities/Collectible';
import type { Obstacle } from '../entities/Obstacle';
import type { ObstacleFactory } from '../entities/ObstacleFactory';
import type { PowerUpFactory, PowerUpPickup } from '../entities/PowerUp';
import { isPowerUpId } from '../entities/PowerUpDefinitions';
import type { EventBus } from '../utils/EventBus';
import type { ObjectPool } from '../utils/ObjectPool';
import type { Random } from '../utils/Random';
import type { Prop, SceneryBuilder } from './SceneryBuilder';
import type { SegmentPlan } from './SegmentPlan';
import type { TrackBuilder } from './TrackBuilder';

export interface SegmentDeps {
  obstacles: ObstacleFactory;
  powerUps: PowerUpFactory;
  shards: ObjectPool<Shard>;
  scenery: SceneryBuilder;
}

/**
 * One stretch of track. The group scrolls toward the player; everything the
 * segment owns is a child of the group and lives in segment space where the
 * near edge is z = 0 and the far edge is z = -segmentLength.
 */
export class Segment {
  readonly group = new THREE.Group();
  /** World z of the near edge. */
  z = 0;
  /** Track distance of the near edge. */
  startD = 0;
  plan: SegmentPlan | null = null;
  readonly obstacles: Obstacle[] = [];
  readonly shards: Shard[] = [];
  readonly powerUps: PowerUpPickup[] = [];
  readonly props: Prop[] = [];

  constructor(track: TrackBuilder) {
    this.group.add(track.createSegmentMesh());
  }

  populate(plan: SegmentPlan, deps: SegmentDeps, rng: Random): void {
    this.clear(deps);
    this.plan = plan;
    for (const o of plan.obstacles) {
      const ob = deps.obstacles.acquire(o.defId);
      ob.place(o.lane, o.d, o.motion, rng.range(0, 10));
      this.group.add(ob.object);
      this.obstacles.push(ob);
    }
    for (const s of plan.shards) {
      const shard = deps.shards.acquire();
      shard.place(s.lane, s.d, s.y, rng.range(0, Math.PI * 2));
      this.shards.push(shard);
    }
    for (const p of plan.powerUps) {
      if (!isPowerUpId(p.kind)) continue;
      const pickup = deps.powerUps.acquire(p.kind);
      pickup.place(p.lane, p.d);
      this.group.add(pickup.object);
      this.powerUps.push(pickup);
    }
    for (const pr of plan.props) {
      const prop = deps.scenery.acquireProp(pr.kind);
      if (!prop) continue;
      prop.placeAt(pr.side, pr.d);
      this.group.add(prop.object);
      this.props.push(prop);
    }
  }

  clear(deps: SegmentDeps): void {
    for (const o of this.obstacles) o.release();
    this.obstacles.length = 0;
    for (const s of this.shards) deps.shards.release(s);
    this.shards.length = 0;
    for (const p of this.powerUps) p.release();
    this.powerUps.length = 0;
    for (const p of this.props) p.release();
    this.props.length = 0;
    this.plan = null;
  }

  update(dt: number, speed: number, events: EventBus, time: number): void {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (o.active) o.update(dt, this.z, speed, events);
    }
    for (let i = 0; i < this.powerUps.length; i++) {
      const p = this.powerUps[i];
      if (p.active) p.update(time);
    }
    for (let i = 0; i < this.props.length; i++) this.props[i].update(time);
  }
}
