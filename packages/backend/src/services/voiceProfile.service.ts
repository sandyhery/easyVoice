/**
 * Voice Profile（声音预设）
 *
 * 用户保存一组"配音设定"（voice/rate/pitch/volume/style/engine），
 * 后续在前端下拉中一键复用，免去每次填写参数。
 *
 * 存储：复用 CacheService（FileStorage），目录 AUDIO_DIR/.profiles/
 * 数据模型：
 *  {
 *    id: string            // UUID
 *    name: string           // 用户起的名字，如 "徐凤年 - 剑客"
 *    voice: string          // Edge-TTS 音色
 *    rate?: string          // "+0%"
 *    pitch?: string         // "+0Hz"
 *    volume?: string        // "+0%"
 *    style?: string         // 风格（azure style 字段，预留）
 *    engine?: string        // 引擎名，默认 edge-tts
 *    description?: string   // 备注
 *    createdAt: string      // ISO
 *    updatedAt: string      // ISO
 *  }
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
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { AUDIO_DIR } from '../config'
import CacheService from './cache.service'
import { logger } from '../utils/logger'

const PROFILES_DIR = path.join(AUDIO_DIR, '.profiles')
const INDEX_KEY = '__profile_index__'
// profile 默认 30 天过期
const TTL_MS = 30 * 24 * 3600 * 1000

const cache = new CacheService({
  storageType: 'file',
  ttl: TTL_MS,
  storageOptions: { cacheDir: PROFILES_DIR },
})

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
  createdAt: string
  updatedAt: string
}

const profileSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空'),
  voice: z.string().trim().min(1, '音色不能为空'),
  rate: z.string().optional(),
  pitch: z.string().optional(),
  volume: z.string().optional(),
  style: z.string().optional(),
  engine: z.string().optional(),
  description: z.string().optional(),
})

async function getIndex(): Promise<string[]> {
  const idx = (await cache.get<string[]>(INDEX_KEY)) || []
  return idx
}

async function setIndex(ids: string[]): Promise<void> {
  await cache.set(INDEX_KEY, ids)
}

export const voiceProfileRouter = Router()

// Express 5 + Router.use() 推断会让裸 async 函数被视为 Application。
// 用 wrap 显式标注为 RequestHandler 解决类型推断问题。
const wrap = (h: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  h as unknown as RequestHandler

// GET /api/v1/tts/profile  列表
voiceProfileRouter.get('/', wrap(async (_req, res) => {
  const ids = await getIndex()
  const items: VoiceProfile[] = []
  for (const id of ids) {
    const p = await cache.get<VoiceProfile>(id)
    if (p) items.push(p)
  }
  // 按更新时间倒序
  items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  res.json({ code: 200, data: items, success: true })
}))

// GET /api/v1/tts/profile/:id  详情
voiceProfileRouter.get('/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '')
  const p = await cache.get<VoiceProfile>(id)
  if (!p) return res.status(404).json({ code: 404, message: 'profile not found', success: false })
  res.json({ code: 200, data: p, success: true })
}))

// POST /api/v1/tts/profile  新建
voiceProfileRouter.post('/', wrap(async (req, res) => {
  const body = profileSchema.parse(req.body)
  const now = new Date().toISOString()
  const profile: VoiceProfile = {
    id: randomUUID(),
    ...body,
    createdAt: now,
    updatedAt: now,
  }
  await cache.set(profile.id, profile)
  const ids = await getIndex()
  if (!ids.includes(profile.id)) {
    ids.push(profile.id)
    await setIndex(ids)
  }
  res.json({ code: 200, data: profile, success: true })
}))

// PUT /api/v1/tts/profile/:id  更新
voiceProfileRouter.put('/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '')
  const existing = await cache.get<VoiceProfile>(id)
  if (!existing) return res.status(404).json({ code: 404, message: 'profile not found', success: false })
  const patch = profileSchema.partial().parse(req.body)
  const updated: VoiceProfile = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await cache.set(updated.id, updated)
  res.json({ code: 200, data: updated, success: true })
}))

// DELETE /api/v1/tts/profile/:id  删除
voiceProfileRouter.delete('/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '')
  await cache.delete(id)
  const ids = (await getIndex()).filter(x => x !== id)
  await setIndex(ids)
  res.json({ code: 200, success: true })
}))