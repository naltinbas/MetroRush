export type InputAction = 'left' | 'right' | 'jump' | 'slide' | 'pause' | 'confirm' | 'restart';

const KEYMAP: Record<string, InputAction> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  ArrowDown: 'slide',
  KeyS: 'slide',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  KeyR: 'restart',
};

/** Keys whose default browser behavior (scrolling) is suppressed. */
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

/**
 * Keyboard input with a small press buffer. A press is stored with its
 * timestamp; gameplay code calls consume() when the action becomes legal, and
 * the press only counts if it happened within the buffer window. This is what
 * makes a jump pressed a few frames before landing still fire.
 */
interface Press {
  time: number;
  frame: number;
}

export class InputManager {
  private presses = new Map<InputAction, Press>();
  private held = new Set<InputAction>();
  private attached = false;
  private frame = 0;

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const editable =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const isButton = target !== null && (target.tagName === 'BUTTON' || target.tagName === 'A');
    if (!editable && SCROLL_KEYS.has(e.code) && !(isButton && e.code === 'Space')) e.preventDefault();
    if (e.repeat) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    if (editable && action !== 'pause') return;
    // A focused button activates itself on Enter; do not also treat it as "confirm".
    if (isButton && action === 'confirm') return;
    this.held.add(action);
    this.presses.set(action, { time: performance.now() / 1000, frame: this.frame });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = KEYMAP[e.code];
    if (action) this.held.delete(action);
  };

  private onBlur = (): void => {
    this.held.clear();
  };

  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.attached = false;
  }

  /** Call once per game update so presses made since the last update always count. */
  beginFrame(): void {
    this.frame++;
  }

  private fresh(p: Press, buffer: number): boolean {
    // Either recent in wall-clock terms, or no update has run since the press
    // (a slow frame must not eat an input).
    return performance.now() / 1000 - p.time <= buffer || p.frame >= this.frame - 1;
  }

  /** Returns true (once) if the action was pressed within the last `buffer` seconds. */
  consume(action: InputAction, buffer = 0.16): boolean {
    const p = this.presses.get(action);
    if (p === undefined) return false;
    this.presses.delete(action);
    return this.fresh(p, buffer);
  }

  /** Like consume() but leaves the press in the buffer. */
  peek(action: InputAction, buffer = 0.16): boolean {
    const p = this.presses.get(action);
    return p !== undefined && this.fresh(p, buffer);
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  /** Drop everything buffered, e.g. when a new run starts or a menu opens. */
  clear(): void {
    this.presses.clear();
  }
}
