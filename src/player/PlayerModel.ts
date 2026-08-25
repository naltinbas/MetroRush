import * as THREE from 'three';
import { makeGlowTexture } from '../utils/Textures';

/**
 * Original courier character assembled from capsules and boxes. All limbs are
 * separate meshes so they can be animated from PlayerController.
 */

const JACKET = 0xff7a2f;
const TRIM = 0x1c1f33;
const SKIN = 0xf2c9a8;
const VISOR = 0x35f0ff;
const PACK = 0x2b3050;

function capsule(r: number, len: number, color: number, emissive = 0x000000): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(r, len, 4, 10);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, emissive, emissiveIntensity: 0.8 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function box(w: number, h: number, d: number, color: number, emissive = 0x000000): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, emissive, emissiveIntensity: 1.2 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

export class PlayerModel {
  readonly root = new THREE.Group();
  /** Rotates/translates for slides, stumbles and crashes without disturbing lane position. */
  readonly body = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly torso: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly magnetAura: THREE.Sprite;
  private readonly bootGlow: THREE.Mesh[] = [];
  private readonly sprintTrail: THREE.Mesh;
  private readonly shieldMat: THREE.MeshBasicMaterial;
  private blinkTimer = 0;

  constructor() {
    this.root.add(this.body);

    this.torso = capsule(0.32, 0.5, JACKET);
    this.torso.position.y = 1.15;
    this.body.add(this.torso);

    const chest = box(0.34, 0.08, 0.12, TRIM, VISOR);
    chest.position.set(0, 1.28, 0.3);
    this.body.add(chest);

    const belt = box(0.66, 0.1, 0.5, TRIM);
    belt.position.y = 0.9;
    this.body.add(belt);

    const pack = box(0.5, 0.6, 0.28, PACK);
    pack.position.set(0, 1.25, -0.36);
    this.body.add(pack);
    const packStrip = box(0.36, 0.06, 0.04, TRIM, 0xff3fa4);
    packStrip.position.set(0, 1.35, -0.52);
    this.body.add(packStrip);

    this.head = capsule(0.22, 0.06, SKIN);
    this.head.position.y = 1.78;
    this.body.add(this.head);
    const helmet = capsule(0.25, 0.08, TRIM);
    helmet.position.set(0, 1.86, -0.03);
    helmet.scale.set(1, 0.8, 1);
    this.body.add(helmet);
    const visor = box(0.36, 0.1, 0.1, TRIM, VISOR);
    visor.position.set(0, 1.8, 0.2);
    this.body.add(visor);

    const buildArm = (group: THREE.Group, side: number): void => {
      group.position.set(side * 0.42, 1.48, 0);
      const upper = capsule(0.1, 0.32, JACKET);
      upper.position.y = -0.22;
      group.add(upper);
      const glove = capsule(0.11, 0.08, TRIM);
      glove.position.y = -0.5;
      group.add(glove);
      this.body.add(group);
    };
    buildArm(this.leftArm, -1);
    buildArm(this.rightArm, 1);

    const buildLeg = (group: THREE.Group, side: number): void => {
      group.position.set(side * 0.17, 0.86, 0);
      const thigh = capsule(0.13, 0.36, TRIM);
      thigh.position.y = -0.28;
      group.add(thigh);
      const boot = box(0.24, 0.16, 0.36, JACKET, 0x000000);
      boot.position.set(0, -0.62, 0.05);
      group.add(boot);
      const bootLight = box(0.26, 0.04, 0.3, TRIM, 0x4dff88);
      bootLight.position.set(0, -0.66, 0.05);
      bootLight.visible = false;
      group.add(bootLight);
      this.bootGlow.push(bootLight);
      this.body.add(group);
    };
    buildLeg(this.leftLeg, -1);
    buildLeg(this.rightLeg, 1);

    this.shieldMat = new THREE.MeshBasicMaterial({
      color: 0x4da3ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 14), this.shieldMat);
    this.shield.position.y = 1.05;
    this.shield.visible = false;
    this.root.add(this.shield);

    const glowTex = makeGlowTexture();
    this.magnetAura = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, color: 0xff5e9d, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.magnetAura.scale.set(6, 6, 1);
    this.magnetAura.position.y = 1;
    this.magnetAura.visible = false;
    this.root.add(this.magnetAura);

    const trailMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sprintTrail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 10, 1, true), trailMat);
    this.sprintTrail.rotation.x = -Math.PI / 2;
    this.sprintTrail.position.set(0, 1.1, -1.4);
    this.sprintTrail.visible = false;
    this.root.add(this.sprintTrail);
  }

  setShield(on: boolean): void {
    this.shield.visible = on;
  }

  setMagnet(on: boolean): void {
    this.magnetAura.visible = on;
  }

  setBoots(on: boolean): void {
    for (const b of this.bootGlow) b.visible = on;
  }

  setSprint(on: boolean): void {
    this.sprintTrail.visible = on;
  }

  /** Flash the shield bubble when a hit is absorbed. */
  pulseShield(): void {
    this.shieldMat.opacity = 0.9;
  }

  /**
   * Drives the pose. `runPhase` advances with travel distance so stride
   * frequency scales with speed.
   */
  animate(dt: number, opts: {
    runPhase: number;
    airborne: boolean;
    vy: number;
    sliding: boolean;
    slideT: number;
    stumbleT: number;
    crashed: boolean;
    crashT: number;
    lateralVel: number;
    invulnerable: boolean;
    time: number;
  }): void {
    const { runPhase, airborne, vy, sliding, slideT, stumbleT, crashed, crashT, lateralVel, invulnerable, time } = opts;
    this.shieldMat.opacity += (0.28 - this.shieldMat.opacity) * Math.min(1, dt * 6);
    this.shield.rotation.y += dt * 0.8;
    this.magnetAura.material.opacity = 0.3 + Math.sin(time * 6) * 0.08;
    this.magnetAura.material.rotation += dt * 1.5;

    if (crashed) {
      const t = Math.min(1, crashT / 0.9);
      this.body.rotation.x = Math.min(Math.PI * 0.55, crashT * 4);
      this.body.rotation.z = Math.sin(crashT * 5) * 0.2 * (1 - t);
      this.body.position.y = -t * 0.35;
      this.body.position.z = t * 1.2;
      this.leftArm.rotation.x = -2.2;
      this.rightArm.rotation.x = -2.0;
      this.leftLeg.rotation.x = 0.6;
      this.rightLeg.rotation.x = -0.4;
      this.body.scale.setScalar(1);
      return;
    }

    // Lean into lane changes, pitch forward on stumbles.
    const targetLean = -lateralVel * 0.035;
    this.body.rotation.z += (targetLean - this.body.rotation.z) * Math.min(1, dt * 12);

    if (sliding) {
      const k = Math.sin(Math.min(1, slideT) * Math.PI);
      this.body.rotation.x = -1.15 * Math.min(1, slideT * 6) * (0.35 + 0.65 * Math.max(0.2, k));
      this.body.position.y = -0.85 + (1 - Math.min(1, slideT * 6)) * 0.2;
      this.body.position.z = 0.3;
      this.leftLeg.rotation.x = -0.4;
      this.rightLeg.rotation.x = 0.4;
      this.leftArm.rotation.x = -0.6;
      this.rightArm.rotation.x = -0.3;
    } else if (airborne) {
      const rise = Math.max(-1, Math.min(1, vy / 12));
      this.body.rotation.x = 0.12 - rise * 0.15;
      this.body.position.y = 0;
      this.body.position.z = 0;
      this.leftLeg.rotation.x = -0.9 + rise * 0.3;
      this.rightLeg.rotation.x = 0.5 - rise * 0.4;
      this.leftArm.rotation.x = -1.6 - rise * 0.6;
      this.rightArm.rotation.x = -1.6 - rise * 0.6;
    } else {
      const stride = Math.sin(runPhase);
      this.leftLeg.rotation.x = stride * 0.85;
      this.rightLeg.rotation.x = -stride * 0.85;
      this.leftArm.rotation.x = -stride * 0.8 - 0.25;
      this.rightArm.rotation.x = stride * 0.8 - 0.25;
      this.body.position.y = Math.abs(Math.cos(runPhase)) * 0.05;
      this.body.position.z = 0;
      let pitch = 0.1;
      if (stumbleT > 0) {
        const s = Math.sin(Math.min(1, stumbleT) * Math.PI);
        pitch += s * 0.75;
        this.body.rotation.z += Math.sin(time * 40) * 0.05 * s;
      }
      this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 14);
    }
    this.leftArm.rotation.z = 0.25;
    this.rightArm.rotation.z = -0.25;

    if (invulnerable) {
      this.blinkTimer += dt;
      this.body.visible = Math.floor(this.blinkTimer * 14) % 2 === 0;
    } else {
      this.blinkTimer = 0;
      this.body.visible = true;
    }
  }

  resetPose(): void {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.visible = true;
    this.shield.visible = false;
    this.magnetAura.visible = false;
    this.sprintTrail.visible = false;
    for (const b of this.bootGlow) b.visible = false;
  }
}
