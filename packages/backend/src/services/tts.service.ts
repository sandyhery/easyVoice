import path from 'path'
import fs from 'fs/promises'
import { AUDIO_DIR, audioUrl, EDGE_API_LIMIT } from '../config'
import { logger } from '../utils/logger'
import { getPrompt } from '../llm/prompt/generateSegment'
import { ensureDir, generateId, getLangConfig, waitForSrtSource } from '../utils'
import { detectChapters, splitText, splitTextWithChapters } from './text.service'
import { normalizeForTTS } from './normalize.service'
import { openai, createOpenAIClient, type OpenAIClient } from '../utils/openai'
import { generateSingleVoice, generateSrt } from './edge-tts.service'
import { EdgeSchema } from '../schema/generate'
import audioCacheInstance from './audioCache.service'
import taskManager, { Task } from '../utils/taskManager'
import { handleSrt } from './tts.stream.service'
import {
  buildFinal,
  concatDirAudio,
  concatDirSrt,
  ErrorMessages,
  fetchLLMSegment,
  parseLLMResponse,
  runConcurrentTasks,
  sortAudioDir,
  validateLangAndVoice,
  validateTTSResult,
  type ConcatAudioParams,
} from './tts.shared'
// 复用错误枚举（向后兼容外部 import 路径）
export { ErrorMessages } from './tts.shared'
// 复用 concat 接口
export type { ConcatAudioParams } from './tts.shared'


/**
 * 生成文本转语音 (TTS) 的音频和字幕
 */
