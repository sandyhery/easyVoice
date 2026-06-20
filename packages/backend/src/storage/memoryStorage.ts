// services/cache/storage/memoryStorage.ts
import { BaseStorage } from './baseStorage';

export class MemoryStorage extends BaseStorage {
  private cache: Map<string, any>;

  constructor() {
    super();
    this.cache = new Map();
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    this.cache.set(key, value);
    return true;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.cache.has(key) ? (this.cache.get(key) ?? null) : null
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async cleanExpired(): Promise<void> {
    const now = Date.now()
    // 先 snapshot，再删除（避免迭代中修改 Map）
    const toDelete: string[] = []
    for (const [key, item] of this.cache) {
      if (item?.expireAt < now) toDelete.push(key)
    }
    for (const key of toDelete) this.cache.delete(key)
  }
}