import * as THREE from 'three';
import { CONFIG, type QualityLevel } from '../game/Config';

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  count: number;
  color: number | number[];
  speed: number;
  spread?: number;
  life: number;
  size: number;
  /** Scale along z, for streaks. */
  stretch?: number;
  gravity?: number;
  /** Particle rides along with the scrolling world. */
  drift?: boolean;
  dirX?: number;
  dirY?: number;
  dirZ?: number;
}

/**
 * One InstancedMesh of tiny cubes. Particles are stored in flat typed arrays
 * and swap-removed when they die, so there is no allocation after startup.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  /** Live particles are capped here; lower on low quality. */
  private limit: number;
  private count = 0;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly stretch: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drift: Uint8Array;
  private readonly colors: Float32Array;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpColor = new THREE.Color();
  private speedLineTimer = 0;

  constructor() {
    this.capacity = CONFIG.effects.particleCapacity;
    this.limit = this.capacity;
    const n = this.capacity;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.stretch = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drift = new Uint8Array(n);
    this.colors = new Float32Array(n * 3);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.tmpColor.set(0xffffff));
    if (this.mesh.instanceColor) this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.setQuality(CONFIG.quality);
  }

  setQuality(level: QualityLevel): void {
    this.limit = level === 'low' ? CONFIG.effects.particleCapacityLow : this.capacity;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  emit(o: EmitOptions): void {
    const spread = o.spread ?? 1;
    const palette = Array.isArray(o.color) ? o.color : [o.color];
    for (let n = 0; n < o.count; n++) {
      if (this.count >= this.limit) return;
      const i = this.count++;
      this.px[i] = o.x + (Math.random() - 0.5) * 0.3;
      this.py[i] = o.y + (Math.random() - 0.5) * 0.3;
      this.pz[i] = o.z + (Math.random() - 0.5) * 0.3;
      const dx = (o.dirX ?? 0) + (Math.random() - 0.5) * 2 * spread;
      const dy = (o.dirY ?? 0) + (Math.random() - 0.5) * 2 * spread;
      const dz = (o.dirZ ?? 0) + (Math.random() - 0.5) * 2 * spread;
      const len = Math.hypot(dx, dy, dz) || 1;
      const sp = o.speed * (0.5 + Math.random() * 0.8);
      this.vx[i] = (dx / len) * sp;
      this.vy[i] = (dy / len) * sp;
      this.vz[i] = (dz / len) * sp;
      this.maxLife[i] = o.life * (0.6 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.size[i] = o.size * (0.6 + Math.random() * 0.8);
      this.stretch[i] = o.stretch ?? 1;
      this.gravity[i] = o.gravity ?? 0;
      this.drift[i] = o.drift ? 1 : 0;
      this.tmpColor.set(palette[Math.floor(Math.random() * palette.length)]);
      this.colors[i * 3] = this.tmpColor.r;
      this.colors[i * 3 + 1] = this.tmpColor.g;
      this.colors[i * 3 + 2] = this.tmpColor.b;
    }
  }

  // ---- presets ------------------------------------------------------------

  shardBurst(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 10, color: [0x7ff6ff, 0xffffff, 0x2ad8f0], speed: 4, life: 0.4, size: 0.12, drift: true, gravity: -6 });
  }

  sparks(x: number, y: number, z: number, big: boolean): void {
    this.emit({
      x,
      y,
      z,
      count: big ? 40 : 14,
      color: [0xffb347, 0xff6a2f, 0xffe8a0],
      speed: big ? 9 : 5,
      life: big ? 0.9 : 0.5,
      size: 0.14,
      gravity: -18,
      drift: true,
      dirY: 0.6,
    });
  }

  shieldBurst(x: number, y: number, z: number): void {
    this.emit({ x, y, z, count: 36, color: [0x4da3ff, 0xbfe0ff, 0xffffff], speed: 7, life: 0.7, size: 0.16, drift: true });
  }

  pickupBurst(x: number, y: number, z: number, color: number): void {
    this.emit({ x, y, z, count: 24, color: [color, 0xffffff], speed: 5, life: 0.6, size: 0.14, drift: true, gravity: -4 });
  }

  dust(x: number, z: number, speed: number): void {
    this.emit({ x, y: 0.05, z, count: 1, color: [0x9aa3bd, 0x6f7891], speed: 1.2, life: 0.35, size: 0.1, drift: true, dirY: 1, dirZ: 0.5, spread: 0.5, gravity: 2 });
    void speed;
  }

  /** Long thin streaks that rush past the camera during sprint. */
  speedLines(dt: number, speed: number): void {
    if (!CONFIG.effects.speedLines) return;
    this.speedLineTimer += dt;
    while (this.speedLineTimer > 0.03) {
      this.speedLineTimer -= 0.03;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.emit({
        x: side * (4 + Math.random() * 5),
        y: 0.5 + Math.random() * 5,
        z: -40 - Math.random() * 30,
        count: 1,
        color: [0xffd9a0, 0xffffff],
        speed: speed * 1.4,
        life: 1.2,
        size: 0.06,
        stretch: 40,
        spread: 0,
        dirZ: 1,
      });
    }
  }

  update(dt: number, worldSpeed: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }
      this.vy[i] += this.gravity[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt + (this.drift[i] ? worldSpeed * dt : 0);
      if (this.py[i] < 0.02 && this.gravity[i] < 0) {
        this.py[i] = 0.02;
        this.vy[i] *= -0.3;
      }
      i++;
    }
    for (let j = 0; j < this.count; j++) {
      const t = this.life[j] / this.maxLife[j];
      const s = this.size[j] * (0.3 + 0.7 * t);
      this.tmpPos.set(this.px[j], this.py[j], this.pz[j]);
      this.tmpScale.set(s, s, s * this.stretch[j]);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(j, this.tmpMatrix);
      this.tmpColor.setRGB(this.colors[j * 3], this.colors[j * 3 + 1], this.colors[j * 3 + 2]);
      this.mesh.setColorAt(j, this.tmpColor);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private remove(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      this.px[i] = this.px[last];
      this.py[i] = this.py[last];
      this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.vz[i] = this.vz[last];
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last];
      this.stretch[i] = this.stretch[last];
      this.gravity[i] = this.gravity[last];
      this.drift[i] = this.drift[last];
      this.colors[i * 3] = this.colors[last * 3];
      this.colors[i * 3 + 1] = this.colors[last * 3 + 1];
      this.colors[i * 3 + 2] = this.colors[last * 3 + 2];
    }
    this.count--;
  }

  get alive(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
