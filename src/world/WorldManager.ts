import * as THREE from 'three';
import { Shard, ShardRenderer } from '../entities/Collectible';
import { ObstacleFactory } from '../entities/ObstacleFactory';
import { PowerUpFactory } from '../entities/PowerUp';
import { CONFIG, type ThemeId } from '../game/Config';
import { getTheme, type Theme } from '../game/Themes';
import type { EventBus } from '../utils/EventBus';
import { ObjectPool } from '../utils/ObjectPool';
import { PatternGenerator } from './PatternGenerator';
import { SceneryBuilder } from './SceneryBuilder';
import type { SegmentDeps } from './Segment';
import { SegmentManager, type SpawnContext } from './SegmentManager';
import { TrackBuilder } from './TrackBuilder';

/**
 * Owns everything in the scene that is not the player or the camera: lights,
 * fog, backdrop, the segment ring, and the shared entity pools.
 */
export class WorldManager {
  readonly track: TrackBuilder;
  readonly scenery: SceneryBuilder;
  readonly segments: SegmentManager;
  readonly generator: PatternGenerator;
  readonly shardRenderer: ShardRenderer;
  readonly obstacles = new ObstacleFactory();
  readonly powerUps = new PowerUpFactory();
  readonly shardPool = new ObjectPool<Shard>(() => new Shard());
  readonly deps: SegmentDeps;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fog: THREE.Fog;
  theme: Theme;
  private time = 0;

  constructor(
    readonly scene: THREE.Scene,
    private readonly events: EventBus,
  ) {
    this.theme = getTheme(CONFIG.theme);
    this.fog = new THREE.Fog(this.theme.fog, CONFIG.world.fogNear, CONFIG.world.fogFar);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(this.theme.hemiSky, this.theme.hemiGround, 0.9);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(this.theme.ambient, 0.35);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(this.theme.sunColor, this.theme.sunIntensity);
    this.sun.position.set(...this.theme.sunPosition);
    this.sun.target.position.set(0, 0, -10);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.configureShadows();

    this.track = new TrackBuilder(this.theme);
    this.scenery = new SceneryBuilder(this.theme);
    scene.add(this.scenery.root);
    this.shardRenderer = new ShardRenderer();
    scene.add(this.shardRenderer.mesh);

    this.generator = new PatternGenerator(CONFIG.debug.seed ?? undefined);
    this.deps = { obstacles: this.obstacles, powerUps: this.powerUps, shards: this.shardPool, scenery: this.scenery };
    this.segments = new SegmentManager(scene, this.track, this.deps, this.generator);
    this.obstacles.prewarm({ crate: 4, cones: 3, sign_low: 2, pipe: 2, cart: 2 });
  }

  configureShadows(): void {
    const on = CONFIG.render.shadows;
    this.sun.castShadow = on;
    if (on) {
      const s = CONFIG.render.shadowMapSize;
      this.sun.shadow.mapSize.set(s, s);
      const cam = this.sun.shadow.camera;
      cam.left = -16;
      cam.right = 16;
      cam.top = 30;
      cam.bottom = -14;
      cam.near = 1;
      cam.far = 160;
      this.sun.shadow.bias = -0.0015;
      this.sun.shadow.normalBias = 0.02;
      cam.updateProjectionMatrix();
    }
  }

  setSpawnContext(fn: () => SpawnContext): void {
    this.segments.setContext(fn);
  }

  reset(seed: number | undefined): void {
    this.segments.reset(seed);
  }

  get playerD(): number {
    return this.segments.playerD;
  }

  update(dt: number, speed: number): void {
    this.time += dt;
    this.segments.update(dt, speed, this.events, this.time);
    this.scenery.update(dt, speed, this.time);
    this.renderShards();
  }

  private renderShards(): void {
    const r = this.shardRenderer;
    r.begin();
    const segs = this.segments.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      for (let j = 0; j < seg.shards.length; j++) {
        const s = seg.shards[j];
        if (s.active && !s.collected) r.write(s, seg.z, this.time);
      }
    }
    r.end();
  }

  applyTheme(id: ThemeId): void {
    CONFIG.theme = id;
    this.theme = getTheme(id);
    const t = this.theme;
    this.fog.color.set(t.fog);
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.ambient.color.set(t.ambient);
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sunIntensity;
    this.sun.position.set(...t.sunPosition);
    this.track.applyTheme(t);
    this.scenery.applyTheme(t);
  }

  dispose(): void {
    for (const seg of this.segments.segments) {
      seg.clear(this.deps);
      this.scene.remove(seg.group);
    }
    this.obstacles.dispose();
    this.powerUps.dispose();
    this.track.dispose();
    this.scenery.dispose();
    this.shardRenderer.dispose();
    this.scene.remove(this.scenery.root, this.shardRenderer.mesh, this.sun, this.sun.target, this.hemi, this.ambient);
  }
}