export async function generateTTS(params: Required<EdgeSchema>, task?: Task, openaiClient?: OpenAIClient): Promise<TTSResult> {
  const { pitch, voice, rate, volume, useLLM } = params
  // 文本归一化只做一次：cacheKey / segment / 后续 splitText 都用同一份
  const text = normalizeForTTS((params.text || '').trim())
  // 检查缓存
  const cacheKey = taskManager.generateTaskId({ text, pitch, voice, rate, volume })
  const cache = await audioCacheInstance.getAudio(cacheKey)
  if (cache) {
    logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`)
    return cache
  }

  // 章节检测：识别"第X章/卷X/Chapter X"等标题
  const detectedChapters = detectChapters(text)
  // 第一个章节的元信息（用于结果标注）
  const firstChapter = detectedChapters[0]

  const segment: Segment = { id: generateId(`${useLLM ? 'aigen-' : voice}`, text, firstChapter?.index), text }
  const { lang, voiceList } = await getLangConfig(segment.text)
  logger.debug(`Language detected lang: `, lang)
  validateLangAndVoice(lang, voice)

  let result: TTSResult
  if (useLLM) {
    result = await generateWithLLM(segment, voiceList, lang, task, openaiClient)
  } else {
    result = await generateWithoutLLM(
      segment,
      {
        text,
        pitch,
        voice,
        rate,
        volume,
        output: segment.id,
      },
      task
    )
  }

  // 把章节信息挂到结果上（前端 DownloadList 可展示）
  if (detectedChapters.length > 0) {
    result.chapter = {
      index: firstChapter!.index,
      title: firstChapter!.title,
      total: detectedChapters.length,
    }
  }

  // 验证结果并缓存
  validateTTSResult(result, segment.id)
  logger.info(`Generated audio succeed: `, result)
  if (result.partial) {
    logger.warn(`Partial result detected, some splits generated audio failed!`)
  } else {
    await audioCacheInstance.setAudio(cacheKey, { ...params, ...result })
  }
  return result
}

/**
 * 使用 LLM 生成 TTS
 */
async function generateWithLLM(
  segment: Segment,
  voiceList: VoiceConfig[],
  lang: string,
  task?: Task,
  openaiClient?: OpenAIClient,
): Promise<TTSResult> {
  const { text, id } = segment
  const { length, segments } = splitText(text, undefined, { normalize: false })
  const formatLlmSegments = (llmSegments: any) =>
    llmSegments
      .filter((segment: any) => segment.text)
      .map((segment: any) => ({
        ...segment,
        voice: segment.name,
      }))
  if (length <= 1) {
    const prompt = getPrompt(lang, voiceList, segments[0])
    // logger.debug(`Prompt for LLM: ${prompt}`)
    const llmResponse = await fetchLLMSegment(prompt, openaiClient ?? openai)
    let llmSegments = llmResponse?.result || llmResponse?.segments || []
    if (!Array.isArray(llmSegments)) {
      task?.endTask?.(task.id)
      throw new Error(
        'LLM response is not an array, please switch to Edge TTS mode or use another model'
      )
    }
    const result = await buildSegmentList(segment, formatLlmSegments(llmSegments), task)
    task?.updateProgress?.(task.id, 100)
    return result
  } else {
    logger.info('Splitting text into multiple segments:', segments.length)
    let finalSegments = []
    let count = 0
    const getProgress = () => {
      return Number(((count / segments.length) * 100).toFixed(2))
    }
    for (let seg of segments) {
      if (task?.cancelled) {
        logger.info(`generateWithLLM cancelled at ${count}/${segments.length}`)
        break
      }
      count++
      const prompt = getPrompt(lang, voiceList, seg)
      // logger.debug(`Prompt for LLM: ${prompt}`)
      const llmResponse = await fetchLLMSegment(prompt, openaiClient ?? openai)
      let llmSegments = llmResponse?.result || llmResponse?.segments || []
      if (!Array.isArray(llmSegments)) {
        throw new Error(
          'LLM response is not an array, please switch to Edge TTS mode or use another model'
        )
      }
      if (task?.cancelled) {
        logger.info(`generateWithLLM cancelled before buildSegmentList ${count}`)
        break
      }
      const result = await buildSegmentList(
        { ...segment, id: `[segments:${count}]${segment.id}` },
        formatLlmSegments(llmSegments),
        task
      )
      task?.updateProgress?.(task.id, getProgress())
      finalSegments.push(result)
    }
    if (task?.cancelled) {
      // 抛错让上层 failTask 处理（而不是返回半成品结果）
      throw new Error('cancelled by user')
    }
    return await buildFinal(finalSegments, id)
  }
}

/**
 * 不使用 LLM 生成 TTS
 */
async function generateWithoutLLM(
  segment: Segment,
  params: TTSParams,
  task?: Task
): Promise<TTSResult> {
  const { text, pitch, voice, rate, volume } = params
  const { length, segments } = splitText(text, undefined, { normalize: false })

  if (length <= 1) {
    return buildSegment(segment, params)
  } else {
    const buildSegments = segments.map((segment) => ({ ...params, text: segment }))
    let result = await buildSegmentList(segment, buildSegments, task)
    task?.updateProgress?.(task.id, 100)
    return result
  }
}

/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(
  segment: Segment,
  params: TTSParams,
  dir: string = ''
): Promise<TTSResult> {
  const { id, text } = segment
  const { pitch, voice, rate, volume } = params
  const output = path.resolve(AUDIO_DIR, dir, id)
  const result = await generateSingleVoice({
    text,
    pitch,
    voice,
    rate,
    volume,
    output,
  })
  logger.info('Generated single segment:', result)
  try {
    await waitForSrtSource(output)
    await handleSrt(output, false)
  } catch (e) {
    logger.warn(`handleSrt failed for ${output}: ${(e as Error).message}`)
  }
  return {
    audio: `${audioUrl(path.join(dir, id))}`,
    srt: `${audioUrl(path.join(dir, id.replace('.mp3', '.srt')))}`,
  }
}

/**
 * 生成多个片段并合并的 TTS
 */
async function buildSegmentList(
  segment: Segment,
  segments: BuildSegment[],
  task?: Task
): Promise<TTSResult> {
  const fileList: string[] = []
  const length = segments.length
  let handledLength = 0

  if (!length) {
    throw new Error(`No segments found for task ${task?.id || 'unknown'}!`)
  }
  const { id } = segment
  const tmpDirName = id.replace('.mp3', '')
  const tmpDirPath = path.resolve(AUDIO_DIR, tmpDirName)
  await ensureDir(tmpDirPath)
  await fs.writeFile(
    path.resolve(tmpDirPath, 'ai-segments.json'),
    JSON.stringify(segments, null, 2)
  )
  const getProgress = () => {
    return Number((((handledLength / length) * 100) / (id.includes('segment') ? 2 : 1)).toFixed(2))
  }
  const tasks = segments.map((segment, index) => async () => {
    if (task?.cancelled) return null
    const { text, pitch, voice, rate, volume } = segment
    const output = path.resolve(tmpDirPath, `${index + 1}_splits.mp3`)
    const cacheKey = taskManager.generateTaskId({ text, pitch, voice, rate, volume })
    const cache = await audioCacheInstance.getAudio(cacheKey)
    if (cache) {
      logger.info(`Cache hit[segments]: ${voice} ${text.slice(0, 10)}`)
      fileList.push(cache.audio)
      return cache
    }
    if (task?.cancelled) return null
    const result = await generateSingleVoice({ text, pitch, voice, rate, volume, output })
    if (task?.cancelled) return null
    logger.debug(`Cache miss and generate audio: ${result.audio}, ${result.srt}`)
    fileList.push(result.audio)
    handledLength++
    task?.updateProgress?.(task.id, getProgress())
    const params = { text, pitch, voice, rate, volume }
    await audioCacheInstance.setAudio(cacheKey, { ...params, ...result })
    return result
  })
  let partial = false
  const results = await runConcurrentTasks(tasks, EDGE_API_LIMIT, () => task?.cancelled === true)
  if (task?.cancelled) {
    logger.info(`buildSegmentList cancelled, skip concat`)
    throw new Error('cancelled by user')
  }
  if (results?.some((result) => !result.success)) {
    logger.warn(`Partial result detected, some splits generated audio failed!`, results)
    partial = true
  }
  const outputFile = path.resolve(AUDIO_DIR, id)
  logger.debug(`Concatenating audio files from ${tmpDirPath} to ${outputFile}`)
  await concatDirAudio({ inputDir: tmpDirPath, fileList, outputFile })
  await concatDirSrt({ inputDir: tmpDirPath, fileList, outputFile })
  logger.debug(
    `Concatenating SRT files from ${tmpDirPath} to ${outputFile.replace('.mp3', '.srt')}`
  )

  return {
    audio: `${audioUrl(id)}`,
    srt: `${audioUrl(id.replace('.mp3', '.srt'))}`,
    partial,
  }
}
