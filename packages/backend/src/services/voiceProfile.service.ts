/**
 * Voice Profile（声音预设）
 *
 * 用户保存一组"配音设定"（voice/rate/pitch/volume/style/engine），
 * 后续在前端下拉中一键复用，免去每次填写参数。
 *
 * 存储：单一 profiles.json + 原子 rename 写（write to tmp → rename）
 *  - 避免 FileStorage 一个文件一个 profile 的 O(N) IO
 *  - 避免 INDEX_KEY 与文件脱节
 *  - 启动时做一致性扫描（孤儿文件归档）
 *
 * 权限：
 *  - 当前为单机/内网定位，所有 profile 全局可见
 *  - 但已预留 ownerId 字段；通过 header `x-user-id` 注入 owner
 *  - 默认 `owner='default'`，不同用户仍能互相看到（与项目其它端点风格一致）
 *  - 后续接入 auth 时，只需在 middleware 中强制注入真实 userId
 *
 * API（/api/v1/tts/profile）：
 *  - GET    /              -> 列出当前所有 profile
 *  - POST   /              -> 新建（body 必含 name + voice）
 *  - PUT    /:id           -> 更新
 *  - DELETE /:id           -> 删除
 *  - GET    /:id           -> 详情
 */
import { Router, Request, Response, RequestHandler } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { AUDIO_DIR } from '../config'
import { logger } from '../utils/logger'

const PROFILE_FILE = path.join(AUDIO_DIR, 'profiles.json')
const PROFILE_FILE_TMP = PROFILE_FILE + '.tmp'
const DEFAULT_OWNER = 'default'

/**
 * VoiceProfile 接口
 *  - name: 必填，max 64 字符
 *  - voice: 必填，音色名（如 "zh-CN-YunjianNeural"）
 *  - engine: 可选，默认 'edge-tts'，跨引擎时 dispatcher 内部会做 voice 映射
 *  - owner: 内部字段，从 header x-user-id 注入（项目单机/内网定位，预留扩展）
 *  - createdAt / updatedAt: ISO 8601 字符串
 */
export interface VoiceProfile {
  id: string
  name: string
  voice: string
  rate?: string
  pitch?: string
  volume?: string
  style?: string
  engine?: string
  description?: string
  owner: string
  createdAt: string
  updatedAt: string
}

const profileSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(64),
  voice: z.string().trim().min(1, '音色不能为空'),
  rate: z.string().max(16).optional(),
  pitch: z.string().max(16).optional(),
  volume: z.string().max(16).optional(),
  style: z.string().max(64).optional(),
  engine: z.string().max(64).optional(),
  description: z.string().max(500).optional(),
})

// 内存缓存：避免每次请求都读盘
let cache: { profiles: VoiceProfile[]; mtime: number } | null = null

// 写锁：所有写操作（POST/PUT/DELETE）串行化执行，避免并发覆盖
//  - 用 Promise 链实现简单互斥：每个写操作 await 当前链尾，然后挂新尾
let writeLock: Promise<unknown> = Promise.resolve()

/**
 * 在写锁内执行 fn；确保同一时刻只有一个写操作能修改 profiles.json
 */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn)
  // 链尾吞掉错误，避免污染下一个等待者
  writeLock = next.catch(() => undefined)
  return next
}

async function ensureFile(): Promise<void> {
  try {
    await fs.access(PROFILE_FILE)
  } catch {
    await fs.mkdir(path.dirname(PROFILE_FILE), { recursive: true })
    await atomicWrite({ profiles: [] })
  }
}

/**
 * 原子写：写 .tmp + rename（POSIX 上 rename 是原子的）
 */
async function atomicWrite(data: { profiles: VoiceProfile[] }): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  await fs.writeFile(PROFILE_FILE_TMP, json, 'utf8')
  await fs.rename(PROFILE_FILE_TMP, PROFILE_FILE)
  cache = { profiles: data.profiles, mtime: Date.now() }
}

async function readAll(): Promise<VoiceProfile[]> {
  await ensureFile()
  if (cache) return [...cache.profiles] // 浅拷贝：避免 caller 直接修改 cache 引用
  try {
    const txt = await fs.readFile(PROFILE_FILE, 'utf8')
    const obj = JSON.parse(txt) as { profiles: VoiceProfile[] }
    cache = { profiles: obj.profiles || [], mtime: Date.now() }
    return [...cache.profiles]
  } catch (e) {
    logger.warn('profiles.json read failed, starting empty', e)
    return []
  }
}

