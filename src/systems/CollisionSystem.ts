import * as THREE from 'three';
import { makeAABB, type AABB } from '../entities/Entity';
import type { PowerUpManager } from '../entities/PowerUpManager';
import { CONFIG } from '../game/Config';
import type { PlayerController } from '../player/PlayerController';
import type { EventBus } from '../utils/EventBus';
import type { Segment } from '../world/Segment';
import type { WorldManager } from '../world/WorldManager';
import type { ScoreSystem } from './ScoreSystem';

/**
 * Player-vs-world tests. Everything is an axis-aligned box in segment space.
 * The along-track axis is swept by the distance the world moved this frame so
 * thin obstacles cannot tunnel through the player at high speed or low FPS.
 */
export class CollisionSystem {
  private readonly box: AABB = makeAABB();
  private readonly scratch: AABB = makeAABB();
  private readonly debugGroup = new THREE.Group();
  private readonly helpers: THREE.Box3Helper[] = [];
  private readonly playerHelper: THREE.Box3Helper;
  private debugEnabled = false;
  private helperIndex = 0;

  constructor(
    scene: THREE.Scene,
    private readonly player: PlayerController,
    private readonly world: WorldManager,
    private readonly powerUps: PowerUpManager,
    private readonly score: ScoreSystem,
    private readonly events: EventBus,
  ) {
    scene.add(this.debugGroup);
    this.debugGroup.visible = false;
    for (let i = 0; i < 48; i++) {
      const h = new THREE.Box3Helper(new THREE.Box3(), 0xff4060);
      h.visible = false;
      this.helpers.push(h);
      this.debugGroup.add(h);
    }
    this.playerHelper = new THREE.Box3Helper(new THREE.Box3(), 0x40ff90);
    this.debugGroup.add(this.playerHelper);
  }

  setDebug(on: boolean): void {
    this.debugEnabled = on;
    this.debugGroup.visible = on;
  }

  /**
   * @param delta meters the world scrolled this frame
   * @param speed current scroll speed (for auto-hop look-ahead)
   */
  update(dt: number, delta: number, speed: number): void {
    const p = this.player;
    if (p.crashed) {
      if (this.debugEnabled) this.hideHelpers();
      return;
    }
    const hw = CONFIG.player.halfWidth;
    const hd = CONFIG.player.halfDepth;
    const pMinX = p.x - hw;
    const pMaxX = p.x + hw;
    const pMinY = p.y;
    const pMaxY = p.y + p.height;
    this.helperIndex = 0;

    const magnetRadius = this.powerUps.magnetRadius;
    const ahead = Math.max(18, magnetRadius + 6);

    this.fDt = dt;
    this.fDelta = delta;
    this.fSpeed = speed;
    this.fMinX = pMinX;
    this.fMaxX = pMaxX;
    this.fMagnet = magnetRadius;
    this.world.segments.forEachNear(3, ahead, this.visitSegment);

    if (this.debugEnabled) {
      this.playerHelper.box.min.set(pMinX, pMinY, -hd);
      this.playerHelper.box.max.set(pMaxX, pMaxY, hd);
      for (let i = this.helperIndex; i < this.helpers.length; i++) this.helpers[i].visible = false;
    }
  }

  dispose(): void {
    this.debugGroup.traverse((o) => {
      const line = o as THREE.LineSegments;
      if (line.isLineSegments) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    });
    this.debugGroup.removeFromParent();
  }

  // Per-frame parameters for visitSegment, so the callback is allocated once.
  private fDt = 0;
  private fDelta = 0;
  private fSpeed = 0;
  private fMinX = 0;
  private fMaxX = 0;
  private fMagnet = 0;
  private readonly visitSegment = (seg: Segment): void => {
    const hd = CONFIG.player.halfDepth;
    const pD0 = seg.z - this.fDelta - hd;
    const pD1 = seg.z + hd;
    this.checkObstacles(seg, this.fDelta, pD0, pD1, this.fMinX, this.fMaxX, this.fSpeed);
    this.checkShards(seg, this.fDt, pD0, pD1, this.fMagnet);
    this.checkPowerUps(seg, pD0, pD1);
  };

