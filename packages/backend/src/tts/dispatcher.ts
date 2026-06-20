import { Readable } from 'stream'
import { TTSEngine, TtsOptions } from './types'
import { ttsPluginManager } from './pluginManager'

/**
 * 把请求级参数归一化成引擎入参
 */
export interface EngineRequest {
  engine?: string // 引擎名；不传或 'edge-tts' 是默认
  text: string
  voice?: string
  rate?: string
  pitch?: string
  volume?: string
  output?: string
  saveSubtitles?: boolean
  outputType?: 'buffer' | 'stream' | 'file'
}

const DEFAULT_ENGINE = 'edge-tts'

export function getEngine(name?: string): TTSEngine {
  const engine = ttsPluginManager.getEngine(name || DEFAULT_ENGINE)
  if (!engine) {
    throw new Error(
      `TTS engine "${name || DEFAULT_ENGINE}" not registered. Available: ${ttsPluginManager
        .getAllEngines()
        .map(e => e.name)
        .join(', ')}`
    )
  }
  return engine
}

/**
 * 把 Edge 风格的 "+10%" 字符串解析为 0.25~4.0 之间的 speed 倍率
 *  - "+0%"  -> 1.0
 *  - "+50%" -> 1.5
 *  - "-50%" -> 0.5
 *  - 超出范围 clamp 到 [0.25, 4.0]
 */
export function parseRateToSpeed(rate?: string): number | undefined {
  if (!rate) return undefined
  const m = /^([+\-]?\d+(?:\.\d+)?)\s*%$/.exec(rate.trim())
  if (!m) return undefined
  const pct = parseFloat(m[1])
  const speed = 1 + pct / 100
  if (speed < 0.25) return 0.25
  if (speed > 4.0) return 4.0
  return speed
}

/**
 * 把 Edge 风格 voice 名（如 "en-US-AriaNeural"）映射到目标引擎支持的 voice。
 *  - edge-tts / kokoro-tts: 透传原 voice
 *  - openai-tts: Edge voice 不在 OpenAI 内置列表，映射为默认 'alloy'
 */
const OPENAI_DEFAULT_VOICE = 'alloy'
const OPENAI_VOICE_PREFIXES = ['en-US', 'en-GB', 'zh-CN', 'ja-JP', 'fr-FR', 'de-DE']
export function mapVoiceForEngine(engine: string, voice?: string): string | undefined {
  if (!voice) return voice
  if (engine === 'openai-tts') {
    // OpenAI 引擎只认内置 voice：alloy/echo/fable/onyx/nova/shimmer
    const openAiVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
    if (openAiVoices.includes(voice)) return voice
    return OPENAI_DEFAULT_VOICE
  }
  return voice
}

/**
 * 通过 pluginManager 调用具体引擎。
 *  - rate 自动转为 speed（0.25~4.0），覆盖给 OpenAI/Kokoro
 *  - voice 跨引擎自动映射
 *  - saveSubtitles 默认 true（保持原 edge-tts.service 行为）
 *  - stream 字段与 outputType 双兼容：优先 outputType，其次 stream
 */
export async function synthesizeWithEngine(req: EngineRequest): Promise<Buffer | Readable> {
  const engine = getEngine(req.engine)
  const voice = mapVoiceForEngine(req.engine || DEFAULT_ENGINE, req.voice)
  const speed = parseRateToSpeed(req.rate)
  // 兼容 stream 字段：caller 可能传 { stream: true } 而不传 outputType
  const outputType: 'buffer' | 'stream' | 'file' | undefined =
    req.outputType ?? ((req as any).stream ? 'stream' : undefined)

  const opts: TtsOptions = {
    voice,
    rate: req.rate as any,
    pitch: req.pitch as any,
    volume: req.volume as any,
    speed,
    output: req.output,
    saveSubtitles: req.saveSubtitles ?? true,
    outputType,
    stream: outputType === 'stream',
  }
  return engine.synthesize(req.text, opts)
}

/**
 * 列出所有已注册引擎（供前端下拉）
 * 包含 metadata：语言列表、声音列表（首次调用时缓存）
 */
export function listEngines() {
  return ttsPluginManager.getAllEngines().map((e) => ({
    name: e.name,
  }))
}

/**
 * 列出所有引擎的完整 metadata（同步版本，引擎在 init 时已加载）
 */
export async function listEnginesWithMeta() {
  const engines = ttsPluginManager.getAllEngines()
  return Promise.all(
    engines.map(async (e) => ({
      name: e.name,
      supportedLanguages: await e.getSupportedLanguages(),
      voices: (await e.getVoiceOptions?.()) || [],
    }))
  )
}