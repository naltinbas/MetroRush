/**
 * Tiny typed pub/sub. Gameplay systems publish, UI/audio/effects subscribe.
 * Keeps the simulation from importing DOM or audio code.
 */
export interface GameEvents {
  shardCollected: { x: number; y: number; z: number; streak: number };
  powerUpCollected: { id: string; x: number; y: number; z: number };
  powerUpExpired: { id: string };
  shieldBroken: { x: number; y: number; z: number };
  stumble: { x: number; y: number; z: number };
  crash: { x: number; y: number; z: number };
  nearMiss: { bonus: number; x: number; y: number; z: number };
  laneChange: { dir: number };
  jump: { auto: boolean };
  slide: Record<string, never>;
  land: Record<string, never>;
  tramHorn: Record<string, never>;
  gameOver: Record<string, never>;
  multiplierChanged: { multiplier: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<GameEvents[K]>)(payload);
  }
}
