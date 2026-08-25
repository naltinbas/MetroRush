import * as THREE from 'three';
import { CONFIG, laneXPositions, trackHalfWidth } from '../game/Config';
import type { Theme } from '../game/Themes';
import { MeshKit } from '../utils/MeshKit';
import { makeDeckTexture, makeGlowTexture } from '../utils/Textures';

/**
 * Builds the static structure of one segment (deck, rails, pillars, lamps)
 * once, then hands out clones that share the same geometry and materials.
 */
export class TrackBuilder {
  private readonly template = new THREE.Group();
  private readonly deckMaterial: THREE.MeshStandardMaterial;
  private readonly laneStripMaterial: THREE.MeshBasicMaterial;
  private readonly ledgeStripMaterial: THREE.MeshBasicMaterial;
  private readonly lampSpriteMaterial: THREE.SpriteMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly deckTexture: THREE.Texture;

  constructor(theme: Theme) {
    const L = CONFIG.world.segmentLength;
    const hw = trackHalfWidth();

    this.deckTexture = makeDeckTexture();
    this.deckTexture.repeat.set(hw / 2, L / 4);
    this.deckMaterial = new THREE.MeshStandardMaterial({
      map: this.deckTexture,
      color: theme.deckTint,
      roughness: 0.85,
      metalness: 0.1,
    });
    const deckGeo = new THREE.BoxGeometry(hw * 2, 0.6, L);
    this.geometries.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, this.deckMaterial);
    deck.position.set(0, -0.3, -L / 2);
    deck.receiveShadow = true;
    this.template.add(deck);

    // Lane edge light strips (themed).
    this.laneStripMaterial = new THREE.MeshBasicMaterial({ color: theme.laneGlow, toneMapped: false });
    const stripGeo = new THREE.BoxGeometry(0.08, 0.04, L);
    this.geometries.push(stripGeo);
    const lanes = laneXPositions();
    const spacing = CONFIG.lanes.spacing;
    const edges: number[] = [];
    for (const x of lanes) edges.push(x - spacing / 2);
    edges.push(lanes[lanes.length - 1] + spacing / 2);
    for (const x of edges) {
      const strip = new THREE.Mesh(stripGeo, this.laneStripMaterial);
      strip.position.set(x, 0.02, -L / 2);
      this.template.add(strip);
    }

    // Everything else is merged into one lit mesh + one glow mesh.
    const kit = new MeshKit();
    kit.box(hw * 2 - 1, 1.2, L, 0, -1.2, -L / 2, 0x171a2b);
    // Curbs with dark hatching.
    for (const s of [-1, 1]) {
      kit.box(0.5, 0.22, L, s * (hw - 0.25), 0.11, -L / 2, 0xd9b23a);
      for (let i = 0; i < L / 2; i++) kit.box(0.52, 0.24, 0.5, s * (hw - 0.25), 0.11, -1 - i * 2, 0x2a2a30);
      // Railing.
      for (let i = 0; i < L / 4; i++) kit.box(0.1, 1.1, 0.1, s * (hw - 0.2), 0.75, -2 - i * 4, 0x9aa3bd);
      kit.box(0.06, 0.06, L, s * (hw - 0.2), 1.25, -L / 2, 0xb9c2dc);
      kit.box(0.06, 0.06, L, s * (hw - 0.2), 0.8, -L / 2, 0xb9c2dc);
      // Side service ledge with a cable tray.
      kit.box(3.6, 0.4, L, s * (hw + 1.9), -0.5, -L / 2, 0x3a3f5c);
      kit.box(0.5, 0.2, L, s * (hw + 0.6), -0.2, -L / 2, 0x2a2e44);
      // Pillars under the deck.
      kit.box(1.4, 44, 1.4, s * (hw - 1.0), -22.6, -L / 2, 0x2b2f45);
      kit.box(1.0, 2.0, 1.0, s * (hw - 1.0), -1.6, -L / 2, 0x3c4160);
      kit.box(0.4, 0.4, L, s * (hw - 1.0), -1.9, -L / 2, 0x2b2f45);
    }
    kit.box(hw * 2 + 2, 1.0, 1.4, 0, -1.9, -L / 2, 0x33385a);
    kit.box(hw * 2 - 1, 0.6, 0.8, 0, -20, -L / 2, 0x2b2f45);
    // Lamp posts, alternating sides.
    const lamps: [number, number][] = [
      [-1, -6],
      [1, -18],
    ];
    for (const [s, z] of lamps) {
      const x = s * (hw - 0.55);
      kit.cylinder(0.09, 0.12, 5.0, x, 2.5, z, 0x8f97b3, { segments: 8 });
      kit.box(1.6, 0.1, 0.1, x - s * 0.8, 5.0, z, 0x8f97b3);
      kit.box(0.6, 0.14, 0.34, x - s * 1.6, 4.95, z, 0x3a3f5c);
      kit.box(0.5, 0.05, 0.26, x - s * 1.6, 4.86, z, 0xfff0c8, { glow: true });
    }
    // Segment seam marker on the deck.
    kit.box(hw * 2 - 1.2, 0.02, 0.14, 0, 0.005, -L + 0.2, theme.accents[0], { glow: true });
    const structure = kit.build(false);
    structure.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.receiveShadow = true;
        this.geometries.push(m.geometry);
      }
    });
    this.template.add(structure);

    // Ledge edge strips (themed accent).
    this.ledgeStripMaterial = new THREE.MeshBasicMaterial({ color: theme.accents[1], toneMapped: false });
    const ledgeGeo = new THREE.BoxGeometry(0.08, 0.06, L);
    this.geometries.push(ledgeGeo);
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(ledgeGeo, this.ledgeStripMaterial);
      strip.position.set(s * (hw + 3.65), -0.27, -L / 2);
      this.template.add(strip);
    }

    // Lamp glow sprites.
    this.lampSpriteMaterial = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const [s, z] of lamps) {
      const sprite = new THREE.Sprite(this.lampSpriteMaterial);
      sprite.position.set(s * (hw - 0.55) - s * 1.6, 4.9, z);
      sprite.scale.set(2.4, 2.4, 1);
      this.template.add(sprite);
    }
  }

  /** New segment structure sharing all geometry/materials with the template. */
  createSegmentMesh(): THREE.Group {
    return this.template.clone();
  }

  applyTheme(theme: Theme): void {
    this.deckMaterial.color.set(theme.deckTint);
    this.laneStripMaterial.color.set(theme.laneGlow);
    this.ledgeStripMaterial.color.set(theme.accents[1]);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.deckMaterial.dispose();
    this.laneStripMaterial.dispose();
    this.ledgeStripMaterial.dispose();
    this.lampSpriteMaterial.dispose();
    this.deckTexture.dispose();
  }
}
