import * as THREE from 'three';
import { CONFIG } from '../game/Config';
import type { PlayerController } from '../player/PlayerController';
import { clamp, damp } from '../utils/MathUtils';

/**
 * Third-person chase camera. The player never moves forward, so the camera
 * only has to follow lane changes and jumps, lean into turns, bob with the
 * stride, widen its FOV with speed and shake on impacts.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private smoothX = 0;
  private smoothY = 0;
  private roll = 0;
  private bobPhase = 0;
  private shakeAmp = 0;
  private shakeTime = 0;
  private fov: number;
  private readonly look = new THREE.Vector3();

  constructor(aspect: number) {
    const c = CONFIG.camera;
    this.fov = c.fov;
    this.camera = new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);
    this.reset();
  }

  reset(): void {
    const c = CONFIG.camera;
    this.smoothX = 0;
    this.smoothY = 0;
    this.roll = 0;
    this.shakeAmp = 0;
    this.fov = c.fov;
    this.camera.fov = c.fov;
    this.camera.position.set(0, c.height, c.distance);
    this.camera.lookAt(0, c.lookHeight, -c.lookAhead);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(intensity: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, intensity);
  }

  update(dt: number, player: PlayerController, speed: number, sprint: boolean, speedProgress: number): void {
    const c = CONFIG.camera;
    this.smoothX = damp(this.smoothX, player.x * 0.72, c.followRate, dt);
    this.smoothY = damp(this.smoothY, player.y * 0.35, c.followRate, dt);

    const grounded = !player.airborne && !player.sliding && !player.crashed;
    this.bobPhase += (speed / 1.9) * dt;
    const bob = grounded ? Math.abs(Math.sin(this.bobPhase)) * c.bobAmount : 0;

    const targetRoll = clamp(-player.lateralVelocity * c.leanPerVelocity, -c.maxLean, c.maxLean);
    this.roll = damp(this.roll, targetRoll, 10, dt);

    this.shakeTime += dt;
    this.shakeAmp = damp(this.shakeAmp, 0, c.shakeDecay, dt);
    const sx = Math.sin(this.shakeTime * 61) * this.shakeAmp * 0.25;
    const sy = Math.cos(this.shakeTime * 47) * this.shakeAmp * 0.2;

    const dist = c.distance + speedProgress * 0.8;
    this.camera.position.set(this.smoothX + sx, c.height + this.smoothY + bob + sy, dist);
    this.look.set(player.x * 0.4 + sx * 0.5, c.lookHeight + player.y * 0.3 + sy * 0.5, -c.lookAhead);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(this.roll);

    const targetFov = c.fov + (sprint ? c.sprintFovBoost : 0) + speedProgress * 5;
    if (Math.abs(targetFov - this.fov) > 0.01) {
      this.fov = damp(this.fov, targetFov, 4, dt);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
