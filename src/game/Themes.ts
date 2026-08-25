import type { ThemeId } from './Config';

export interface Theme {
  id: ThemeId;
  name: string;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fog: number;
  hemiSky: number;
  hemiGround: number;
  ambient: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  laneGlow: number;
  accents: number[];
  deckTint: number;
  cloudTint: number;
  buildingTints: number[];
  starBrightness: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  dusk: {
    id: 'dusk',
    name: 'Dusk',
    skyTop: 0x141a4a,
    skyHorizon: 0xff7a59,
    skyBottom: 0x2a1030,
    fog: 0x5a2f5e,
    hemiSky: 0x9a7cff,
    hemiGround: 0x3a1f40,
    ambient: 0x4a3a6a,
    sunColor: 0xffb28a,
    sunIntensity: 2.4,
    sunPosition: [-30, 40, -60],
    laneGlow: 0x35f0ff,
    accents: [0xff3fa4, 0x35f0ff, 0xffd447, 0x9d5cff],
    deckTint: 0x8e8ea6,
    cloudTint: 0xff9d7a,
    buildingTints: [0x2a2340, 0x1f2b48, 0x35223f, 0x1b1d33],
    starBrightness: 0.5,
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    skyTop: 0x04061a,
    skyHorizon: 0x1d4b8a,
    skyBottom: 0x05070f,
    fog: 0x122a4a,
    hemiSky: 0x5f8dff,
    hemiGround: 0x101a2e,
    ambient: 0x2a3a6a,
    sunColor: 0xbfd7ff,
    sunIntensity: 1.7,
    sunPosition: [25, 45, -50],
    laneGlow: 0x4dffc3,
    accents: [0x4dffc3, 0x4da3ff, 0xff4dd2, 0xffffff],
    deckTint: 0x7d86a8,
    cloudTint: 0x6f95d8,
    buildingTints: [0x151b33, 0x0f2238, 0x1a1430, 0x101427],
    starBrightness: 1,
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    skyTop: 0x2a0a12,
    skyHorizon: 0xff9b2f,
    skyBottom: 0x1a0608,
    fog: 0x7a2a1e,
    hemiSky: 0xffb27a,
    hemiGround: 0x3a1410,
    ambient: 0x5a2a20,
    sunColor: 0xffd08a,
    sunIntensity: 2.8,
    sunPosition: [40, 30, -70],
    laneGlow: 0xffd447,
    accents: [0xffd447, 0xff5e3a, 0xff2e7e, 0xffa93f],
    deckTint: 0xa08e86,
    cloudTint: 0xffb06a,
    buildingTints: [0x3a1e22, 0x2c1a2b, 0x3f2618, 0x261418],
    starBrightness: 0.35,
  },
};

export function getTheme(id: string): Theme {
  return THEMES[id as ThemeId] ?? THEMES.dusk;
}

export const THEME_ORDER: ThemeId[] = ['dusk', 'midnight', 'ember'];
