import * as THREE from 'three';
import { CONFIG } from '../game/Config';
import { MeshKit } from '../utils/MeshKit';
import { makeGlowTexture } from '../utils/Textures';

export type PowerUpId = 'magnet' | 'shield' | 'amplifier' | 'sprint' | 'autoHop';

export interface PowerUpDef {
  id: PowerUpId;
  name: string;
  color: number;
  cssColor: string;
  duration: () => number;
  blurb: string;
  /** Inline SVG for the HUD chip. */
  icon: string;
  buildPickup: () => THREE.Object3D;
}

let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (!glowTexture) glowTexture = makeGlowTexture();
  return glowTexture;
}

/** Ring + inner emblem + glow sprite. Distinct from shards on purpose. */
function pickup(color: number, emblem: (kit: MeshKit) => void): THREE.Object3D {
  const root = new THREE.Group();
  const kit = new MeshKit();
  kit.torus(0.75, 0.08, 0, 0, 0, color, { glow: true });
  kit.torus(0.75, 0.04, 0, 0, 0, 0xffffff, { glow: true, ry: Math.PI / 2 });
  emblem(kit);
  const body = kit.build(false);
  body.name = 'spin';
  root.add(body);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sprite.scale.set(2.6, 2.6, 1);
  root.add(sprite);
  root.position.y = 1.3;
  return root;
}

export const POWER_UP_DEFS: Record<PowerUpId, PowerUpDef> = {
  magnet: {
    id: 'magnet',
    name: 'Magnet Field',
    color: 0xff5e9d,
    cssColor: '#ff5e9d',
    duration: () => CONFIG.powerUps.magnet.duration,
    blurb: 'Pulls nearby energy shards to you.',
    icon: '<svg viewBox="0 0 24 24"><path d="M7 3v8a5 5 0 0 0 10 0V3h-4v8a1 1 0 0 1-2 0V3z" fill="currentColor"/><rect x="7" y="3" width="4" height="3" fill="#fff" opacity=".8"/><rect x="13" y="3" width="4" height="3" fill="#fff" opacity=".8"/></svg>',
    buildPickup: () =>
      pickup(0xff5e9d, (kit) => {
        kit.box(0.5, 0.16, 0.16, 0, -0.22, 0, 0xff5e9d);
        kit.box(0.16, 0.5, 0.16, -0.2, 0, 0, 0xff5e9d);
        kit.box(0.16, 0.5, 0.16, 0.2, 0, 0, 0xff5e9d);
        kit.box(0.16, 0.14, 0.17, -0.2, 0.28, 0, 0xffffff, { glow: true });
        kit.box(0.16, 0.14, 0.17, 0.2, 0.28, 0, 0xffffff, { glow: true });
      }),
  },
  shield: {
    id: 'shield',
    name: 'Barrier Shield',
    color: 0x4da3ff,
    cssColor: '#4da3ff',
    duration: () => CONFIG.powerUps.shield.duration,
    blurb: 'Absorbs one fatal collision.',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="currentColor"/><path d="M12 5l5 2v4c0 3.5-2.2 6.4-5 8-2.8-1.6-5-4.5-5-8V7z" fill="#fff" opacity=".35"/></svg>',
    buildPickup: () =>
      pickup(0x4da3ff, (kit) => {
        kit.box(0.5, 0.6, 0.12, 0, 0.05, 0, 0x4da3ff);
        kit.cone(0.26, 0.25, 0, -0.38, 0, 0x4da3ff, { rx: Math.PI });
        kit.box(0.3, 0.36, 0.14, 0, 0.05, 0, 0xffffff, { glow: true });
      }),
  },
  amplifier: {
    id: 'amplifier',
    name: 'Score Amplifier',
    color: 0xffd447,
    cssColor: '#ffd447',
    duration: () => CONFIG.powerUps.amplifier.duration,
    blurb: 'Doubles every point you earn.',
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="currentColor"/></svg>',
    buildPickup: () =>
      pickup(0xffd447, (kit) => {
        kit.octahedron(0.42, 0, 0, 0, 0xffd447, { glow: true });
        kit.octahedron(0.24, 0, 0, 0, 0xffffff, { glow: true, ry: Math.PI / 4 });
      }),
  },
  sprint: {
    id: 'sprint',
    name: 'Sprint Boost',
    color: 0xff8a3d,
    cssColor: '#ff8a3d',
    duration: () => CONFIG.powerUps.sprint.duration,
    blurb: 'Extra speed for a few seconds.',
    icon: '<svg viewBox="0 0 24 24"><path d="M3 12h10l-3-4h4l6 4-6 4h-4l3-4H3z" fill="currentColor"/></svg>',
    buildPickup: () =>
      pickup(0xff8a3d, (kit) => {
        kit.cone(0.32, 0.6, 0, 0, 0.15, 0xff8a3d, { rx: Math.PI / 2 });
        kit.box(0.24, 0.24, 0.4, 0, 0, -0.35, 0xff8a3d);
        kit.box(0.1, 0.1, 0.5, 0, 0, -0.3, 0xffffff, { glow: true });
      }),
  },
  autoHop: {
    id: 'autoHop',
    name: 'Auto-hop Boots',
    color: 0x4dff88,
    cssColor: '#4dff88',
    duration: () => CONFIG.powerUps.autoHop.duration,
    blurb: 'Hops small ground obstacles for you.',
    icon: '<svg viewBox="0 0 24 24"><path d="M6 4h5v7l7 3v4H6z" fill="currentColor"/><path d="M6 15h12v3H6z" fill="#fff" opacity=".5"/></svg>',
    buildPickup: () =>
      pickup(0x4dff88, (kit) => {
        kit.box(0.26, 0.5, 0.2, -0.18, 0.05, 0, 0x4dff88);
        kit.box(0.26, 0.5, 0.2, 0.18, 0.05, 0, 0x4dff88);
        kit.box(0.3, 0.14, 0.34, -0.18, -0.25, 0.06, 0xffffff, { glow: true });
        kit.box(0.3, 0.14, 0.34, 0.18, -0.25, 0.06, 0xffffff, { glow: true });
      }),
  },
};

export const POWER_UP_IDS: PowerUpId[] = ['magnet', 'shield', 'amplifier', 'sprint', 'autoHop'];

export function isPowerUpId(id: string): id is PowerUpId {
  return (POWER_UP_IDS as string[]).includes(id);
}
