/**
 * Generic pool. `create` builds a fresh instance, `onRelease` puts it back to
 * a dormant state (detach from scene, hide, etc.).
 */
export class ObjectPool<T> {
  private free: T[] = [];
  private readonly all: T[] = [];
  private total = 0;

  constructor(
    private readonly create: () => T,
    private readonly onRelease?: (item: T) => void,
  ) {}

  acquire(): T {
    const item = this.free.pop();
    if (item !== undefined) return item;
    this.total++;
    const made = this.create();
    this.all.push(made);
    return made;
  }

  release(item: T): void {
    if (this.onRelease) this.onRelease(item);
    this.free.push(item);
  }

  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      const made = this.create();
      this.all.push(made);
      this.free.push(made);
    }
    this.total += count;
  }

  /** Every instance this pool ever created, free or not. For teardown. */
  forEachCreated(fn: (item: T) => void): void {
    for (let i = 0; i < this.all.length; i++) fn(this.all[i]);
  }

  get size(): number {
    return this.total;
  }

  get available(): number {
    return this.free.length;
  }
}
