// tests/edgeTts.test.ts
// 覆盖 EdgeTtsEngine.synthesize：基础合成 + saveSubtitles 透传 + lang 提取

import { Readable } from 'stream'
import { EdgeTtsEngine } from '../src/tts/engines/edgeTts'

jest.mock('../src/lib/node-edge-tts/edge-tts-fixed', () => ({
  EdgeTTS: jest.fn().mockImplementation((opts: any) => ({
    ttsPromise: jest.fn().mockResolvedValue(Buffer.from('mock-audio-bytes')),
    _opts: opts,
  })),
}))

describe('EdgeTtsEngine.synthesize', () => {
  beforeEach(() => {
    ;(require('../src/lib/node-edge-tts/edge-tts-fixed').EdgeTTS as jest.Mock).mockClear()
  })

  test('基础合成：返回 Buffer', async () => {
    const engine = new EdgeTtsEngine()
    const buf = await engine.synthesize('你好', {
      voice: 'zh-CN-XiaoxiaoNeural',
      outputType: 'buffer',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.toString()).toBe('mock-audio-bytes')
  })

  test('saveSubtitles 透传给底层 EdgeTTS 构造器', async () => {
    const engine = new EdgeTtsEngine()
    await engine.synthesize('test', {
      voice: 'en-US-AriaNeural',
      outputType: 'buffer',
      saveSubtitles: true,
    })
    const EdgeTTSMock = require('../src/lib/node-edge-tts/edge-tts-fixed').EdgeTTS
    const lastCall = EdgeTTSMock.mock.calls[EdgeTTSMock.mock.calls.length - 1][0]
    expect(lastCall.saveSubtitles).toBe(true)
    expect(lastCall.voice).toBe('en-US-AriaNeural')
  })

  test('lang 从 voice 名严格提取（开头小写-大写）', async () => {
    const engine = new EdgeTtsEngine()
    await engine.synthesize('test', {
      voice: 'zh-CN-YunjianNeural',
      outputType: 'buffer',
    })
    const EdgeTTSMock = require('../src/lib/node-edge-tts/edge-tts-fixed').EdgeTTS
    const lastCall = EdgeTTSMock.mock.calls[EdgeTTSMock.mock.calls.length - 1][0]
    expect(lastCall.lang).toBe('zh-CN')
  })

  test('流式合成：返回 Readable', async () => {
    const stream = new Readable({ read() {} })
    ;(require('../src/lib/node-edge-tts/edge-tts-fixed').EdgeTTS as jest.Mock).mockImplementationOnce(
      () => ({
        ttsPromise: jest.fn().mockResolvedValue(stream),
      })
    )
    const engine = new EdgeTtsEngine()
    const result = await engine.synthesize('流式', {
      voice: 'zh-CN-XiaoxiaoNeural',
      stream: true,
    })
    expect(result).toBe(stream)
  })
})

describe('EdgeTtsEngine.getSupportedLanguages / getVoiceOptions', () => {
  const engine = new EdgeTtsEngine()
  test('getSupportedLanguages 返回静态列表', async () => {
    const langs = await engine.getSupportedLanguages()
    expect(Array.isArray(langs)).toBe(true)
    expect(langs).toContain('zh-CN')
  })

  test('getVoiceOptions 返回静态列表', async () => {
    const voices = await engine.getVoiceOptions()
    expect(Array.isArray(voices)).toBe(true)
    expect(voices.length).toBeGreaterThan(10)
    expect(voices).toContain('zh-CN-XiaoxiaoNeural')
  })
})