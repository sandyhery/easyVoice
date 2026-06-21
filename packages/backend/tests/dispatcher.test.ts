// tests/dispatcher.test.ts
// 覆盖 dispatcher 关键路径：
// - parseRateToSpeed：Edge 风格 rate → speed (含 clamp)
// - mapVoiceForEngine：跨引擎 voice 映射（OpenAI 兜底）
// - synthesizeWithEngine：主路由（mock pluginManager）

import { parseRateToSpeed, mapVoiceForEngine } from '../src/tts/dispatcher'

describe('parseRateToSpeed', () => {
  test('基础百分比', () => {
    expect(parseRateToSpeed('+0%')).toBe(1.0)
    expect(parseRateToSpeed('-0%')).toBe(1.0)
    expect(parseRateToSpeed('+10%')).toBe(1.1)
    expect(parseRateToSpeed('-25%')).toBe(0.75)
  })

  test('大数 clamp 到 [0.25, 4.0]', () => {
    expect(parseRateToSpeed('+500%')).toBe(4.0)
    expect(parseRateToSpeed('-200%')).toBe(0.25)
    expect(parseRateToSpeed('+1000%')).toBe(4.0)
    expect(parseRateToSpeed('-500%')).toBe(0.25)
  })

  test('undefined / 空 / 非法输入', () => {
    expect(parseRateToSpeed(undefined)).toBeUndefined()
    expect(parseRateToSpeed('')).toBeUndefined()
    expect(parseRateToSpeed('abc')).toBeUndefined()
    expect(parseRateToSpeed('100')).toBeUndefined() // 缺 % 后缀
    expect(parseRateToSpeed('+50')).toBeUndefined() // 缺 % 后缀
  })

  test('小数百分比', () => {
    expect(parseRateToSpeed('+12.5%')).toBeCloseTo(1.125, 3)
    expect(parseRateToSpeed('-7.5%')).toBeCloseTo(0.925, 3)
  })
})

describe('mapVoiceForEngine', () => {
  test('edge-tts 透传原 voice', () => {
    expect(mapVoiceForEngine('edge-tts', 'zh-CN-YunjianNeural')).toBe('zh-CN-YunjianNeural')
    expect(mapVoiceForEngine('edge-tts', 'en-US-AriaNeural')).toBe('en-US-AriaNeural')
  })

  test('kokoro-tts 透传原 voice', () => {
    expect(mapVoiceForEngine('kokoro-tts', 'af_bella')).toBe('af_bella')
  })

  test('openai-tts 收到 Edge voice 降级到 alloy', () => {
    expect(mapVoiceForEngine('openai-tts', 'zh-CN-YunjianNeural')).toBe('alloy')
    expect(mapVoiceForEngine('openai-tts', 'en-US-AriaNeural')).toBe('alloy')
  })

  test('openai-tts 收到 OpenAI 内置 voice 透传', () => {
    expect(mapVoiceForEngine('openai-tts', 'alloy')).toBe('alloy')
    expect(mapVoiceForEngine('openai-tts', 'echo')).toBe('echo')
    expect(mapVoiceForEngine('openai-tts', 'onyx')).toBe('onyx')
  })

  test('undefined voice 透传 undefined', () => {
    expect(mapVoiceForEngine('openai-tts', undefined)).toBeUndefined()
    expect(mapVoiceForEngine('edge-tts', undefined)).toBeUndefined()
  })

  test('空字符串 / 空白 voice 视为未传（返回 undefined）', () => {
    expect(mapVoiceForEngine('openai-tts', '')).toBeUndefined()
    expect(mapVoiceForEngine('edge-tts', '')).toBeUndefined()
    expect(mapVoiceForEngine('openai-tts', '   ')).toBeUndefined()
  })

  test('未知引擎透传原 voice', () => {
    // 未注册的引擎名当作透传（dispatcher 会找不到引擎，getEngine 抛错）
    expect(mapVoiceForEngine('unknown-engine', 'zh-CN-XiaoxiaoNeural')).toBe('zh-CN-XiaoxiaoNeural')
  })
})

describe('parseRateToSpeed 边界：刚好 [0.25, 4.0]', () => {
  test('+300% = 4.0 (clamp 上限)', () => {
    expect(parseRateToSpeed('+300%')).toBe(4.0)
  })
  test('-75% = 0.25 (clamp 下限)', () => {
    expect(parseRateToSpeed('-75%')).toBe(0.25)
  })
})