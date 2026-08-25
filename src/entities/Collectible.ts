import * as THREE from 'three';
import { CONFIG, laneX } from '../game/Config';
import { Entity } from './Entity';

/**
 * Energy shard. Rendering is done by ShardRenderer through one InstancedMesh,
 * so a shard is just a few numbers and the pool is trivial.
 */
export class Shard extends Entity {
  readonly object: THREE.Object3D = new THREE.Object3D();
  x = 0;
  y = 0;
  baseY = 0;
  phase = 0;
  collected = false;
  /** Magnet pulled this shard off its grid position. */
  pulled = false;
  /** Offset along the track relative to d, used while being pulled. */
  dOffset = 0;

  place(lane: number, d: number, y: number, phase: number): void {
    this.lane = lane;
    this.d = d;
    this.x = laneX(lane);
    this.baseY = y;
    this.y = y;
    this.phase = phase;
    this.collected = false;
    this.pulled = false;
    this.dOffset = 0;
    this.active = true;
  }

  release(): void {
    this.active = false;
  }
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

export class ShardRenderer {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private overflowWarned = false;

  constructor(readonly capacity = 700) {
    const geo = new THREE.OctahedronGeometry(0.3, 0);
    geo.scale(0.7, 1.5, 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7ff6ff,
      emissive: 0x2ad8f0,
      emissiveIntensity: 1.1,
      roughness: 0.25,
      metalness: 0.3,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  write(shard: Shard, segZ: number, time: number): void {
    if (this.count >= this.capacity) {
      if (!this.overflowWarned) {
        this.overflowWarned = true;
        console.warn('ShardRenderer capacity exceeded; some shards are not drawn');
      }
      return;
    }
    const bob = Math.sin(time * 3 + shard.phase) * CONFIG.collect.shardBobHeight;
    _pos.set(shard.x, shard.y + bob, segZ - (shard.d + shard.dOffset));
    _euler.set(0, time * CONFIG.collect.shardSpin + shard.phase, 0);
    _quat.setFromEuler(_euler);
    _scale.setScalar(1);
    _mat.compose(_pos, _quat, _scale);
    this.mesh.setMatrixAt(this.count++, _mat);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
