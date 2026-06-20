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
 * 通过 pluginManager 调用具体引擎。
 * 如果 outputType === 'stream'，返回 Readable；否则 Buffer。
 */
export async function synthesizeWithEngine(req: EngineRequest): Promise<Buffer | Readable> {
  const engine = getEngine(req.engine)
  // 把 EdgeTTS 风格的字符串 rate/pitch/volume 透传下去。
  // 不同引擎可以内部忽略它无法识别的字段。
  const opts: TtsOptions = {
    voice: req.voice,
    rate: req.rate as any,
    pitch: req.pitch as any,
    volume: req.volume as any,
    output: req.output,
    saveSubtitles: req.saveSubtitles ?? false,
    outputType: req.outputType,
    stream: req.outputType === 'stream',
  }
  return engine.synthesize(req.text, opts)
}

/**
 * 列出所有已注册引擎（供前端下拉）
 */
export function listEngines() {
  return ttsPluginManager.getAllEngines().map(e => ({
    name: e.name,
  }))
}