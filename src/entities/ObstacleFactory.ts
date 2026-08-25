import { ObjectPool } from '../utils/ObjectPool';
import { Obstacle } from './Obstacle';
import { getObstacleDef, OBSTACLE_DEFS } from './ObstacleDefinitions';

/** One pool per obstacle definition. Meshes are built once and reused forever. */
export class ObstacleFactory {
  private pools = new Map<string, ObjectPool<Obstacle>>();

  constructor() {
    for (const def of OBSTACLE_DEFS) {
      const pool: ObjectPool<Obstacle> = new ObjectPool<Obstacle>(() => {
        const o = new Obstacle(def);
        o.bindPool((inst) => pool.release(inst));
        return o;
      });
      this.pools.set(def.id, pool);
    }
  }

  prewarm(counts: Record<string, number>): void {
    for (const [id, n] of Object.entries(counts)) this.pools.get(id)?.prewarm(n);
  }

  acquire(defId: string): Obstacle {
    const pool = this.pools.get(defId);
    if (!pool) {
      getObstacleDef(defId);
      throw new Error(`No pool for obstacle ${defId}`);
    }
    return pool.acquire();
  }

  stats(): string {
    let s = '';
    for (const [id, p] of this.pools) if (p.size > 0) s += `${id}:${p.size - p.available}/${p.size} `;
    return s;
  }
}
