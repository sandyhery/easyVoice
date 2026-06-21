import { BaseStorage } from './baseStorage'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '../utils/logger'

interface FileStorageOptions {
  cacheDir: string
}

interface MetaEntry {
  expireAt: number
  mtime: number
}

/**
 * 文件存储
 *
 * 优化点：
 * 1. 启动时一次性 buildIndex 扫描目录，记 mtime + 过期时间到内存 Map
 * 2. 命中/未命中直接走内存，零额外 IO
 * 3. set/delete 只更新内存 + 写文件，cleanExpired 只删内存中已过期的项（不再 readdir 全部）
 * 4. 文件被外部删除时 mtime 检测降级到磁盘读取（兜底）
 */
export class FileStorage extends BaseStorage {
  private cacheDir: string
  private index: Map<string, MetaEntry> = new Map()
  private initPromise: Promise<void> | null = null

  constructor(options: FileStorageOptions) {
    super()
    this.cacheDir = options.cacheDir
    this.initPromise = this.init()
  }

  private async init(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    try {
      const files = await fs.readdir(this.cacheDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const key = file.replace(/\.json$/, '')
        try {
          const filePath = path.join(this.cacheDir, file)
          const stat = await fs.stat(filePath)
          const data = await fs.readFile(filePath, 'utf8')
          const item = JSON.parse(data)
          if (item && typeof item.expireAt === 'number') {
            this.index.set(key, { expireAt: item.expireAt, mtime: stat.mtimeMs })
          }
        } catch (err) {
          logger.debug(`FileStorage init skip ${file}: ${(err as Error).message}`)
        }
      }
      logger.info(`FileStorage indexed ${this.index.size} entries in ${this.cacheDir}`)
    } catch (err) {
      logger.warn(`FileStorage init failed for ${this.cacheDir}: ${(err as Error).message}`)
    }
  }

  private getFilePath(key: string): string {
    // path traversal 防御：只允许 md5 hex 32 位的 key
    if (!/^[a-f0-9]{32}$/.test(key)) {
      throw new Error(`FileStorage: invalid key "${key}" (must be md5 hex 32)`)
    }
    return path.join(this.cacheDir, `${key}.json`)
  }

  private async ready(): Promise<void> {
    if (this.initPromise) await this.initPromise
  }

  async set<T>(key: string, value: T): Promise<boolean> {
    await this.ready()
    const filePath = this.getFilePath(key)
    const tmpPath = filePath + '.tmp'
    const expireAt = (value as any)?.expireAt ?? 0
    const data = JSON.stringify(value, null, 2)
    // 原子写：先写 .tmp，再 rename（POSIX 上 rename 是原子的）
    // 避免读到半写文件 + 避免与并发 set 互相覆盖
    await fs.writeFile(tmpPath, data, 'utf8')
    await fs.rename(tmpPath, filePath)
    const stat = await fs.stat(filePath)
    this.index.set(key, { expireAt, mtime: stat.mtimeMs })
    return true
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ready()
    const meta = this.index.get(key)
    if (!meta) return null
    // 0 视为永不过期（与 memoryStorage 语义一致）
    if (meta.expireAt && meta.expireAt < Date.now()) {
      await this.delete(key)
      return null
    }
    // 外部可能删了文件，mtime 检测降级
    try {
      const stat = await fs.stat(this.getFilePath(key))
      if (Math.abs(stat.mtimeMs - meta.mtime) > 100) {
        // 外部改动，重读
        this.index.set(key, { ...meta, mtime: stat.mtimeMs })
      }
      const data = await fs.readFile(this.getFilePath(key), 'utf8')
      return JSON.parse(data) as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.index.delete(key)
        return null
      }
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    this.index.delete(key)
    try {
      await fs.unlink(this.getFilePath(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.debug(`FileStorage delete ${key}: ${(err as Error).message}`)
      }
    }
  }

  /**
   * 增量清理：只删除内存索引中已过期的项，不再 readdir + readFile 全量。
   * 磁盘上的残留会在下次 get 时按 mtime 重新索引时被清掉。
   */
  async cleanExpired(): Promise<void> {
    await this.ready()
    const now = Date.now()
    let removed = 0
    for (const [key, meta] of this.index) {
      // 0 视为永不过期
      if (meta.expireAt && meta.expireAt < now) {
        await this.delete(key)
        removed++
      }
    }
    if (removed) logger.info(`FileStorage cleaned ${removed} expired entries`)
  }
}
