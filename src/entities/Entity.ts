import type * as THREE from 'three';

/** Axis-aligned box in segment space: x/y are world axes, d runs along the track. */
export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minD: number;
  maxD: number;
}

export function makeAABB(): AABB {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, minD: 0, maxD: 0 };
}

/** Anything that lives inside a segment and is pooled. */
export abstract class Entity {
  abstract readonly object: THREE.Object3D;
  active = false;
  lane = 0;
  /** Distance into the owning segment. */
  d = 0;

  abstract release(): void;
}
