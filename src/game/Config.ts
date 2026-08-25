/**
 * Every tunable lives here. Systems read from CONFIG at runtime, so changing a
 * value (or overriding it from the URL, see applyQueryOverrides) is enough.
 */

export type QualityLevel = 'high' | 'low';
export type ThemeId = 'dusk' | 'midnight' | 'ember';

export const CONFIG = {
  lanes: {
    count: 3,
    spacing: 3.2,
  },

  movement: {
    initialSpeed: 18,
    maxSpeed: 42,
    /** m/s gained per second. 0.22 reaches max speed after ~110 s. */
    speedAcceleration: 0.22,
    laneChangeDuration: 0.14,
    jumpVelocity: 12,
    gravity: -32,
    /** Pressing slide mid-air slams the player down at this vertical speed. */
    fastFallVelocity: -24,
    slideDuration: 0.65,
    stumbleDuration: 0.6,
    /** Speed multiplier at the start of a stumble; recovers to 1 over stumbleDuration. */
    stumbleSpeedFactor: 0.7,
    /** World scroll speed while the menu is showing. */
    menuIdleSpeed: 7,
  },

  player: {
    height: 2.0,
    slideHeight: 0.9,
    halfWidth: 0.42,
    halfDepth: 0.4,
    /** Feet landing this close to the top of a jumpable obstacle stumble instead of crashing. */
    clipTolerance: 0.3,
    graceAfterStumble: 1.0,
    graceAfterShield: 1.2,
    /** Input buffer window: presses this recent still fire once the action becomes legal. */
    inputBuffer: 0.16,
  },

  world: {
    segmentLength: 24,
    activeSegmentCount: 10,
    /** Distance the near edge of a segment may travel past the player before it is recycled. */
    recycleBehind: 16,
    /** Near edge of the first segment starts this far behind the player. */
    startOffset: 12,
    /** No obstacles spawn within this track distance from the start. */
    safeDistance: 96,
    fogNear: 90,
    fogFar: 250,
    /** Widths of the deck beyond the outer lane edges. */
    deckMargin: 1.4,
  },

  camera: {
    fov: 68,
    sprintFovBoost: 9,
    distance: 6.6,
    height: 3.3,
    lookAhead: 11,
    lookHeight: 1.3,
    /** Exponential follow rate per second (higher = tighter). */
    followRate: 9,
    /** Radians of roll per m/s of lateral velocity. */
    leanPerVelocity: 0.012,
    maxLean: 0.09,
    bobAmount: 0.045,
    shakeDecay: 7,
    near: 0.3,
    far: 1600,
  },

  score: {
    distanceRate: 1,
    shardValue: 10,
    nearMissBonus: 25,
    timeRate: 2,
    stumblePenalty: 40,
    /** Base multiplier climbs by one every this many meters. */
    multiplierStep: 500,
    maxBaseMultiplier: 5,
  },

  difficulty: {
    /** Track distance over which difficulty ramps from 0 to 1. */
    rampDistance: 2600,
    /** Max generation attempts before falling back to a breather segment. */
    maxPatternAttempts: 14,
    /** Segments between power-up spawns (minimum). */
    minSegmentsBetweenPowerUps: 5,
    /** Sum of the last two pattern intensities above which a breather is forced. */
    intensityBudget: 5,
  },

  validator: {
    reactionTime: 0.35,
    /** Reaction allowed between chained lane changes (one decision, two inputs). */
    laneChainReactionTime: 0.12,
    /** Fraction of the jump air time during which the player counts as busy. */
    jumpBusyFactor: 0.9,
    slideBusyFactor: 1.0,
    gridStep: 0.5,
    /** Deepest single obstacle a jump is allowed to clear (meters along the track). */
    maxJumpDepth: 4.5,
    maxSlideDepth: 6.5,
    /** Speed floor used for coverage checks; speed ceiling adds this over the projected speed. */
    speedSlack: 6,
  },

  powerUps: {
    magnet: { duration: 10, radius: 7.5, pullSpeed: 28 },
    shield: { duration: 20 },
    amplifier: { duration: 12, multiplier: 2 },
    sprint: { duration: 6, bonusSpeed: 8 },
    autoHop: { duration: 12, leadTime: 0.22 },
  },

  collect: {
    shardBobHeight: 0.18,
    shardSpin: 2.6,
    shardRadiusX: 0.95,
    shardRadiusY: 0.4,
    /** Metres before the pickup passes the player at which a near-miss is judged. */
    nearMissMargin: 0.55,
    nearMissVertical: 0.35,
  },

  effects: {
    particleCapacity: 800,
    particleCapacityLow: 250,
    speedLines: true,
  },

  render: {
    resolutionScale: 1,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 1024,
  },

  debug: {
    enabled: false,
    showColliders: false,
    logPatterns: false,
    seed: null as number | null,
  },

  quality: 'high' as QualityLevel,
  theme: 'dusk' as ThemeId,
};

export type GameConfig = typeof CONFIG;

/** Lane centre X positions, computed from count and spacing. */
export function laneXPositions(): number[] {
  const { count, spacing } = CONFIG.lanes;
  const xs: number[] = [];
  const half = (count - 1) / 2;
  for (let i = 0; i < count; i++) xs.push((i - half) * spacing);
  return xs;
}

export function laneX(lane: number): number {
  const half = (CONFIG.lanes.count - 1) / 2;
  return (lane - half) * CONFIG.lanes.spacing;
}

export function trackHalfWidth(): number {
  return ((CONFIG.lanes.count - 1) / 2) * CONFIG.lanes.spacing + CONFIG.lanes.spacing / 2 + CONFIG.world.deckMargin;
}

/** ?debug=true&seed=123&quality=low&theme=midnight&colliders=1 */
/** Config keys that were set explicitly on the query string. */
export const OVERRIDES = new Set<string>();

export function applyQueryOverrides(search: string): void {
  const params = new URLSearchParams(search);
  const debug = params.get('debug');
  if (debug === '1' || debug === 'true') {
    CONFIG.debug.enabled = true;
    CONFIG.debug.showColliders = true;
    CONFIG.debug.logPatterns = true;
  }
  const colliders = params.get('colliders');
  if (colliders !== null) CONFIG.debug.showColliders = colliders === '1' || colliders === 'true';
  const seed = params.get('seed');
  if (seed !== null && seed !== '' && Number.isFinite(Number(seed))) CONFIG.debug.seed = Number(seed) >>> 0;
  const quality = params.get('quality');
  if (quality === 'low' || quality === 'high') {
    CONFIG.quality = quality;
    OVERRIDES.add('quality');
  }
  const theme = params.get('theme');
  if (theme === 'dusk' || theme === 'midnight' || theme === 'ember') {
    CONFIG.theme = theme;
    OVERRIDES.add('theme');
  }
}

export function applyQuality(level: QualityLevel): void {
  CONFIG.quality = level;
  if (level === 'low') {
    CONFIG.render.shadows = false;
    CONFIG.render.resolutionScale = 0.8;
    CONFIG.render.maxPixelRatio = 1;
    CONFIG.effects.speedLines = false;
  } else {
    CONFIG.render.shadows = true;
    CONFIG.render.resolutionScale = 1;
    CONFIG.render.maxPixelRatio = 2;
    CONFIG.effects.speedLines = true;
  }
}
