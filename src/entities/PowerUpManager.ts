import { CONFIG } from '../game/Config';
import type { PlayerController } from '../player/PlayerController';
import type { EventBus } from '../utils/EventBus';
import { POWER_UP_DEFS, POWER_UP_IDS, type PowerUpId } from './PowerUpDefinitions';

export interface ActiveEffect {
  id: PowerUpId;
  remaining: number;
  duration: number;
}

/**
 * Timed effects. Each power-up is a duration plus a handful of queries the
 * rest of the game asks (speed bonus, multiplier, magnet radius...). Picking
 * up an active power-up refreshes its timer.
 */
export class PowerUpManager {
  private remaining = new Map<PowerUpId, number>();
  private readonly listCache: ActiveEffect[] = [];

  constructor(
    private readonly events: EventBus,
    private readonly player: PlayerController,
  ) {}

  reset(): void {
    this.remaining.clear();
    this.applyVisuals();
  }

  activate(id: PowerUpId): void {
    const def = POWER_UP_DEFS[id];
    this.remaining.set(id, def.duration());
    this.applyVisuals();
  }

  update(dt: number): void {
    let changed = false;
    for (const id of POWER_UP_IDS) {
      const r = this.remaining.get(id);
      if (r === undefined) continue;
      const next = r - dt;
      if (next <= 0) {
        this.remaining.delete(id);
        this.events.emit('powerUpExpired', { id });
        changed = true;
      } else {
        this.remaining.set(id, next);
      }
    }
    if (changed) this.applyVisuals();
  }

  isActive(id: PowerUpId): boolean {
    return this.remaining.has(id);
  }

  timeLeft(id: PowerUpId): number {
    return this.remaining.get(id) ?? 0;
  }

  /** Shield absorbs a hit and ends. Returns false if no shield was active. */
  consumeShield(): boolean {
    if (!this.remaining.has('shield')) return false;
    this.remaining.delete('shield');
    this.applyVisuals();
    return true;
  }

  get speedBonus(): number {
    return this.isActive('sprint') ? CONFIG.powerUps.sprint.bonusSpeed : 0;
  }

  get scoreMultiplier(): number {
    return this.isActive('amplifier') ? CONFIG.powerUps.amplifier.multiplier : 1;
  }

  get magnetRadius(): number {
    return this.isActive('magnet') ? CONFIG.powerUps.magnet.radius : 0;
  }

  /** Active effects for the HUD; the array is reused between calls. */
  list(): readonly ActiveEffect[] {
    this.listCache.length = 0;
    for (const id of POWER_UP_IDS) {
      const r = this.remaining.get(id);
      if (r === undefined) continue;
      this.listCache.push({ id, remaining: r, duration: POWER_UP_DEFS[id].duration() });
    }
    return this.listCache;
  }

  private applyVisuals(): void {
    const m = this.player.model;
    m.setShield(this.isActive('shield'));
    m.setMagnet(this.isActive('magnet'));
    m.setSprint(this.isActive('sprint'));
    m.setBoots(this.isActive('autoHop'));
    this.player.autoHopArmed = this.isActive('autoHop');
  }
}
