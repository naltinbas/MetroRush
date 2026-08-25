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
export class InputManager {
  private pressTime = new Map<InputAction, number>();
  private held = new Set<InputAction>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    const editable =
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (!editable && SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    if (editable && action !== 'pause') return;
    this.held.add(action);
    this.pressTime.set(action, performance.now() / 1000);
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

  /** Returns true (once) if the action was pressed within the last `buffer` seconds. */
  consume(action: InputAction, buffer = 0.16): boolean {
    const t = this.pressTime.get(action);
    if (t === undefined) return false;
    const now = performance.now() / 1000;
    if (now - t <= buffer) {
      this.pressTime.delete(action);
      return true;
    }
    this.pressTime.delete(action);
    return false;
  }

  /** Like consume() but leaves the press in the buffer. */
  peek(action: InputAction, buffer = 0.16): boolean {
    const t = this.pressTime.get(action);
    if (t === undefined) return false;
    return performance.now() / 1000 - t <= buffer;
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  /** Drop everything buffered, e.g. when a new run starts or a menu opens. */
  clear(): void {
    this.pressTime.clear();
  }
}