  private hideHelpers(): void {
    for (const h of this.helpers) h.visible = false;
  }

  private checkObstacles(seg: Segment, delta: number, pD0: number, pD1: number, pMinX: number, pMaxX: number, speed: number): void {
    const p = this.player;
    const box = this.box;
    const hw = CONFIG.player.halfWidth;
    const hd = CONFIG.player.halfDepth;
    const height = p.height;
    for (let i = 0; i < seg.obstacles.length; i++) {
      const ob = seg.obstacles[i];
      if (!ob.active || ob.passed) continue;
      ob.writeBounds(box);

      if (this.debugEnabled && this.helperIndex < this.helpers.length) {
        const h = this.helpers[this.helperIndex++];
        h.box.min.set(box.minX, box.minY, seg.z - box.maxD);
        h.box.max.set(box.maxX, box.maxY, seg.z - box.minD);
        h.visible = true;
      }

      const xOverlap = box.maxX > pMinX && box.minX < pMaxX;
      const zOverlap = box.maxD + ob.dDelta >= pD0 && box.minD <= pD1;
      if (!zOverlap) {
        if (box.maxD < pD0) {
          ob.passed = true;
          if (ob.nearMissCandidate && !ob.hit && ob.fatal) {
            const bonus = this.score.addNearMiss();
            this.events.emit('nearMiss', { bonus, x: ob.x, y: 1.2, z: seg.z - box.minD });
          }
        } else if (p.autoHopArmed && ob.def.autoHop && ob.def.avoid === 'jump' && !p.airborne && !p.sliding && !p.slidePending && xOverlap) {
          const distAhead = box.minD - pD1;
          if (distAhead > 0 && distAhead <= CONFIG.powerUps.autoHop.leadTime * speed && !this.overheadAhead(pMinX, pMaxX, speed)) {
            p.jump(true);
          }
        }
        continue;
      }

      // The along-track ranges overlap only for part of the frame. Work out
      // that window and test the player's x/y at its start, middle and end,
      // so a clean jump that leaves the crate mid-frame is not scored against
      // the end-of-frame feet height.
      const rel = delta + ob.dDelta;
      let fA = 0;
      let fB = 1;
      if (rel > 1e-6) {
        fA = Math.max(0, (box.minD + ob.dDelta - (seg.z - delta + hd)) / rel);
        fB = Math.min(1, (box.maxD + ob.dDelta - (seg.z - delta - hd)) / rel);
      }
      let hit = false;
      let near = false;
      const m = CONFIG.collect.nearMissMargin;
      const v = CONFIG.collect.nearMissVertical;
      for (let k = 0; k < 3; k++) {
        const f = k === 0 ? fA : k === 1 ? (fA + fB) * 0.5 : fB;
        const x = p.prevX + (p.x - p.prevX) * f;
        const y = p.prevY + (p.y - p.prevY) * f;
        const xo = box.maxX > x - hw && box.minX < x + hw;
        const yo = box.maxY > y && box.minY < y + height;
        if (xo && yo) {
          hit = true;
          break;
        }
        if (box.maxX + m > x - hw && box.minX - m < x + hw && box.maxY + v > y && box.minY - v < y + height) near = true;
      }
      if (hit) {
        ob.nearMissCandidate = false;
        this.resolveHit(ob, box, seg);
        continue;
      }
      if (ob.fatal && !ob.hit && near) ob.nearMissCandidate = true;
    }
  }

  /** True when a slide-under obstacle sits in the player's lane inside one jump's worth of track. */
  private overheadAhead(pMinX: number, pMaxX: number, speed: number): boolean {
    const mv = CONFIG.movement;
    const reach = ((2 * mv.jumpVelocity) / Math.abs(mv.gravity)) * speed + CONFIG.player.halfDepth;
    let found = false;
    this.world.segments.forEachNear(1, reach + 2, (seg) => {
      if (found) return;
      for (let i = 0; i < seg.obstacles.length; i++) {
        const o = seg.obstacles[i];
        if (!o.active || o.passed || o.def.avoid !== 'slide') continue;
        o.writeBounds(this.scratch);
        const ahead = this.scratch.minD - seg.z;
        if (ahead < reach && this.scratch.maxD > seg.z - CONFIG.player.halfDepth && this.scratch.maxX > pMinX && this.scratch.minX < pMaxX) {
          found = true;
          return;
        }
      }
    });
    return found;
  }

