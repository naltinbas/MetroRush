import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Builds a prop out of colored primitives and merges them into (at most) two
 * meshes: one lit body and one unlit glow layer. Every obstacle and scenery
 * prop is a couple of draw calls regardless of how many parts it has.
 */

let bodyMaterial: THREE.MeshStandardMaterial | null = null;
let glowMaterial: THREE.MeshBasicMaterial | null = null;

export function getBodyMaterial(): THREE.MeshStandardMaterial {
  if (!bodyMaterial) {
    bodyMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.18,
    });
  }
  return bodyMaterial;
}

export function getGlowMaterial(): THREE.MeshBasicMaterial {
  if (!glowMaterial) {
    glowMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
    });
  }
  return glowMaterial;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);

export interface PartOptions {
  glow?: boolean;
  rx?: number;
  ry?: number;
  rz?: number;
}

function paint(geo: THREE.BufferGeometry, color: number | string): THREE.BufferGeometry {
  tmpColor.set(color);
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export class MeshKit {
  private bodyParts: THREE.BufferGeometry[] = [];
  private glowParts: THREE.BufferGeometry[] = [];

  private place(source: THREE.BufferGeometry, x: number, y: number, z: number, opts: PartOptions | undefined, color: number | string): void {
    // Polyhedron-based shapes come non-indexed; mergeGeometries needs all parts alike.
    let geo = source;
    if (geo.index) {
      geo = source.toNonIndexed();
      source.dispose();
    }
    tmpEuler.set(opts?.rx ?? 0, opts?.ry ?? 0, opts?.rz ?? 0);
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(x, y, z);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    geo.applyMatrix4(tmpMatrix);
    paint(geo, color);
    if (opts?.glow) this.glowParts.push(geo);
    else this.bodyParts.push(geo);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions): this {
    this.place(new THREE.BoxGeometry(w, h, d), x, y, z, opts, color);
    return this;
  }

  cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions & { segments?: number }): this {
    this.place(new THREE.CylinderGeometry(rTop, rBottom, h, opts?.segments ?? 12), x, y, z, opts, color);
    return this;
  }

  sphere(r: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions & { segments?: number }): this {
    const s = opts?.segments ?? 10;
    this.place(new THREE.SphereGeometry(r, s, s), x, y, z, opts, color);
    return this;
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions & { segments?: number }): this {
    this.place(new THREE.ConeGeometry(r, h, opts?.segments ?? 10), x, y, z, opts, color);
    return this;
  }

  torus(r: number, tube: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions): this {
    this.place(new THREE.TorusGeometry(r, tube, 8, 20), x, y, z, opts, color);
    return this;
  }

  octahedron(r: number, x: number, y: number, z: number, color: number | string, opts?: PartOptions): this {
    this.place(new THREE.OctahedronGeometry(r, 0), x, y, z, opts, color);
    return this;
  }

  /** Merge into a group. Geometries are owned by the group and disposed with it. */
  build(castShadow = true): THREE.Group {
    const group = new THREE.Group();
    if (this.bodyParts.length > 0) {
      const merged = mergeGeometries(this.bodyParts, false);
      for (const g of this.bodyParts) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, getBodyMaterial());
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    if (this.glowParts.length > 0) {
      const merged = mergeGeometries(this.glowParts, false);
      for (const g of this.glowParts) g.dispose();
      if (merged) {
        const mesh = new THREE.Mesh(merged, getGlowMaterial());
        group.add(mesh);
      }
    }
    this.bodyParts = [];
    this.glowParts = [];
    return group;
  }
}

/** Dispose every geometry under an object. Materials are shared and kept. */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
