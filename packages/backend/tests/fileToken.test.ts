import { signDownloadToken, verifyDownloadToken } from '../src/utils/fileToken'
import { audioUrl } from '../src/config'

describe('fileToken', () => {
  test('签发并验证合法 token', () => {
    const token = signDownloadToken('test.mp3', 60_000)
    expect(verifyDownloadToken(token)).toBe('test.mp3')
  })

  test('过期 token 返回 null', async () => {
    const token = signDownloadToken('test.mp3', 1100)
    await new Promise((r) => setTimeout(r, 1200))
    expect(verifyDownloadToken(token)).toBeNull()
  })

  test('篡改 token 返回 null', () => {
    const token = signDownloadToken('test.mp3', 60_000)
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A')
    expect(verifyDownloadToken(tampered)).toBeNull()
  })

  test('拒绝路径穿越', () => {
    expect(() => signDownloadToken('../etc/passwd', 60_000)).toThrow()
    expect(() => signDownloadToken('/abs.mp3', 60_000)).toThrow()
  })

  test('空 token 返 null', () => {
    expect(verifyDownloadToken('')).toBeNull()
    expect(verifyDownloadToken('abc')).toBeNull()
  })

  test('audioUrl 拼出符合预期的 url', () => {
    const url = audioUrl('x.mp3')
    // 形如 `${STATIC_DOMAIN}/api/v1/tts/file/${token}`，STATIC_DOMAIN 在测试里为空字符串
    expect(url).toMatch(/^(https?:\/\/[^/]+)?\/api\/v1\/tts\/file\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const token = url.split('/').pop()!
    expect(verifyDownloadToken(token)).toBe('x.mp3')
  })
})
