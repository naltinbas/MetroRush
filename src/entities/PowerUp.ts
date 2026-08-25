import * as THREE from 'three';
import { laneX } from '../game/Config';
import { disposeObject } from '../utils/MeshKit';
import { ObjectPool } from '../utils/ObjectPool';
import { Entity } from './Entity';
import { POWER_UP_DEFS, POWER_UP_IDS, type PowerUpDef, type PowerUpId } from './PowerUpDefinitions';

/** A power-up pickup sitting on the track. */
export class PowerUpPickup extends Entity {
  readonly object: THREE.Object3D;
  x = 0;
  collected = false;
  private releaseFn: ((p: PowerUpPickup) => void) | null = null;

  constructor(readonly def: PowerUpDef) {
    super();
    this.object = def.buildPickup();
  }

  bindPool(fn: (p: PowerUpPickup) => void): void {
    this.releaseFn = fn;
  }

  place(lane: number, d: number): void {
    this.lane = lane;
    this.d = d;
    this.x = laneX(lane);
    this.collected = false;
    this.active = true;
    this.object.position.set(this.x, 1.3, -d);
    this.object.visible = true;
  }

  update(time: number): void {
    const spin = this.object.getObjectByName('spin');
    if (spin) spin.rotation.y = time * 1.8;
    this.object.position.y = 1.3 + Math.sin(time * 2.5) * 0.12;
  }

  release(): void {
    this.active = false;
    this.object.visible = false;
    if (this.object.parent) this.object.parent.remove(this.object);
    if (this.releaseFn) this.releaseFn(this);
  }
}

export class PowerUpFactory {
  private pools = new Map<PowerUpId, ObjectPool<PowerUpPickup>>();

  constructor() {
    for (const id of POWER_UP_IDS) {
      const pool: ObjectPool<PowerUpPickup> = new ObjectPool<PowerUpPickup>(() => {
        const p = new PowerUpPickup(POWER_UP_DEFS[id]);
        p.bindPool((inst) => pool.release(inst));
        return p;
      });
      this.pools.set(id, pool);
    }
  }

  acquire(id: PowerUpId): PowerUpPickup {
    return this.pools.get(id)!.acquire();
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      pool.forEachCreated((p) => {
        disposeObject(p.object);
        p.object.traverse((o) => {
          const sprite = o as THREE.Sprite;
          if (sprite.isSprite) sprite.material.dispose();
        });
      });
    }
  }
}
