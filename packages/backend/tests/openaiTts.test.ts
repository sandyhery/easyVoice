// tests/openaiTts.test.ts
// 覆盖 OpenAITtsEngine.synthesize：基础合成 + voice 校验 + rate->speed 接收

import { OpenAITtsEngine } from '../src/tts/engines/openaiTts'
import { fetcher } from '../src/utils/request'

jest.mock('../src/utils/request', () => ({
  fetcher: {
    post: jest.fn(),
  },
}))

const mockFetcher = fetcher as jest.Mocked<typeof fetcher>

describe('OpenAITtsEngine.synthesize', () => {
  beforeEach(() => {
    mockFetcher.post.mockReset()
  })

  test('基础合成（alloy voice + buffer）', async () => {
    const fakeArrayBuffer = new ArrayBuffer(8)
    mockFetcher.post.mockResolvedValue({ data: fakeArrayBuffer } as any)
    const engine = new OpenAITtsEngine('sk-test')
    const result = await engine.synthesize('hello', {
      voice: 'alloy',
      outputType: 'buffer',
    })
    expect(Buffer.isBuffer(result)).toBe(true)
    // 验证请求体
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect(lastCall[1]).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: 'hello',
      voice: 'alloy',
      response_format: 'mp3',
    })
    // 验证 responseType
    expect(lastCall[2]).toMatchObject({ responseType: 'arraybuffer' })
  })

  test('非法 voice 抛错', async () => {
    const engine = new OpenAITtsEngine('sk-test')
    await expect(
      engine.synthesize('hello', { voice: 'invalid-voice' as any, outputType: 'buffer' })
    ).rejects.toThrow(/voice/i)
  })

  test('speed clamp 到 [0.25, 4.0]（验证 speed 被传）', async () => {
    mockFetcher.post.mockResolvedValue({ data: new ArrayBuffer(0) } as any)
    const engine = new OpenAITtsEngine('sk-test')
    await engine.synthesize('hi', {
      voice: 'alloy',
      speed: 0.5,
      outputType: 'buffer',
    })
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect((lastCall[1] as any).speed).toBe(0.5)
  })

  test('API key 通过 Authorization header 传', async () => {
    mockFetcher.post.mockResolvedValue({ data: new ArrayBuffer(0) } as any)
    const engine = new OpenAITtsEngine('sk-secret-key')
    await engine.synthesize('hi', { voice: 'alloy', outputType: 'buffer' })
    const lastCall = mockFetcher.post.mock.calls[mockFetcher.post.mock.calls.length - 1]
    expect((lastCall[2] as any).headers.Authorization).toBe('Bearer sk-secret-key')
  })
})