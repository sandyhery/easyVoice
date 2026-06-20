import { Jieba } from '@node-rs/jieba'
import { normalizeForTTS } from './normalize.service'
import { TEXT_SPLIT_TARGET_LENGTH } from '../config'

const jieba = new Jieba()

/**
 * 按中英文句号/感叹号/问号把文本切成句，再按 targetLength 合并。
 * 返回的每个元素 ≤ targetLength。
 */
function splitBySentence(text: string, targetLength: number): string[] {
  // 用 split + 捕获分隔符，保留标点
  const parts = text.split(/([。！？.!?])/)
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = (parts[i] || '') + (parts[i + 1] || '')
    if (!sentence.trim()) continue
    if ((buf + sentence).length <= targetLength) {
      buf += sentence
    } else {
      if (buf) out.push(buf.trim())
      buf = sentence
    }
  }
  if (buf) out.push(buf.trim())
  return out
}

/**
 * 用 jieba 把一个长句按词切到 targetLength 以内。
 * jieba 对纯中文效果最好，对纯英文/数字串不切（这种情况下需要 char 兜底）。
 */
function splitByJieba(text: string, targetLength: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const word of jieba.cut(text)) {
    if ((buf + word).length <= targetLength) {
      buf += word
    } else {
      if (buf) out.push(buf)
      buf = word
    }
  }
  if (buf) out.push(buf)
  return out
}

/**
 * 字符级兜底：硬按 targetLength 切，丢掉所有语义信息但保证有结果。
 * 用于 jieba 也救不回来的极端输入（超长纯英文/数字串）。
 */
function splitByChar(text: string, targetLength: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += targetLength) {
    out.push(text.slice(i, i + targetLength))
  }
  return out
}

export function splitText(text: string, targetLength = TEXT_SPLIT_TARGET_LENGTH, opts: { normalize?: boolean } = {}) {
  // 归一化开关默认开启；调用方可传 normalize=false 跳过（例如底层测试）
  const normalized = opts.normalize === false ? text : normalizeForTTS(text)
  if (normalized.length < targetLength) return { length: 1, segments: [normalized] }

  // 1. 按句子切；2. 对仍超长的走 jieba；3. 还超长就走字符兜底
  let segments: string[] = []
  for (const s of splitBySentence(normalized, targetLength)) {
    if (s.length <= targetLength) {
      segments.push(s)
    } else {
      const jiebaParts = splitByJieba(s, targetLength)
      for (const p of jiebaParts) {
        if (p.length <= targetLength) {
          segments.push(p)
        } else {
          segments.push(...splitByChar(p, targetLength))
        }
      }
    }
  }

  return { length: segments.length, segments }
}

/**
 * 章节元信息（从一段文本里识别"第X章/卷X/Chapter X"等标题）
 */
export interface Chapter {
  index: number // 从 1 开始
  title: string
  /** 章节起始位置（原始文本中的字符索引） */
  offset: number
}

/**
 * 识别章节标题。覆盖：
 *   - 第X章 / 第X回 / 第X节 / 第X卷
 *   - Chapter X / CHAPTER X / Chap. X
 *   - 第X部
 * 中文数字 + 阿拉伯数字都识别。
 */
const CHAPTER_REGEX = /^[ \t]*(第[\s　]*[零一二三四五六七八九十百千0-9]{1,8}[\s　]*(?:章|回|节|卷|部)|Chapter[\s]+[0-9零一二三四五六七八九十]{1,5}|CHAPTER[\s]+[0-9]+|Chap\.[\s]+[0-9]+)[ \t]*[：:、\.\s]*(.*)$/gm

export function detectChapters(text: string): Chapter[] {
  const chapters: Chapter[] = []
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = CHAPTER_REGEX.exec(text)) !== null) {
    idx++
    const title = (m[1] + (m[2] ? '：' + m[2].trim() : '')).trim()
    chapters.push({ index: idx, title, offset: m.index })
  }
  return chapters
}

/**
 * 章节切分：先识别章节标题，再按章节做文本分片。
 * 每个 segment 带有 chapterIndex（无标题时为 0）。
 *
 * 用途：把一本小说切成"卷X / 第X章"结构的片段，方便：
 *   - 文件名带章节号
 *   - 进度按章节展示
 *   - 后续可按章节并发
 */
export interface SegmentWithChapter {
  text: string
  chapterIndex: number // 0 = 无章节（标题之前的内容）
  chapterTitle: string
}

export function splitTextWithChapters(
  text: string,
  targetLength = TEXT_SPLIT_TARGET_LENGTH,
  opts: { normalize?: boolean } = {},
): { length: number; segments: SegmentWithChapter[]; chapterCount: number } {
  const normalized = opts.normalize === false ? text : normalizeForTTS(text)
  const chapters = detectChapters(normalized)
  if (!chapters.length) {
    // 无章节标题：退回普通分片，全部归到 chapter 0
    const { length, segments } = splitText(normalized, targetLength, { normalize: false })
    return {
      length,
      chapterCount: 0,
      segments: segments.map((s) => ({ text: s, chapterIndex: 0, chapterTitle: '' })),
    }
  }

  const out: SegmentWithChapter[] = []
  // 标题之前的内容归到 chapter 0
  const preChapter = normalized.slice(0, chapters[0].offset).trim()
  if (preChapter) {
    const { segments } = splitText(preChapter, targetLength, { normalize: false })
    for (const s of segments) out.push({ text: s, chapterIndex: 0, chapterTitle: '' })
  }

  // 每两个章节标题之间是一章节
  for (let i = 0; i < chapters.length; i++) {
    const cur = chapters[i]
    const next = chapters[i + 1]
    const start = cur.offset
    const end = next ? next.offset : normalized.length
    const body = normalized.slice(start, end).trim()
    if (!body) continue
    const { segments } = splitText(body, targetLength, { normalize: false })
    for (const s of segments) {
      out.push({ text: s, chapterIndex: cur.index, chapterTitle: cur.title })
    }
  }
  return { length: out.length, segments: out, chapterCount: chapters.length }
}
