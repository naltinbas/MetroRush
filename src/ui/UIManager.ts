import type { ActiveEffect } from '../entities/PowerUpManager';
import { POWER_UP_DEFS, type PowerUpId } from '../entities/PowerUpDefinitions';
import type { QualityLevel, ThemeId } from '../game/Config';
import { THEMES } from '../game/Themes';
import { formatDistance, formatScore } from '../utils/MathUtils';

export type ScreenName = 'menu' | 'hud' | 'pause' | 'gameover' | 'none';

export interface UICallbacks {
  onPlay: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onToggleSound: () => boolean;
  onSfxVolume: (v: number) => void;
  onMusicVolume: (v: number) => void;
  onQuality: (q: QualityLevel) => void;
  onTheme: (t: ThemeId) => void;
  onMenuSound: () => void;
}

export interface HudData {
  score: number;
  distance: number;
  shards: number;
  multiplier: number;
  effects: readonly ActiveEffect[];
}

export interface GameOverData {
  score: number;
  distance: number;
  shards: number;
  bestScore: number;
  bestDistance: number;
  newBestScore: boolean;
  newBestDistance: boolean;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el;
}

/**
 * All DOM work lives here. The game pushes numbers in; this class decides
 * what to redraw. Text is only touched when the value changed.
 */
export class UIManager {
  private readonly screens: Record<Exclude<ScreenName, 'none'>, HTMLElement>;
  private readonly controlsPanel: HTMLElement;
  private readonly hudScore = $('hud-score');
  private readonly hudDistance = $('hud-distance');
  private readonly hudShards = $('hud-shards');
  private readonly hudMult = $('hud-mult');
  private readonly hudPowerUps = $('hud-powerups');
  private readonly hudFloat = $('hud-float');
  private readonly debugPanel = $('debug');
  private readonly chips = new Map<PowerUpId, { root: HTMLElement; bar: HTMLElement; time: HTMLElement }>();
  private last = { score: '', distance: '', shards: '', mult: '' };
  private controlsReturn: HTMLElement | null = null;

  constructor(private readonly cb: UICallbacks) {
    this.screens = { menu: $('screen-menu'), hud: $('hud'), pause: $('screen-pause'), gameover: $('screen-gameover') };
    this.controlsPanel = $('panel-controls');
    this.bind();
    this.buildChips();
  }

