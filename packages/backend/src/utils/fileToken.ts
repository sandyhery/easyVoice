import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * 下载 token 工具
 *
 * 设计目标：
 * - 文件不再走 `express.static(AUDIO_DIR)`（避免枚举/任意下载）
 * - 用 HMAC 签名代替鉴权：拿到 URL 的人可以下载，但无法伪造新 URL
 * - token 默认 24h 过期；过期后失效
 * - 不带查询参数，URL 形如 `/file/<base64url-token>`
 *
 * 风险说明：
 * - 该 token 是"持有者令牌"（bearer token），拿到的人即可下载
 * - 适合作为"防止爬虫枚举/外部链接防泄漏"的轻量防线
 * - 不替代真正的鉴权层；如需多用户隔离，应在签发前校验调用方身份
 */

const SECRET =
  process.env.FILE_DOWNLOAD_SECRET || randomBytes(32).toString('hex')
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

interface TokenPayload {
  /** 相对 AUDIO_DIR 的文件名，禁止含 `..` 或绝对路径 */
  file: string
  /** 过期时间戳（毫秒） */
  exp: number
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(data: string): string {
  return b64url(createHmac('sha256', SECRET).update(data).digest())
}

/**
 * 签发下载 token
 * @param file 相对 AUDIO_DIR 的文件名
 * @param ttlMs 有效期（毫秒），默认 24h
 */
export function signDownloadToken(file: string, ttlMs: number = DEFAULT_TTL_MS): string {
  if (!file || file.includes('..') || file.startsWith('/')) {
    throw new Error('Invalid file name for token')
  }
  const payload: TokenPayload = {
    file,
    exp: Date.now() + Math.max(1000, ttlMs),
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(body)
  return `${body}.${sig}`
}

/**
 * 校验 token 并返回文件名，失败返回 null
 */
export function verifyDownloadToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: TokenPayload
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload.file !== 'string' || typeof payload.exp !== 'number') {
    return null
  }
  if (Date.now() > payload.exp) return null
  if (payload.file.includes('..') || payload.file.startsWith('/')) return null
  return payload.file
}

/**
 * 构造可访问的下载 URL。
 * `pathPrefix` 形如 `/api/v1/tts/file`
 */
export function buildDownloadUrl(
  staticDomain: string,
  pathPrefix: string,
  file: string,
  ttlMs?: number,
): string {
  const token = signDownloadToken(file, ttlMs)
  const prefix = pathPrefix.startsWith('/') ? pathPrefix : `/${pathPrefix}`
  return `${staticDomain}${prefix}/${token}`
}
