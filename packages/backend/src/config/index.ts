import dotenv from 'dotenv'
import { resolve, join } from 'path'

dotenv.config({
  path: [
    resolve(__dirname, '..', '..', '.env'),
    resolve(__dirname, '..', '..', '..', '..', '.env'),
  ],
})
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
}

export const AUDIO_DIR = join(__dirname, '..', '..', 'audio')
export const AUDIO_CACHE_DIR = join(AUDIO_DIR, '.cache')
export const PUBLIC_DIR = join(__dirname, '..', '..', 'public')
export const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.srt'])

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY
export const MODEL_NAME = process.env.MODEL_NAME

export const STATIC_DOMAIN = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : ''

export const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '0') || 10
export const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '0') || 1e6

// EDGE_API_LIMIT 默认 6；可在 .env 中调（10 以下较安全，>10 容易触发微软限速）
export const EDGE_API_LIMIT = parseInt(process.env.EDGE_API_LIMIT || '6') || 6

export const PORT = parseInt(process.env.PORT || '3000') || 3000

export const REGISTER_OPENAI_TTS = process.env.REGISTER_OPENAI_TTS || false

export const REGISTER_KOKORO = process.env.REGISTER_KOKORO || false
export const TTS_KOKORO_URL = process.env.TTS_KOKORO_URL || 'http://localhost:8880/v1'

export const LIMIT_TEXT_LENGTH = parseInt(process.env.LIMIT_TEXT_LENGTH || '0')
export const LIMIT_TEXT_LENGTH_ERROR_MESSAGE = process.env.LIMIT_TEXT_LENGTH_ERROR_MESSAGE
export const USE_HELMET = process.env.USE_HELMET !== 'false'
export const USE_LIMIT = process.env.USE_LIMIT === 'true' || false
export const DIRECT_GEN_LIMIT = process.env.DIRECT_GEN_LIMIT || 200

// 文件下载 token 相关
export const FILE_DOWNLOAD_PATH = process.env.FILE_DOWNLOAD_PATH || '/api/v1/tts/file'
export const FILE_DOWNLOAD_TTL_MS = (() => {
  const v = parseInt(process.env.FILE_DOWNLOAD_TTL_MS || '')
  if (Number.isFinite(v) && v > 0) return v
  return 24 * 60 * 60 * 1000 // 24h
})()

import { buildDownloadUrl } from '../utils/fileToken'

/**
 * 用 HMAC token 拼装下载 URL，service 层调用此函数生成对外 url。
 * 集中在一个地方避免散落拼字符串。
 */
export function audioUrl(file: string): string {
  return buildDownloadUrl(STATIC_DOMAIN, FILE_DOWNLOAD_PATH, file, FILE_DOWNLOAD_TTL_MS)
}

// CORS 白名单
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
export const CORS_ALLOW_ALL = CORS_ORIGINS.length === 0

// 任务管理
export const MAX_TASKS = parseInt(process.env.MAX_TASKS || '100', 10) || 100
export const TASK_IDLE_UNLOAD_MS = (() => {
  const v = parseInt(process.env.TASK_IDLE_UNLOAD_MS || '')
  if (Number.isFinite(v) && v > 0) return v
  return 5 * 60 * 1000
})()

// 文本分片 / 文件分片
export const TEXT_SPLIT_TARGET_LENGTH = parseInt(
  process.env.TEXT_SPLIT_TARGET_LENGTH || '500',
  10,
) || 500
export const MAX_AUDIO_FILE_SIZE = (() => {
  const v = parseInt(process.env.MAX_AUDIO_FILE_SIZE || '')
  if (Number.isFinite(v) && v > 0) return v
  return 500 * 1024 * 1024
})()

// SRT 字幕生成等待时间（edge-tts 异步写 .srt.json）
export const SRT_WAIT_MAX_MS = parseInt(process.env.SRT_WAIT_MAX_MS || '1500', 10) || 1500
