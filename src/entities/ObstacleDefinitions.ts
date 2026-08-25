import * as THREE from 'three';
import { CONFIG, trackHalfWidth } from '../game/Config';
import { MeshKit } from '../utils/MeshKit';
import type { AvoidAction } from '../world/SegmentPlan';

/**
 * Data-driven obstacle catalogue. Collider sizes are deliberately a little
 * smaller than the visuals so the game reads as dangerous while staying
 * forgiving. Overhead colliders start at 1.45 m: the slide height is 0.9 m.
 * Jumpable colliders top out at 1.15 m: a jump peaks at 2.25 m.
 */
export interface ObstacleDef {
  id: string;
  label: string;
  avoid: AvoidAction;
  /** Lanes covered, starting at the placed lane. */
  laneSpan: number;
  /** Collider depth along the track. */
  depth: number;
  /** Total collider width across the covered lanes. */
  width: number;
  yMin: number;
  yMax: number;
  /** Auto-hop boots may jump this automatically. */
  autoHop: boolean;
  build: () => THREE.Object3D;
  animate?: (obj: THREE.Object3D, time: number) => void;
}

const LANE = CONFIG.lanes.spacing;
const RUST = 0x8c4a2a;
const AMBER = 0xff9f2e;
const STEEL = 0x6f7891;
const DARK = 0x262a3d;
const WARN_RED = 0xff2f4f;
const WARN_YELLOW = 0xffd447;
const MAGENTA = 0xff3fa4;
const TEAL = 0x3fd9c7;

function laneWidth(span: number): number {
  return span * LANE - 0.8;
}

/**
 * Two posts at the deck edges with a crossbar; overhead obstacles hang from it.
 * Named 'gantry' so Obstacle.place() can keep it in track space while the
 * rest of the obstacle sits in its lane.
 */
function gantry(barY: number, depth: number, color = STEEL): THREE.Object3D {
  const kit = new MeshKit();
  const hx = trackHalfWidth() - 0.5;
  kit.box(0.3, barY + 0.3, 0.3, -hx, (barY + 0.3) / 2, 0, color);
  kit.box(0.3, barY + 0.3, 0.3, hx, (barY + 0.3) / 2, 0, color);
  kit.box(hx * 2 + 0.3, 0.28, depth, 0, barY + 0.15, 0, color);
  kit.box(0.12, 0.12, depth + 0.1, -hx, barY + 0.36, 0, WARN_YELLOW, { glow: true });
  kit.box(0.12, 0.12, depth + 0.1, hx, barY + 0.36, 0, WARN_YELLOW, { glow: true });
  const obj = kit.build();
  obj.name = 'gantry';
  return obj;
}

function crate(kit: MeshKit, x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
  kit.box(w, h, d, x, y + h / 2, z, color);
  kit.box(w + 0.04, 0.12, d + 0.04, x, y + h * 0.5, z, DARK);
  kit.box(0.12, h + 0.04, d + 0.04, x - w * 0.3, y + h / 2, z, DARK);
  kit.box(0.12, h + 0.04, d + 0.04, x + w * 0.3, y + h / 2, z, DARK);
  kit.box(w * 0.5, 0.05, 0.08, x, y + h * 0.78, z + d / 2 + 0.02, AMBER, { glow: true });
}

function tram(kit: MeshKit, length: number): void {
  const w = 2.5;
  const h = 2.6;
  const bodyY = 0.55;
  kit.box(w, h - bodyY, length, 0, bodyY + (h - bodyY) / 2, 0, 0xdfe6f2);
  kit.box(w + 0.06, 0.5, length + 0.02, 0, 1.55, 0, 0x2c6fff);
  kit.box(w - 0.4, 0.6, length - 1.2, 0, h + 0.2, 0, 0xb8c2d6);
  kit.box(w - 0.6, 0.3, 0.6, 0, bodyY + 0.15, length / 2 - 0.2, DARK);
  kit.box(w - 0.6, 0.3, 0.6, 0, bodyY + 0.15, -length / 2 + 0.2, DARK);
  // Hover skids instead of wheels.
  kit.box(w - 0.5, 0.25, length - 0.6, 0, bodyY - 0.1, 0, DARK);
  kit.box(w - 0.7, 0.08, length - 0.8, 0, bodyY - 0.24, 0, TEAL, { glow: true });
  // Front visor and headlights facing the player (+z).
  kit.box(w - 0.5, 0.9, 0.1, 0, 1.95, length / 2 + 0.03, 0x1a2a4a);
  kit.box(0.4, 0.18, 0.06, -0.8, 1.05, length / 2 + 0.05, 0xfff6c8, { glow: true });
  kit.box(0.4, 0.18, 0.06, 0.8, 1.05, length / 2 + 0.05, 0xfff6c8, { glow: true });
  kit.box(w - 0.6, 0.1, 0.06, 0, 0.72, length / 2 + 0.05, WARN_RED, { glow: true });
  // Side strip lights
  kit.box(0.05, 0.08, length - 1, -w / 2 - 0.02, 2.2, 0, TEAL, { glow: true });
  kit.box(0.05, 0.08, length - 1, w / 2 + 0.02, 2.2, 0, TEAL, { glow: true });
}