  private resolveHit(ob: Segment['obstacles'][number], box: AABB, seg: Segment): void {
    if (ob.hit) return;
    const p = this.player;
    const def = ob.def;
    const hitZ = seg.z - ob.dNow;

    if (def.avoid === 'clutter') {
      if (p.clutterProtected) return;
      ob.hit = true;
      p.stumble();
      this.score.penalty();
      return;
    }
    if (p.invulnerable) {
      ob.hit = true;
      return;
    }
    // Feet barely clipping the top of a jumpable obstacle: forgive with a stumble.
    if (def.avoid === 'jump' && p.airborne && p.y > box.maxY - CONFIG.player.clipTolerance) {
      ob.hit = true;
      p.stumble();
      this.score.penalty();
      return;
    }
    if (this.powerUps.consumeShield()) {
      ob.hit = true;
      p.shieldGrace();
      this.events.emit('shieldBroken', { x: p.x, y: p.y + 1, z: hitZ });
      return;
    }
    ob.hit = true;
    p.crash();
  }

  private checkShards(seg: Segment, dt: number, pD0: number, pD1: number, magnetRadius: number): void {
    const p = this.player;
    const px = p.x;
    const py = p.y + 1.0;
    const rx = CONFIG.collect.shardRadiusX;
    const yPad = CONFIG.collect.shardRadiusY;
    const pull = CONFIG.powerUps.magnet.pullSpeed;
    for (let i = 0; i < seg.shards.length; i++) {
      const s = seg.shards[i];
      if (!s.active || s.collected) continue;
      const sd = s.d + s.dOffset;
      const wz = seg.z - sd;
      if (wz > 6 || wz < -(magnetRadius + 4)) continue;

      if (magnetRadius > 0) {
        const dx = px - s.x;
        const dy = py - s.y;
        const dz = 0 - wz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < magnetRadius) {
          s.pulled = true;
          const step = Math.min(dist, (pull + (magnetRadius - dist) * 4) * dt);
          if (dist > 1e-4) {
            s.x += (dx / dist) * step;
            s.y += (dy / dist) * step;
            s.dOffset -= (dz / dist) * step;
          }
        }
      }

      let hit: boolean;
      if (s.pulled) {
        const dx = px - s.x;
        const dy = py - s.y;
        const dz = 0 - (seg.z - (s.d + s.dOffset));
        hit = dx * dx + dy * dy + dz * dz < 1.3 * 1.3;
      } else {
        const d = s.d + s.dOffset;
        hit = Math.abs(s.x - px) <= rx && s.y >= p.y - yPad && s.y <= p.y + p.height + yPad && d >= pD0 - 0.3 && d <= pD1 + 0.3;
      }
      if (hit) {
        s.collected = true;
        const streak = this.score.addShard();
        this.events.emit('shardCollected', { x: s.x, y: s.y, z: seg.z - (s.d + s.dOffset), streak });
      }
    }
  }

  private checkPowerUps(seg: Segment, pD0: number, pD1: number): void {
    const p = this.player;
    for (let i = 0; i < seg.powerUps.length; i++) {
      const pu = seg.powerUps[i];
      if (!pu.active || pu.collected) continue;
      const inLane = Math.abs(pu.x - p.x) <= 1.3;
      const inD = pu.d >= pD0 - 0.8 && pu.d <= pD1 + 0.8;
      const inY = p.y - 0.6 <= 1.3 && p.y + p.height + 0.7 >= 1.3;
      if (inLane && inD && inY) {
        pu.collected = true;
        pu.object.visible = false;
        this.powerUps.activate(pu.def.id);
        this.events.emit('powerUpCollected', { id: pu.def.id, x: pu.x, y: 1.3, z: seg.z - pu.d });
      }
    }
  }
}
