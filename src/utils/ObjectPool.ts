/**
 * Generic pool. `create` builds a fresh instance, `onRelease` puts it back to
 * a dormant state (detach from scene, hide, etc.).
 */
export class ObjectPool<T> {
  private free: T[] = [];
  private total = 0;

  constructor(
    private readonly create: () => T,
    private readonly onRelease?: (item: T) => void,
  ) {}

  acquire(): T {
    const item = this.free.pop();
    if (item !== undefined) return item;
    this.total++;
    return this.create();
  }

  release(item: T): void {
    if (this.onRelease) this.onRelease(item);
    this.free.push(item);
  }

  prewarm(count: number): void {
    for (let i = 0; i < count; i++) this.free.push(this.create());
    this.total += count;
  }

  get size(): number {
    return this.total;
  }

  get available(): number {
    return this.free.length;
  }
}
