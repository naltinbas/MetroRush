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

    this.world.segments.forEachNear(3, ahead, (seg) => {
      const pD0 = seg.z - delta - hd;
      const pD1 = seg.z + hd;
      this.checkObstacles(seg, pD0, pD1, pMinX, pMaxX, pMinY, pMaxY, speed);
      this.checkShards(seg, dt, pD0, pD1, magnetRadius);
      this.checkPowerUps(seg, pD0, pD1);
    });

    if (this.debugEnabled) {
      this.playerHelper.box.min.set(pMinX, pMinY, -hd);
      this.playerHelper.box.max.set(pMaxX, pMaxY, hd);
      for (let i = this.helperIndex; i < this.helpers.length; i++) this.helpers[i].visible = false;
    }
  }

  private hideHelpers(): void {
    for (const h of this.helpers) h.visible = false;
  }

  private checkObstacles(seg: Segment, pD0: number, pD1: number, pMinX: number, pMaxX: number, pMinY: number, pMaxY: number, speed: number): void {
    const p = this.player;
    const box = this.box;
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
        } else if (p.autoHopArmed && ob.def.autoHop && !p.airborne && xOverlap) {
          const distAhead = box.minD - pD1;
          if (distAhead > 0 && distAhead <= CONFIG.powerUps.autoHop.leadTime * speed) p.jump(true);
        }
        continue;
      }

      const yOverlap = box.maxY > pMinY && box.minY < pMaxY;
      if (xOverlap && yOverlap) {
        this.resolveHit(ob, box, seg);
        continue;
      }
      if (ob.fatal && !ob.hit) {
        const m = CONFIG.collect.nearMissMargin;
        const v = CONFIG.collect.nearMissVertical;
        const xNear = box.maxX + m > pMinX && box.minX - m < pMaxX;
        const yNear = box.maxY + v > pMinY && box.minY - v < pMaxY;
        if (xNear && yNear) ob.nearMissCandidate = true;
      }
    }
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
    if (p.invulnerable) return;
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
