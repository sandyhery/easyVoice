import { Jieba } from '@node-rs/jieba'
import { normalizeForTTS } from './normalize.service'
import { TEXT_SPLIT_TARGET_LENGTH } from '../config'

const jieba = new Jieba()
export function splitText(text: string, targetLength = TEXT_SPLIT_TARGET_LENGTH, opts: { normalize?: boolean } = {}) {
  // 归一化开关默认开启；调用方可传 normalize=false 跳过（例如底层测试）
  const normalized = opts.normalize === false ? text : normalizeForTTS(text)
  if (normalized.length < targetLength) return { length: 1, segments: [normalized] }
  const segments: string[] = []
  let currentSegment = ''
  const sentences = normalized.split(/([。！？.!?])/)

  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = (sentences[i] || '') + (sentences[i + 1] || '')
    if (!sentence.trim()) continue

    if ((currentSegment + sentence).length <= targetLength) {
      currentSegment += sentence
    } else {
      if (currentSegment) {
        segments.push(currentSegment.trim())
      }
      currentSegment = sentence
    }
  }

  if (currentSegment) {
    segments.push(currentSegment.trim())
  }

  const finalSegments = []
  for (let segment of segments) {
    if (segment.length <= targetLength) {
      finalSegments.push(segment)
    } else {
      const words = jieba.cut(segment)
      let subSegment = ''
      for (let word of words) {
        if ((subSegment + word).length <= targetLength) {
          subSegment += word
        } else {
          finalSegments.push(subSegment)
          subSegment = word
        }
      }
      if (subSegment) finalSegments.push(subSegment)
    }
  }

  return { length: finalSegments.length, segments: finalSegments }
}
