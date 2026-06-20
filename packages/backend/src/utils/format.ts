/**
 * 通用参数格式化工具
 *
 * 之前 tts.controller.ts 和 stream.controller.ts 各有一份 `formatBody`，
 * 行为微不一致（stream 版本多了 `value === ''` 的兜底）。
 * 统一到本模块，service 层调用方拿到的就是标准形参。
 */

export type EdgeBodyInput = {
  text: string
  pitch?: string
  voice?: string
  volume?: string
  rate?: string
  useLLM?: boolean
  engine?: string
}

export function positivePercent(value: string | undefined): string {
  if (value === '0%' || value === '0' || value === undefined || value === '') return '+0%'
  return value
}

export function positiveHz(value: string | undefined): string {
  if (value === '0Hz' || value === '0' || value === undefined || value === '') return '+0Hz'
  return value
}

export function formatEdgeBody(input: EdgeBodyInput) {
  return {
    text: (input.text || '').trim(),
    pitch: positiveHz(input.pitch),
    voice: positivePercent(input.voice),
    rate: positivePercent(input.rate),
    volume: positivePercent(input.volume),
    useLLM: input.useLLM ?? false,
    engine: input.engine || 'edge-tts',
  }
}