async function writeAll(profiles: VoiceProfile[]): Promise<void> {
  // 保留此函数以便其他写入路径（如数据迁移工具）使用
  // POST/PUT/DELETE handler 已通过 mutate() 走 writeLock，无需此函数持锁
  await atomicWrite({ profiles })
}

function getOwner(req: Request): string {
  // 预留：将来可从 req.user.id / session / token 解析
  return (req.headers['x-user-id'] as string) || DEFAULT_OWNER
}

export const voiceProfileRouter = Router()

// 启动时做一次一致性扫描：清理 .tmp 残留（防御性，正常情况 rename 完不应有）
;(async () => {
  try {
    await ensureFile()
    try {
      await fs.unlink(PROFILE_FILE_TMP)
      logger.info('Cleaned up stale profiles.json.tmp')
    } catch {
      /* no stale tmp */
    }
    await readAll()
  } catch (e) {
    logger.error('voiceProfile init failed', e)
  }
})()

// 统一错误捕获：ZodError -> 400，其它 -> 500
const wrap = (h: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (async (req: Request, res: Response) => {
    try {
      await h(req, res)
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ code: 400, errors: err.errors, success: false })
        return
      }
      logger.error('voiceProfile error', err)
      res.status(500).json({ code: 500, message: (err as Error).message, success: false })
    }
  }) as unknown as RequestHandler

// GET /api/v1/tts/profile  列表
voiceProfileRouter.get(
  '/',
  wrap(async (_req, res) => {
    const profiles = await readAll()
    // ISO 8601 字符串字典序 == 时间序，直接 < 比较，避免 localeCompare 不稳定
    const sorted = [...profiles].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
    )
    res.json({ code: 200, data: sorted, success: true })
  })
)

// GET /api/v1/tts/profile/:id  详情
voiceProfileRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id || '')
    const profiles = await readAll()
    const p = profiles.find(x => x.id === id)
    if (!p) {
      res.status(404).json({ code: 404, message: 'profile not found', success: false })
      return
    }
    res.json({ code: 200, data: p, success: true })
  })
)

/**
 * 在写锁内执行"读-改-写"复合操作
 *  - 锁内 readAll + 修改 + writeAll 串行化
 *  - 避免多个并发 POST/PUT/DELETE 互相覆盖
 */
async function mutate<T>(fn: (profiles: VoiceProfile[]) => T | Promise<T>): Promise<T> {
  return withWriteLock(async () => {
    const profiles = await readAll()
    const result = await fn(profiles)
    await atomicWrite({ profiles })
    return result
  }) as Promise<T>
}

// POST /api/v1/tts/profile  新建
voiceProfileRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = profileSchema.parse(req.body)
    const now = new Date().toISOString()
    const profile: VoiceProfile = {
      id: randomUUID(),
      ...body,
      owner: getOwner(req),
      createdAt: now,
      updatedAt: now,
    }
    await mutate((profiles) => {
      profiles.push(profile)
      return profile
    })
    res.json({ code: 200, data: profile, success: true })
  })
)

// PUT /api/v1/tts/profile/:id  更新
voiceProfileRouter.put(
  '/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id || '')
    const patch = profileSchema.partial().parse(req.body)
    let updated: VoiceProfile | null = null
    await mutate((profiles) => {
      const idx = profiles.findIndex(x => x.id === id)
      if (idx < 0) return null
      updated = {
        ...profiles[idx],
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      profiles[idx] = updated
      return updated
    })
    if (!updated) {
      res.status(404).json({ code: 404, message: 'profile not found', success: false })
      return
    }
    res.json({ code: 200, data: updated, success: true })
  })
)

// DELETE /api/v1/tts/profile/:id  删除
voiceProfileRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id || '')
    let deleted = false
    await mutate((profiles) => {
      const idx = profiles.findIndex(x => x.id === id)
      if (idx < 0) return false
      profiles.splice(idx, 1)
      deleted = true
      return true
    })
    if (!deleted) {
      res.status(404).json({ code: 404, message: 'profile not found', success: false })
      return
    }
    res.json({ code: 200, success: true })
  })
)