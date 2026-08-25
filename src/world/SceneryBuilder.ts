import * as THREE from 'three';
import { CONFIG, trackHalfWidth, type QualityLevel } from '../game/Config';
import type { Theme } from '../game/Themes';
import { MeshKit, getGlowMaterial } from '../utils/MeshKit';
import { ObjectPool } from '../utils/ObjectPool';
import { Random } from '../utils/Random';
import { makeCloudTexture, makeSignTexture, makeWindowTexture } from '../utils/Textures';

/** A pooled decorative object placed on a segment's side ledge. */
export class Prop {
  private releaseFn: ((p: Prop) => void) | null = null;
  constructor(
    readonly kind: string,
    readonly object: THREE.Object3D,
  ) {}

  bindPool(fn: (p: Prop) => void): void {
    this.releaseFn = fn;
  }

  placeAt(side: -1 | 1, d: number): void {
    const hw = trackHalfWidth();
    if (this.kind === 'arch') {
      this.object.position.set(0, 0, -d);
    } else {
      this.object.position.set(side * (hw + 2.0), -0.3, -d);
      this.object.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    this.object.visible = true;
  }

  update(time: number): void {
    if (this.kind === 'vent') {
      const fan = this.object.getObjectByName('fan');
      if (fan) fan.rotation.z = time * 5;
    } else if (this.kind === 'antenna') {
      const light = this.object.getObjectByName('blink');
      if (light) light.visible = Math.floor(time * 1.5) % 2 === 0;
    } else if (this.kind === 'holo') {
      const h = this.object.getObjectByName('holo');
      if (h) h.rotation.y = time * 0.9;
    }
  }

  release(): void {
    this.object.visible = false;
    if (this.object.parent) this.object.parent.remove(this.object);
    if (this.releaseFn) this.releaseFn(this);
  }
}

const SIGN_LABELS = ['SKYRAIL', 'SECTOR 7', 'MAINT', 'DEPOT 12', 'COURIER', 'ENERGY', 'DOCK B', 'LIFT 4', 'NO IDLE', 'ROUTE 9'];

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.45));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Backdrop: gradient sky dome, stars, drifting clouds, a scrolling instanced
 * skyline, a static far skyline ring, and pooled side props.
 */
