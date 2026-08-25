/**
 * localStorage wrapper. Every access is guarded: private browsing modes and
 * some embedded contexts throw on storage access.
 */
const PREFIX = 'metrorush.';

export interface SaveData {
  bestScore: number;
  bestDistance: number;
  bestShards: number;
  muted: boolean;
  sfxVolume: number;
  musicVolume: number;
  quality: 'high' | 'low';
  theme: string;
  runs: number;
}

const DEFAULTS: SaveData = {
  bestScore: 0,
  bestDistance: 0,
  bestShards: 0,
  muted: false,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  quality: 'high',
  theme: 'dusk',
  runs: 0,
};

export class SaveManager {
  private cache: SaveData;

  constructor() {
    this.cache = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof SaveData)[]) {
      const raw = this.read(key);
      if (raw === null) continue;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === typeof DEFAULTS[key]) (this.cache as unknown as Record<string, unknown>)[key] = parsed;
      } catch {
        /* ignore corrupt entries */
      }
    }
  }

  private read(key: string): string | null {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage unavailable; keep the in-memory copy */
    }
  }

  get<K extends keyof SaveData>(key: K): SaveData[K] {
    return this.cache[key];
  }

  set<K extends keyof SaveData>(key: K, value: SaveData[K]): void {
    this.cache[key] = value;
    this.write(key, value);
  }

  /** Records run results; returns which records were beaten. */
  recordRun(score: number, distance: number, shards: number): { newBestScore: boolean; newBestDistance: boolean } {
    const s = Math.floor(score);
    const d = Math.floor(distance);
    const newBestScore = s > this.cache.bestScore;
    const newBestDistance = d > this.cache.bestDistance;
    if (newBestScore) this.set('bestScore', s);
    if (newBestDistance) this.set('bestDistance', d);
    if (shards > this.cache.bestShards) this.set('bestShards', shards);
    this.set('runs', this.cache.runs + 1);
    return { newBestScore, newBestDistance };
  }
}
