// tests/kokoroTts.test.ts
// 覆盖 KokoroTtsEngine：初始化健康检查 + synthesize + 静默丢弃参数 warn

import { Readable } from 'stream'
import { KokoroTtsEngine } from '../src/tts/engines/kokoroTts'
import { fetcher } from '../src/utils/request'

jest.mock('../src/utils/request', () => ({
  fetcher: {
    get: jest.fn(),
    post: jest.fn(),
  },
}))

const mockFetcher = fetcher as jest.Mocked<typeof fetcher>

describe('KokoroTtsEngine.initialize', () => {
  beforeEach(() => {
    mockFetcher.get.mockReset()
  })

  test('healthy 状态：initialized = true', async () => {
    mockFetcher.get.mockResolvedValue({ data: { status: 'healthy' } } as any)
    const engine = new KokoroTtsEngine()
    await engine.initialize()
    expect((engine as any).initialized).toBe(true)
  })

  test('非 healthy 状态：抛错', async () => {
    mockFetcher.get.mockResolvedValue({ data: { status: 'down' } } as any)
    const engine = new KokoroTtsEngine()
    await expect(engine.initialize()).rejects.toThrow(/not healthy/i)
  })

  test('网络错误：抛错（包含原始错误信息）', async () => {
    mockFetcher.get.mockRejectedValue(new Error('ECONNREFUSED'))
    const engine = new KokoroTtsEngine()
    await expect(engine.initialize()).rejects.toThrow(/Failed to initialize Kokoro TTS/)
  })

  test('health 端点 baseUrl 处理：去除 /v1 后缀', async () => {
    mockFetcher.get.mockResolvedValue({ data: { status: 'healthy' } } as any)
    const engine = new KokoroTtsEngine('http://example.com/v1')
    await engine.initialize()
    const url = mockFetcher.get.mock.calls[0][0]
    expect(url).toBe('http://example.com/health')
  })
})

describe('KokoroTtsEngine.synthesize', () => {
  let engine: KokoroTtsEngine
  let warnSpy: jest.SpyInstance

  beforeEach(async () => {
    mockFetcher.get.mockReset()
    mockFetcher.post.mockReset()
    // mock health-check OK
    mockFetcher.get.mockResolvedValue({ data: { status: 'healthy' } } as any)
    engine = new KokoroTtsEngine()
    await engine.initialize()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // logger 也用 warn，重置
    jest.spyOn(require('../src/utils/logger').logger, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  test('未初始化抛错', async () => {
    const fresh = new KokoroTtsEngine()
    await expect(
      fresh.synthesize('hi', { voice: 'af_bella' })
    ).rejects.toThrow(/not initialized/i)
  })

  test('基础合成：返回 Buffer（responseType: arraybuffer）', async () => {
    mockFetcher.post.mockResolvedValue({ data: new ArrayBuffer(8) } as any)
    const result = await engine.synthesize('hello', {
      voice: 'af_bella',
      speed: 1.0,
      format: 'mp3',
    })
    expect(Buffer.isBuffer(result)).toBe(true)
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect(lastCall[2]).toMatchObject({ responseType: 'arraybuffer' })
  })

  test('流式合成：返回 Readable', async () => {
    const stream = new Readable({ read() {} })
    mockFetcher.post.mockResolvedValue({ data: stream } as any)
    const result = await engine.synthesize('stream text', {
      voice: 'af_bella',
      stream: true,
    })
    expect(result).toBe(stream)
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect(lastCall[2]).toMatchObject({ responseType: 'stream' })
  })

  test('pitch / volume / style 被静默丢弃（logger.warn 调用）', async () => {
    const loggerModule = require('../src/utils/logger')
    mockFetcher.post.mockResolvedValue({ data: new ArrayBuffer(0) } as any)
    await engine.synthesize('hi', {
      voice: 'af_bella',
      pitch: 1.0,
      volume: 0.8,
      style: 'cheerful',
    })
    expect(loggerModule.logger.warn).toHaveBeenCalledWith(expect.stringContaining('pitch=1'))
    expect(loggerModule.logger.warn).toHaveBeenCalledWith(expect.stringContaining('volume=0.8'))
    expect(loggerModule.logger.warn).toHaveBeenCalledWith(expect.stringContaining('style=cheerful'))
  })

  test('支持 mp3 / wav / 非法 format 抛错', async () => {
    mockFetcher.post.mockResolvedValue({ data: new ArrayBuffer(0) } as any)
    await engine.synthesize('hi', { voice: 'af_bella', format: 'wav' })
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect((lastCall[1] as any).response_format).toBe('wav')

    await expect(
      engine.synthesize('hi', { voice: 'af_bella', format: 'opus' as any })
    ).rejects.toThrow(/format/i)
  })
})