export class SceneryBuilder {
  readonly root = new THREE.Group();
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly starsMaterial: THREE.PointsMaterial;
  private readonly clouds: THREE.Sprite[] = [];
  private readonly cloudMaterial: THREE.SpriteMaterial;
  private readonly nearSkyline: THREE.InstancedMesh;
  private readonly farSkyline: THREE.InstancedMesh;
  private readonly nearZ: Float32Array;
  private readonly nearData: { x: number; w: number; h: number; d: number }[] = [];
  private readonly ground: THREE.Mesh;
  private readonly groundMaterial: THREE.MeshBasicMaterial;
  private readonly buildingMaterialNear: THREE.MeshStandardMaterial;
  private readonly buildingMaterialFar: THREE.MeshStandardMaterial;
  private readonly windowTexture: THREE.Texture;
  private readonly propPools = new Map<string, ObjectPool<Prop>>();
  private readonly signTextures: THREE.Texture[] = [];
  private theme: Theme;
  private readonly rng = new Random(1337);
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  constructor(theme: Theme) {
    this.theme = theme;

    // Sky dome.
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(theme.skyTop) },
        uHorizon: { value: new THREE.Color(theme.skyHorizon) },
        uBottom: { value: new THREE.Color(theme.skyBottom) },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), this.skyMaterial);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.root.add(dome);

    // Stars.
    const starCount = 700;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = this.rng.range(0, Math.PI * 2);
      const phi = this.rng.range(0.05, Math.PI / 2.2);
      const r = 950;
      starPos[i * 3] = r * Math.cos(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi);
      starPos[i * 3 + 2] = r * Math.cos(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: theme.starBrightness,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starsMaterial);
    this.stars.frustumCulled = false;
    this.root.add(this.stars);

    // Clouds as big soft sprites near the horizon.
    this.cloudMaterial = new THREE.SpriteMaterial({
      map: makeCloudTexture(),
      color: theme.cloudTint,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(this.cloudMaterial);
      const spread = this.rng.range(-420, 420);
      s.position.set(spread, this.rng.range(30, 90), -this.rng.range(380, 600));
      s.scale.set(this.rng.range(160, 300), this.rng.range(60, 110), 1);
      this.clouds.push(s);
      this.root.add(s);
    }

    // Ground haze plane far below the track.
    this.groundMaterial = new THREE.MeshBasicMaterial({ color: theme.fog });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -62;
    this.root.add(this.ground);

    // Skylines.
    this.windowTexture = makeWindowTexture();
    this.buildingMaterialNear = this.makeBuildingMaterial(1.0, true);
    this.buildingMaterialFar = this.makeBuildingMaterial(0.55, false);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);

    const nearCount = 130;
    this.nearSkyline = new THREE.InstancedMesh(boxGeo, this.buildingMaterialNear, nearCount);
    this.nearSkyline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nearSkyline.frustumCulled = false;
    this.nearZ = new Float32Array(nearCount);
    const hw = trackHalfWidth();
    for (let i = 0; i < nearCount; i++) {
      const side = this.rng.sign();
      const x = side * (hw + 14 + Math.pow(this.rng.next(), 1.3) * 110);
      const h = 8 + Math.pow(this.rng.next(), 1.8) * 60;
      const w = this.rng.range(6, 16);
      const d = this.rng.range(6, 16);
      this.nearData.push({ x, w, h, d });
      this.nearZ[i] = this.rng.range(-330, 60);
      this.tmpColor.set(this.rng.pick(theme.buildingTints));
      this.nearSkyline.setColorAt(i, this.tmpColor);
    }
    this.writeNearMatrices();
    this.setQuality(CONFIG.quality);
    this.root.add(this.nearSkyline);

    const farCount = 110;
    this.farSkyline = new THREE.InstancedMesh(boxGeo, this.buildingMaterialFar, farCount);
    this.farSkyline.frustumCulled = false;
    for (let i = 0; i < farCount; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(420, 640);
      const h = 30 + Math.pow(this.rng.next(), 1.4) * 150;
      this.tmpPos.set(Math.cos(ang) * r, -60, Math.sin(ang) * r);
      this.tmpScale.set(this.rng.range(18, 40), h, this.rng.range(18, 40));
      this.tmpQuat.identity();
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.farSkyline.setMatrixAt(i, this.tmpMatrix);
      this.tmpColor.set(this.rng.pick(theme.buildingTints));
      this.farSkyline.setColorAt(i, this.tmpColor);
    }
    this.farSkyline.instanceMatrix.needsUpdate = true;
    this.root.add(this.farSkyline);

    for (let i = 0; i < SIGN_LABELS.length; i++) {
      const accent = theme.accents[i % theme.accents.length];
      const c = '#' + accent.toString(16).padStart(6, '0');
      this.signTextures.push(makeSignTexture(SIGN_LABELS[i], c, '#ffffff'));
    }
    this.initPropPools();
  }

  private makeBuildingMaterial(emissive: number, fog: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.0,
      emissive: 0xffffff,
      emissiveIntensity: emissive,
      emissiveMap: this.windowTexture,
      fog,
    });
    // Windows are sampled in the instance's scaled local space, so every
    // building gets the same window size, side faces get windows too, and
    // the pattern stays attached while the building scrolls.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWinScale = { value: new THREE.Vector2(0.3, 0.22) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec3 lp = transformed;
          vec3 on = normal;
          vSeed = 0.0;
          #ifdef USE_INSTANCING
            lp = mat3(instanceMatrix) * transformed;
            on = mat3(instanceMatrix) * on;
            vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[1].y * 0.071;
          #endif
          vWPos = lp;
          vWNormal = normalize(mat3(modelMatrix) * on);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSeed;\nuniform vec2 uWinScale;')
        .replace(
          '#include <emissivemap_fragment>',
          `vec3 an = abs(vWNormal);
          vec2 wuv = an.x > an.z ? vWPos.zy : vWPos.xy;
          wuv = wuv * uWinScale + vec2(fract(vSeed), fract(vSeed * 3.1));
          float sideMask = step(an.y, 0.5);
          vec4 emissiveColor = texture2D(emissiveMap, wuv);
          totalEmissiveRadiance *= emissiveColor.rgb * sideMask;`,
        );
    };
    return mat;
  }

  private writeNearMatrices(): void {
    for (let i = 0; i < this.nearData.length; i++) {
      const b = this.nearData[i];
      this.tmpPos.set(b.x, -60, this.nearZ[i]);
      this.tmpScale.set(b.w, b.h + 60, b.d);
      this.tmpQuat.identity();
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.nearSkyline.setMatrixAt(i, this.tmpMatrix);
    }
    this.nearSkyline.instanceMatrix.needsUpdate = true;
  }

  /** Low quality draws half the scrolling skyline. The buffers stay allocated so this can flip at runtime. */
  setQuality(level: QualityLevel): void {
    this.nearSkyline.count = level === 'low' ? Math.floor(this.nearData.length / 2) : this.nearData.length;
  }

  update(dt: number, speed: number, _time: number): void {
    const dz = speed * dt;
    for (let i = 0; i < this.nearZ.length; i++) {
      this.nearZ[i] += dz;
      if (this.nearZ[i] - this.nearData[i].d / 2 > 70) {
        this.nearZ[i] -= 400;
        const b = this.nearData[i];
        b.h = 8 + Math.pow(this.rng.next(), 1.8) * 60;
      }
    }
    this.writeNearMatrices();
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      if (c.position.x > 500) c.position.x = -500;
    }
  }

  applyTheme(theme: Theme): void {
    this.theme = theme;
    (this.skyMaterial.uniforms.uTop.value as THREE.Color).set(theme.skyTop);
    (this.skyMaterial.uniforms.uHorizon.value as THREE.Color).set(theme.skyHorizon);
    (this.skyMaterial.uniforms.uBottom.value as THREE.Color).set(theme.skyBottom);
    this.starsMaterial.opacity = theme.starBrightness;
    this.cloudMaterial.color.set(theme.cloudTint);
    this.groundMaterial.color.set(theme.fog);
    for (let i = 0; i < this.nearData.length; i++) {
      this.tmpColor.set(this.rng.pick(theme.buildingTints));
      this.nearSkyline.setColorAt(i, this.tmpColor);
    }
    if (this.nearSkyline.instanceColor) this.nearSkyline.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.farSkyline.count; i++) {
      this.tmpColor.set(this.rng.pick(theme.buildingTints));
      this.farSkyline.setColorAt(i, this.tmpColor);
    }
    if (this.farSkyline.instanceColor) this.farSkyline.instanceColor.needsUpdate = true;
  }

  // ---- props ------------------------------------------------------------

  private initPropPools(): void {
    const kinds: Record<string, () => THREE.Object3D> = {
      sign: () => this.buildSign(),
      vent: () => this.buildVent(),
      spool: () => this.buildSpool(),
      kiosk: () => this.buildKiosk(),
      barrels: () => this.buildBarrels(),
      antenna: () => this.buildAntenna(),
      holo: () => this.buildHolo(),
      arch: () => this.buildArch(),
      crane: () => this.buildCrane(),
    };
    for (const [kind, build] of Object.entries(kinds)) {
      const pool: ObjectPool<Prop> = new ObjectPool<Prop>(() => {
        const p = new Prop(kind, build());
        p.bindPool((inst) => pool.release(inst));
        return p;
      });
      this.propPools.set(kind, pool);
    }
  }

  acquireProp(kind: string): Prop | null {
    const pool = this.propPools.get(kind);
    return pool ? pool.acquire() : null;
  }

  private buildSign(): THREE.Object3D {
    const root = new THREE.Group();
    const kit = new MeshKit();
    kit.cylinder(0.08, 0.1, 3.2, 0, 1.6, 0, 0x8f97b3, { segments: 8 });
    kit.box(2.7, 1.1, 0.12, 0, 3.6, 0, 0x14141f);
    root.add(kit.build(false));
    const tex = this.signTextures[this.rng.int(0, this.signTextures.length - 1)];
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.set(0, 3.6, 0.07);
    root.add(face);
    const back = face.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.07;
    root.add(back);
    return root;
  }

  private buildVent(): THREE.Object3D {
    const root = new THREE.Group();
    const kit = new MeshKit();
    kit.box(1.8, 1.6, 1.8, 0, 0.8, 0, 0x4b5270);
    kit.cylinder(0.75, 0.75, 0.2, 0, 0.9, 0.95, 0x2a2e44, { rx: Math.PI / 2, segments: 16 });
    root.add(kit.build(false));
    const fanKit = new MeshKit();
    for (let i = 0; i < 4; i++) fanKit.box(1.2, 0.18, 0.05, 0, 0, 0, 0x9aa3bd, { rz: (i * Math.PI) / 4 });
    const fan = fanKit.build(false);
    fan.name = 'fan';
    fan.position.set(0, 0.9, 1.06);
    root.add(fan);
    return root;
  }

  private buildSpool(): THREE.Object3D {
    const kit = new MeshKit();
    kit.cylinder(0.9, 0.9, 0.15, 0, 0.9, -0.6, 0x8c6a3f, { rx: Math.PI / 2, segments: 14 });
    kit.cylinder(0.9, 0.9, 0.15, 0, 0.9, 0.6, 0x8c6a3f, { rx: Math.PI / 2, segments: 14 });
    kit.cylinder(0.55, 0.55, 1.1, 0, 0.9, 0, 0x2f3346, { rx: Math.PI / 2, segments: 14 });
    kit.box(0.4, 0.3, 1.6, -0.6, 0.15, 0, 0x3a3f5c);
    kit.box(0.4, 0.3, 1.6, 0.6, 0.15, 0, 0x3a3f5c);
    return kit.build(false);
  }

  private buildKiosk(): THREE.Object3D {
    const kit = new MeshKit();
    const accent = this.theme.accents[this.rng.int(0, this.theme.accents.length - 1)];
    kit.box(1.4, 2.4, 1.0, 0, 1.2, 0, 0x3f4566);
    kit.box(1.0, 1.2, 0.06, 0, 1.5, 0.52, accent, { glow: true });
    kit.box(1.2, 0.08, 0.5, 0, 2.5, 0.2, accent, { glow: true });
    kit.box(0.6, 0.3, 0.1, 0, 0.6, 0.52, 0x14141f);
    return kit.build(false);
  }

  private buildBarrels(): THREE.Object3D {
    const kit = new MeshKit();
    const colors = [0x2c6fff, 0xff9f2e, 0x3fd9c7];
    for (let i = 0; i < 3; i++) {
      const x = -0.7 + i * 0.7;
      const z = (i % 2) * 0.5 - 0.25;
      kit.cylinder(0.32, 0.32, 0.9, x, 0.45, z, colors[i], { segments: 12 });
      kit.cylinder(0.34, 0.34, 0.06, x, 0.25, z, 0x14141f, { segments: 12 });
      kit.cylinder(0.34, 0.34, 0.06, x, 0.7, z, 0x14141f, { segments: 12 });
    }
    return kit.build(false);
  }

  private buildAntenna(): THREE.Object3D {
    const root = new THREE.Group();
    const kit = new MeshKit();
    kit.box(0.6, 0.4, 0.6, 0, 0.2, 0, 0x3a3f5c);
    kit.cylinder(0.05, 0.08, 7, 0, 3.7, 0, 0x9aa3bd, { segments: 6 });
    kit.box(0.6, 0.05, 0.05, 0, 5.5, 0, 0x9aa3bd);
    kit.box(0.05, 0.05, 0.6, 0, 6.2, 0, 0x9aa3bd);
    root.add(kit.build(false));
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2f4f, toneMapped: false }));
    blink.name = 'blink';
    blink.position.y = 7.3;
    root.add(blink);
    return root;
  }

  private buildHolo(): THREE.Object3D {
    const root = new THREE.Group();
    const kit = new MeshKit();
    kit.cylinder(0.7, 0.8, 0.3, 0, 0.15, 0, 0x2a2e44, { segments: 14 });
    kit.cylinder(0.5, 0.5, 0.1, 0, 0.35, 0, this.theme.accents[2], { glow: true, segments: 14 });
    root.add(kit.build(false));
    const holo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.35, 2.6, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: this.theme.accents[2],
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    holo.name = 'holo';
    holo.position.y = 1.7;
    root.add(holo);
    return root;
  }

  private buildArch(): THREE.Object3D {
    const kit = new MeshKit();
    const hw = trackHalfWidth();
    const accent = this.theme.accents[this.rng.int(0, this.theme.accents.length - 1)];
    kit.box(0.6, 7, 0.6, -(hw + 0.6), 3.5, 0, 0x33385a);
    kit.box(0.6, 7, 0.6, hw + 0.6, 3.5, 0, 0x33385a);
    kit.box(hw * 2 + 1.8, 0.7, 0.8, 0, 7.2, 0, 0x33385a);
    kit.box(hw * 2 + 1.0, 0.08, 0.1, 0, 6.82, 0.3, accent, { glow: true });
    kit.box(hw * 2 + 1.0, 0.08, 0.1, 0, 6.82, -0.3, accent, { glow: true });
    return kit.build(false);
  }

  private buildCrane(): THREE.Object3D {
    const kit = new MeshKit();
    kit.box(1.2, 0.5, 1.2, 0, 0.25, 0, 0x3a3f5c);
    kit.box(0.5, 9, 0.5, 0, 4.75, 0, 0xff9f2e);
    kit.box(6, 0.4, 0.4, -1.5, 9.2, 0, 0xff9f2e);
    kit.box(0.4, 0.4, 0.4, -4.3, 8.6, 0, 0x14141f);
    kit.box(0.05, 3, 0.05, -4.3, 7.0, 0, 0x9aa3bd);
    kit.box(0.6, 0.5, 0.6, -4.3, 5.4, 0, 0x8c4a2a);
    kit.sphere(0.12, 0, 9.5, 0, 0xff2f4f, { glow: true, segments: 6 });
    return kit.build(false);
  }

  dispose(): void {
    this.skyMaterial.dispose();
    this.starsMaterial.dispose();
    this.stars.geometry.dispose();
    this.cloudMaterial.dispose();
    this.groundMaterial.dispose();
    this.ground.geometry.dispose();
    this.buildingMaterialNear.dispose();
    this.buildingMaterialFar.dispose();
    this.nearSkyline.geometry.dispose();
    this.windowTexture.dispose();
    for (const t of this.signTextures) t.dispose();
    getGlowMaterial();
  }
}