  private bind(): void {
    const click = (id: string, fn: () => void): void => {
      $(id).addEventListener('click', () => {
        this.cb.onMenuSound();
        fn();
      });
    };
    click('btn-play', () => this.cb.onPlay());
    click('btn-resume', () => this.cb.onResume());
    click('btn-restart', () => this.cb.onRestart());
    click('btn-restart-go', () => this.cb.onRestart());
    click('btn-menu', () => this.cb.onMainMenu());
    click('btn-menu-go', () => this.cb.onMainMenu());
    click('btn-controls', () => this.showControls(true, $('btn-controls')));
    click('btn-controls-pause', () => this.showControls(true, $('btn-controls-pause')));
    click('btn-controls-close', () => this.showControls(false));
    for (const id of ['btn-sound', 'btn-sound-pause']) {
      click(id, () => this.setSoundLabel(this.cb.onToggleSound()));
    }
    for (const id of ['btn-quality', 'btn-quality-pause']) {
      click(id, () => {
        const next: QualityLevel = $(id).dataset.quality === 'high' ? 'low' : 'high';
        this.cb.onQuality(next);
        this.setQualityLabel(next);
      });
    }
    for (const id of ['btn-theme', 'btn-theme-pause']) {
      click(id, () => {
        const order = Object.keys(THEMES) as ThemeId[];
        const cur = ($(id).dataset.theme as ThemeId) ?? 'dusk';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        this.cb.onTheme(next);
        this.setThemeLabel(next);
      });
    }
    for (const id of ['vol-sfx', 'vol-sfx-pause']) {
      $(id).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        this.cb.onSfxVolume(v);
        this.syncSliders('vol-sfx', v);
      });
    }
    for (const id of ['vol-music', 'vol-music-pause']) {
      $(id).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        this.cb.onMusicVolume(v);
        this.syncSliders('vol-music', v);
      });
    }
    this.controlsPanel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.showControls(false);
      }
    });
  }

  private syncSliders(base: string, v: number): void {
    for (const id of [base, `${base}-pause`]) {
      const el = $(id) as HTMLInputElement;
      const val = String(Math.round(v * 100));
      if (el.value !== val) el.value = val;
    }
  }

  private buildChips(): void {
    for (const def of Object.values(POWER_UP_DEFS)) {
      const root = document.createElement('div');
      root.className = 'chip';
      root.style.setProperty('--chip', def.cssColor);
      root.hidden = true;
      root.innerHTML = `<span class="chip-icon">${def.icon}</span><span class="chip-body"><span class="chip-name">${def.name}</span><span class="chip-bar"><span class="chip-fill"></span></span></span><span class="chip-time"></span>`;
      this.hudPowerUps.appendChild(root);
      this.chips.set(def.id, {
        root,
        bar: root.querySelector('.chip-fill') as HTMLElement,
        time: root.querySelector('.chip-time') as HTMLElement,
      });
    }
  }

  // ---- screens --------------------------------------------------------------

  showScreen(name: ScreenName): void {
    for (const [key, el] of Object.entries(this.screens)) {
      const on = key === name || (name !== 'none' && name !== 'menu' && key === 'hud' && name !== 'gameover');
      el.classList.toggle('hidden', !on);
    }
    if (name === 'pause') this.screens.hud.classList.remove('hidden');
    this.showControls(false);
    const focus: Record<string, string> = { menu: 'btn-play', pause: 'btn-resume', gameover: 'btn-restart-go' };
    const id = focus[name];
    if (id) window.setTimeout(() => $(id).focus(), 0);
    document.body.dataset.screen = name;
  }

  showControls(open: boolean, returnTo: HTMLElement | null = null): void {
    this.controlsPanel.classList.toggle('hidden', !open);
    if (open) {
      this.controlsReturn = returnTo;
      window.setTimeout(() => $('btn-controls-close').focus(), 0);
    } else if (this.controlsReturn) {
      const r = this.controlsReturn;
      this.controlsReturn = null;
      r.focus();
    }
  }

  get controlsOpen(): boolean {
    return !this.controlsPanel.classList.contains('hidden');
  }

  updateMenuStats(bestScore: number, bestDistance: number, runs: number): void {
    $('menu-best-score').textContent = formatScore(bestScore);
    $('menu-best-distance').textContent = formatDistance(bestDistance);
    $('menu-runs').textContent = String(runs);
  }

  syncSettings(muted: boolean, sfx: number, music: number, quality: QualityLevel, theme: ThemeId): void {
    this.setSoundLabel(muted);
    this.syncSliders('vol-sfx', sfx);
    this.syncSliders('vol-music', music);
    this.setQualityLabel(quality);
    this.setThemeLabel(theme);
  }

  private setSoundLabel(muted: boolean): void {
    for (const id of ['btn-sound', 'btn-sound-pause']) {
      const b = $(id);
      b.textContent = muted ? 'Sound: Off' : 'Sound: On';
      b.setAttribute('aria-pressed', muted ? 'false' : 'true');
    }
  }

  private setQualityLabel(q: QualityLevel): void {
    for (const id of ['btn-quality', 'btn-quality-pause']) {
      const b = $(id);
      b.textContent = q === 'high' ? 'Quality: High' : 'Quality: Low';
      b.dataset.quality = q;
    }
  }

  private setThemeLabel(t: ThemeId): void {
    for (const id of ['btn-theme', 'btn-theme-pause']) {
      const b = $(id);
      b.textContent = `Theme: ${THEMES[t].name}`;
      b.dataset.theme = t;
    }
  }

  // ---- HUD ------------------------------------------------------------------

  updateHud(data: HudData): void {
    const score = formatScore(data.score);
    if (score !== this.last.score) {
      this.hudScore.textContent = score;
      this.last.score = score;
    }
    const dist = formatDistance(data.distance);
    if (dist !== this.last.distance) {
      this.hudDistance.textContent = dist;
      this.last.distance = dist;
    }
    const shards = String(data.shards);
    if (shards !== this.last.shards) {
      this.hudShards.textContent = shards;
      this.last.shards = shards;
    }
    const mult = `x${data.multiplier}`;
    if (mult !== this.last.mult) {
      this.hudMult.textContent = mult;
      this.hudMult.classList.toggle('hot', data.multiplier > 1);
      this.last.mult = mult;
    }
    for (const [id, chip] of this.chips) {
      const eff = data.effects.find((e) => e.id === id);
      if (!eff) {
        if (!chip.root.hidden) chip.root.hidden = true;
        continue;
      }
      if (chip.root.hidden) chip.root.hidden = false;
      chip.bar.style.transform = `scaleX(${Math.max(0, eff.remaining / eff.duration).toFixed(3)})`;
      const t = eff.remaining.toFixed(1);
      if (chip.time.textContent !== t) chip.time.textContent = t;
    }
  }

  /** Short-lived text that rises from the middle of the screen. */
  float(text: string, kind: 'good' | 'bad' | 'neutral' = 'good'): void {
    const el = document.createElement('div');
    el.className = `float ${kind}`;
    el.textContent = text;
    el.style.left = `${45 + Math.random() * 10}%`;
    this.hudFloat.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    while (this.hudFloat.childElementCount > 6) this.hudFloat.firstElementChild?.remove();
  }

  showGameOver(d: GameOverData): void {
    $('go-score').textContent = formatScore(d.score);
    $('go-distance').textContent = formatDistance(d.distance);
    $('go-shards').textContent = String(d.shards);
    $('go-best-score').textContent = formatScore(d.bestScore);
    $('go-best-distance').textContent = formatDistance(d.bestDistance);
    $('go-new-best').classList.toggle('hidden', !(d.newBestScore || d.newBestDistance));
    $('go-new-best').textContent = d.newBestScore ? 'New best score!' : 'New best distance!';
    this.showScreen('gameover');
  }

  // ---- misc -------------------------------------------------------------------

  showDebug(on: boolean): void {
    this.debugPanel.classList.toggle('hidden', !on);
  }

  setDebug(text: string): void {
    if (this.debugPanel.textContent !== text) this.debugPanel.textContent = text;
  }

  showError(message: string): void {
    const el = $('error');
    el.classList.remove('hidden');
    $('error-message').textContent = message;
    for (const s of Object.values(this.screens)) s.classList.add('hidden');
  }
}