export const OBSTACLE_DEFS: readonly ObstacleDef[] = [
  {
    id: 'crate',
    label: 'Cargo crate',
    avoid: 'jump',
    laneSpan: 1,
    depth: 1.6,
    width: laneWidth(1),
    yMin: 0,
    yMax: 1.15,
    autoHop: true,
    build: () => {
      const kit = new MeshKit();
      crate(kit, 0, 0, 0, 2.2, 1.4, 1.6, AMBER);
      return kit.build();
    },
  },
  {
    id: 'crate_stack',
    label: 'Stacked crates',
    avoid: 'block',
    laneSpan: 1,
    depth: 1.8,
    width: laneWidth(1),
    yMin: 0,
    yMax: 2.5,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      crate(kit, 0, 0, 0, 2.3, 1.4, 1.8, AMBER);
      crate(kit, 0.1, 1.4, 0, 2.0, 1.3, 1.6, RUST);
      return kit.build();
    },
  },
  {
    id: 'rail_panel',
    label: 'Broken rail panel',
    avoid: 'jump',
    laneSpan: 1,
    depth: 2.0,
    width: laneWidth(1),
    yMin: 0,
    yMax: 0.8,
    autoHop: true,
    build: () => {
      const kit = new MeshKit();
      kit.box(2.4, 0.18, 2.2, 0, 0.45, 0, STEEL, { rx: 0.42 });
      kit.box(2.4, 0.18, 1.0, 0, 0.1, -1.2, STEEL, { rx: -0.2 });
      kit.box(0.2, 0.7, 0.2, -0.9, 0.35, 0.6, DARK);
      kit.box(0.2, 0.9, 0.2, 0.8, 0.45, 0.2, DARK);
      kit.box(2.2, 0.06, 0.08, 0, 0.95, 0.95, WARN_RED, { glow: true });
      kit.cone(0.12, 0.3, -0.6, 0.15, -0.6, WARN_YELLOW, { glow: true });
      return kit.build();
    },
  },
  {
    id: 'cart',
    label: 'Equipment cart',
    avoid: 'jump',
    laneSpan: 1,
    depth: 2.0,
    width: laneWidth(1),
    yMin: 0,
    yMax: 1.0,
    autoHop: true,
    build: () => {
      const kit = new MeshKit();
      kit.box(1.9, 0.5, 2.1, 0, 0.75, 0, 0x4d5a7a);
      kit.box(1.7, 0.4, 1.7, 0, 1.05, 0, STEEL);
      kit.box(1.5, 0.3, 0.9, 0.1, 1.3, 0.2, WARN_YELLOW);
      kit.cylinder(0.22, 0.22, 0.2, -0.85, 0.25, 0.8, DARK, { rz: Math.PI / 2 });
      kit.cylinder(0.22, 0.22, 0.2, 0.85, 0.25, 0.8, DARK, { rz: Math.PI / 2 });
      kit.cylinder(0.22, 0.22, 0.2, -0.85, 0.25, -0.8, DARK, { rz: Math.PI / 2 });
      kit.cylinder(0.22, 0.22, 0.2, 0.85, 0.25, -0.8, DARK, { rz: Math.PI / 2 });
      kit.box(1.4, 0.06, 0.06, 0, 0.55, 1.06, AMBER, { glow: true });
      return kit.build();
    },
  },
  {
    id: 'cones',
    label: 'Safety cones',
    avoid: 'clutter',
    laneSpan: 1,
    depth: 1.2,
    width: laneWidth(1) - 0.4,
    yMin: 0,
    yMax: 0.55,
    autoHop: true,
    build: () => {
      const kit = new MeshKit();
      for (const [x, z] of [
        [-0.7, 0.4],
        [0.1, -0.4],
        [0.8, 0.3],
      ]) {
        kit.box(0.5, 0.06, 0.5, x, 0.03, z, DARK);
        kit.cone(0.22, 0.7, x, 0.38, z, AMBER);
        kit.cylinder(0.16, 0.18, 0.08, x, 0.45, z, 0xffffff, { glow: true });
      }
      return kit.build();
    },
  },
  {
    id: 'gate',
    label: 'Maintenance gate',
    avoid: 'block',
    laneSpan: 1,
    depth: 0.6,
    width: laneWidth(1),
    yMin: 0,
    yMax: 2.6,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      kit.box(0.24, 2.9, 0.3, -1.35, 1.45, 0, STEEL);
      kit.box(0.24, 2.9, 0.3, 1.35, 1.45, 0, STEEL);
      kit.box(2.9, 0.26, 0.3, 0, 2.9, 0, STEEL);
      for (let i = 0; i < 5; i++) kit.box(0.08, 2.6, 0.08, -1.0 + i * 0.5, 1.35, 0, DARK);
      kit.box(2.5, 0.12, 0.1, 0, 1.6, 0.12, WARN_RED, { glow: true });
      kit.box(2.5, 0.12, 0.1, 0, 0.7, 0.12, WARN_RED, { glow: true });
      kit.box(2.4, 0.5, 0.06, 0, 2.3, 0.18, 0x3a0d18);
      kit.box(2.0, 0.16, 0.04, 0, 2.3, 0.22, WARN_RED, { glow: true });
      return kit.build();
    },
  },
  {
    id: 'sign_low',
    label: 'Low hanging sign',
    avoid: 'slide',
    laneSpan: 1,
    depth: 0.6,
    width: laneWidth(1),
    yMin: 1.45,
    yMax: 3.2,
    autoHop: false,
    build: () => {
      const root = new THREE.Group();
      root.add(gantry(3.6, 0.3));
      const kit = new MeshKit();
      // Hanger rods and the sign board itself.
      kit.box(0.08, 1.2, 0.08, -0.9, 3.0, 0, STEEL);
      kit.box(0.08, 1.2, 0.08, 0.9, 3.0, 0, STEEL);
      kit.box(2.4, 1.0, 0.16, 0, 1.9, 0, DARK);
      kit.box(2.2, 0.8, 0.06, 0, 1.9, 0.1, MAGENTA, { glow: true });
      kit.box(2.2, 0.8, 0.06, 0, 1.9, -0.1, MAGENTA, { glow: true });
      kit.box(1.4, 0.18, 0.02, 0, 1.9, 0.14, 0x1a0a14);
      kit.box(2.5, 0.08, 0.24, 0, 1.36, 0, WARN_RED, { glow: true });
      root.add(kit.build());
      return root;
    },
  },
  {
    id: 'pipe',
    label: 'Service pipe',
    avoid: 'slide',
    laneSpan: CONFIG.lanes.count,
    depth: 0.9,
    width: laneWidth(CONFIG.lanes.count),
    yMin: 1.5,
    yMax: 2.8,
    autoHop: false,
    build: () => {
      const root = new THREE.Group();
      root.add(gantry(3.4, 0.4));
      const kit = new MeshKit();
      const len = trackHalfWidth() * 2 - 0.4;
      kit.cylinder(0.4, 0.4, len, 0, 1.8, 0, TEAL, { rz: Math.PI / 2, segments: 14 });
      kit.cylinder(0.46, 0.46, 0.3, -3.2, 1.8, 0, STEEL, { rz: Math.PI / 2 });
      kit.cylinder(0.46, 0.46, 0.3, 0, 1.8, 0, STEEL, { rz: Math.PI / 2 });
      kit.cylinder(0.46, 0.46, 0.3, 3.2, 1.8, 0, STEEL, { rz: Math.PI / 2 });
      for (const x of [-3.2, 0, 3.2]) {
        kit.box(0.14, 1.3, 0.14, x, 2.85, 0, STEEL);
        kit.sphere(0.12, x, 1.28, 0, WARN_RED, { glow: true, segments: 8 });
      }
      root.add(kit.build());
      return root;
    },
  },
  {
    id: 'arm',
    label: 'Mechanical arm',
    avoid: 'slide',
    laneSpan: 1,
    depth: 1.0,
    width: laneWidth(1),
    yMin: 1.45,
    yMax: 3.0,
    autoHop: false,
    build: () => {
      const root = new THREE.Group();
      root.add(gantry(3.8, 0.5, 0x5a4a7a));
      const base = new MeshKit();
      base.box(0.9, 0.5, 0.9, 0, 3.45, 0, DARK);
      root.add(base.build());
      const arm = new MeshKit();
      arm.cylinder(0.14, 0.14, 1.5, 0, -0.75, 0, STEEL);
      arm.box(0.9, 0.35, 0.6, 0, -1.55, 0, 0x5a4a7a);
      arm.box(0.18, 0.5, 0.25, -0.35, -1.95, 0, STEEL);
      arm.box(0.18, 0.5, 0.25, 0.35, -1.95, 0, STEEL);
      arm.sphere(0.13, 0, -1.55, 0.32, WARN_RED, { glow: true, segments: 8 });
      const armObj = arm.build();
      armObj.name = 'arm';
      armObj.position.y = 3.45;
      root.add(armObj);
      return root;
    },
    animate: (obj, time) => {
      const arm = obj.getObjectByName('arm');
      if (arm) arm.rotation.z = Math.sin(time * 2.2) * 0.12;
    },
  },
  {
    id: 'bar',
    label: 'Construction bar',
    avoid: 'slide',
    laneSpan: 2,
    depth: 0.6,
    width: laneWidth(2),
    yMin: 1.45,
    yMax: 2.9,
    autoHop: false,
    build: () => {
      const root = new THREE.Group();
      root.add(gantry(3.5, 0.3));
      const kit = new MeshKit();
      const len = LANE * 2 + 0.4;
      kit.box(len, 0.32, 0.32, 0, 1.75, 0, WARN_YELLOW);
      for (let i = 0; i < 6; i++) kit.box(0.3, 0.34, 0.34, -len / 2 + 0.5 + i * (len / 6), 1.75, 0, DARK);
      kit.box(0.12, 1.6, 0.12, -len / 2 + 0.3, 2.7, 0, STEEL);
      kit.box(0.12, 1.6, 0.12, len / 2 - 0.3, 2.7, 0, STEEL);
      kit.sphere(0.12, 0, 1.5, 0.15, WARN_RED, { glow: true, segments: 8 });
      root.add(kit.build());
      return root;
    },
  },
  {
    id: 'tram_parked',
    label: 'Parked cargo tram',
    avoid: 'block',
    laneSpan: 1,
    depth: 10,
    width: laneWidth(1),
    yMin: 0,
    yMax: 2.8,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      tram(kit, 10);
      return kit.build();
    },
  },
  {
    id: 'tram_moving',
    label: 'Incoming rail car',
    avoid: 'block',
    laneSpan: 1,
    depth: 10,
    width: laneWidth(1),
    yMin: 0,
    yMax: 2.8,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      tram(kit, 10);
      const root = kit.build();
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 6, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.name = 'beam';
      beam.rotation.x = Math.PI / 2;
      beam.position.set(0, 1.05, 8);
      beam.visible = false;
      root.add(beam);
      return root;
    },
  },
  {
    id: 'wall',
    label: 'Barricade wall',
    avoid: 'block',
    laneSpan: 2,
    depth: 0.8,
    width: laneWidth(2),
    yMin: 0,
    yMax: 2.4,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      const w = LANE * 2 - 0.3;
      kit.box(w, 2.3, 0.7, 0, 1.15, 0, 0x8a8ea0);
      kit.box(w, 0.3, 0.75, 0, 2.45, 0, WARN_YELLOW);
      for (let i = 0; i < 6; i++) kit.box(0.4, 0.3, 0.77, -w / 2 + 0.55 + i * (w / 6), 2.45, 0, DARK);
      kit.box(w - 0.6, 0.1, 0.05, 0, 1.0, 0.38, WARN_RED, { glow: true });
      kit.box(0.5, 0.5, 0.05, -w / 4, 1.6, 0.38, WARN_RED, { glow: true });
      kit.box(0.5, 0.5, 0.05, w / 4, 1.6, 0.38, WARN_RED, { glow: true });
      kit.box(0.3, 0.6, 0.9, -w / 2 - 0.1, 0.3, 0, DARK);
      kit.box(0.3, 0.6, 0.9, w / 2 + 0.1, 0.3, 0, DARK);
      return kit.build();
    },
  },
  {
    id: 'container',
    label: 'Construction container',
    avoid: 'block',
    laneSpan: 1,
    depth: 6,
    width: laneWidth(1),
    yMin: 0,
    yMax: 2.5,
    autoHop: false,
    build: () => {
      const kit = new MeshKit();
      kit.box(2.5, 2.5, 6, 0, 1.25, 0, 0x2f7a6a);
      for (let i = 0; i < 5; i++) kit.box(2.56, 2.4, 0.16, 0, 1.25, -2.4 + i * 1.2, 0x26665a);
      kit.box(2.3, 0.4, 0.08, 0, 2.0, 3.05, WARN_YELLOW);
      kit.box(2.0, 0.12, 0.05, 0, 0.5, 3.07, WARN_RED, { glow: true });
      kit.box(0.5, 0.8, 0.06, -0.8, 1.2, 3.06, DARK);
      kit.box(0.5, 0.8, 0.06, 0.8, 1.2, 3.06, DARK);
      return kit.build();
    },
  },
  {
    id: 'drone',
    label: 'Sweeping maintenance drone',
    avoid: 'slide',
    laneSpan: 1,
    depth: 1.3,
    width: 1.7,
    yMin: 1.5,
    yMax: 2.7,
    autoHop: false,
    build: () => {
      const root = new THREE.Group();
      const body = new MeshKit();
      body.box(1.1, 0.4, 1.1, 0, 1.95, 0, WARN_YELLOW);
      body.box(1.2, 0.14, 1.2, 0, 1.72, 0, DARK);
      body.box(0.4, 0.3, 0.5, 0, 1.6, 0, STEEL);
      body.sphere(0.12, 0, 1.5, 0.2, WARN_RED, { glow: true, segments: 8 });
      body.box(0.5, 0.08, 0.5, 0, 1.36, 0, MAGENTA, { glow: true });
      root.add(body.build());
      const rotor = new MeshKit();
      for (const [x, z] of [
        [-0.7, -0.7],
        [0.7, -0.7],
        [-0.7, 0.7],
        [0.7, 0.7],
      ]) {
        rotor.cylinder(0.05, 0.05, 0.2, x, 0, z, DARK);
        rotor.torus(0.36, 0.03, x, 0.05, z, TEAL, { glow: true, rx: Math.PI / 2 });
      }
      const rotorObj = rotor.build();
      rotorObj.name = 'rotor';
      rotorObj.position.y = 2.15;
      root.add(rotorObj);
      return root;
    },
    animate: (obj, time) => {
      const rotor = obj.getObjectByName('rotor');
      if (rotor) rotor.rotation.y = time * 9;
      obj.position.y = Math.sin(time * 3.1) * 0.08;
    },
  },
  {
    id: 'cart_crossing',
    label: 'Crossing service cart',
    avoid: 'jump',
    laneSpan: 1,
    depth: 1.6,
    width: 1.9,
    yMin: 0,
    yMax: 0.95,
    autoHop: true,
    build: () => {
      const kit = new MeshKit();
      kit.box(1.7, 0.55, 1.5, 0, 0.6, 0, 0x4d5a7a);
      kit.box(1.5, 0.35, 1.2, 0, 1.0, 0, WARN_YELLOW);
      kit.box(0.4, 0.5, 0.4, 0.4, 1.35, -0.3, STEEL);
      kit.cylinder(0.2, 0.2, 1.6, 0, 0.22, 0.55, DARK, { rz: Math.PI / 2 });
      kit.cylinder(0.2, 0.2, 1.6, 0, 0.22, -0.55, DARK, { rz: Math.PI / 2 });
      kit.sphere(0.1, -0.7, 1.2, 0.5, WARN_RED, { glow: true, segments: 8 });
      kit.sphere(0.1, 0.7, 1.2, 0.5, WARN_RED, { glow: true, segments: 8 });
      return kit.build();
    },
  },
];

const byId = new Map<string, ObstacleDef>();
for (const d of OBSTACLE_DEFS) byId.set(d.id, d);

export function getObstacleDef(id: string): ObstacleDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown obstacle def: ${id}`);
  return def;
}
