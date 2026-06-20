/**
 * tts.service.ts 与 tts.stream.service.ts 之间共享的逻辑。
 * 之前两份代码各有一份，改 bug 要改两遍；现在统一抽到本文件。
 *
 * 包含：
 *  - 错误消息枚举
 *  - 校验工具（语言/voice、结果完整性）
 *  - LLM 拼接 / 解析
 *  - 音频/字幕文件合并 + 排序
 *  - 并发任务执行器
 *  - 多段任务结果合并
 */
import path from 'path'
import fs from 'fs/promises'
import ffmpeg from 'fluent-ffmpeg'
import { AUDIO_DIR, audioUrl, EDGE_API_LIMIT } from '../config'
import { logger } from '../utils/logger'
import {
  ensureDir,
  readJsonOrEmpty,
} from '../utils'
import { mergeSubtitleFiles, SubtitleFile, SubtitleFiles } from '../utils/subtitle'
import { MapLimitController } from '../controllers/concurrency.controller'
import { generateSrt } from './edge-tts.service'
import type { Task } from '../utils/taskManager'
import type { Response } from 'express'

// 错误消息枚举
export enum ErrorMessages {
  ENG_MODEL_INVALID_TEXT = 'English model cannot process non-English text',
  API_FETCH_FAILED = 'Failed to fetch TTS parameters from API',
  INVALID_API_RESPONSE = 'Invalid API response: no TTS parameters returned',
  PARAMS_PARSE_FAILED = 'Failed to parse TTS parameters',
  INVALID_PARAMS_FORMAT = 'Invalid TTS parameters format',
  TTS_GENERATION_FAILED = 'TTS generation failed',
  INCOMPLETE_RESULT = 'Incomplete TTS result',
}

/**
 * 从 LLM 获取分段参数。
 *  - client 必须由调用方传入，避免模块加载时绑定 env（多用户隔离）
 *  - 历史上 tts.service.ts 用了模块级 openai 单例，是潜在的跨请求串 key 风险
 */
export async function fetchLLMSegment(prompt: string, client: any): Promise<any> {
  const response = await client.createChatCompletion({
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant. And you can return valid json object',
      },
      { role: 'user', content: prompt },
    ],
    // temperature: 0.7,
    // max_tokens: 500,
    response_format: { type: 'json_object' },
  })

  if (!response.choices[0].message.content) {
    throw new Error(ErrorMessages.INVALID_API_RESPONSE)
  }
  return parseLLMResponse(response)
}

/**
 * 校验语言与 voice 匹配。
 * - 同步版（service 层用）：不匹配时 throw，由外层 errorHandler 转 400
 * - 流式版（stream 层用）：需要把错误信息直接写到 res，所以走 validateLangAndVoiceForStream
 */
export function validateLangAndVoice(lang: string, voice: string): void {
  if (lang !== 'eng' && voice.startsWith('en')) {
    throw new Error(ErrorMessages.ENG_MODEL_INVALID_TEXT)
  }
}

export function validateLangAndVoiceForStream(
  lang: string,
  voice: string,
  res: Response
): boolean {
  try {
    validateLangAndVoice(lang, voice)
    return true
  } catch {
    res.status(400).json({
      code: 400,
      success: false,
      message: ErrorMessages.ENG_MODEL_INVALID_TEXT,
    })
    return false
  }
}

/**
 * 解析 LLM 响应
 */
export function parseLLMResponse(response: any): TTSParams {
  const params = JSON.parse(response.choices[0].message.content) as TTSParams
  if (!params || typeof params !== 'object') {
    throw new Error(ErrorMessages.INVALID_PARAMS_FORMAT)
  }
  return params
}

/**
 * 验证 TTS 结果
 */
export function validateTTSResult(result: TTSResult, segmentId: string): void {
  if (!result.audio) {
    throw new Error(`${ErrorMessages.INCOMPLETE_RESULT} for segment ${segmentId}`)
  }
}

/**
 * 并发执行任务
 */
export async function runConcurrentTasks(
  tasks: (() => Promise<any>)[],
  limit: number = EDGE_API_LIMIT
): Promise<any[]> {
  logger.debug(`Running ${tasks.length} tasks with a limit of ${limit}`)
  const controller = new MapLimitController(tasks, limit, () =>
    logger.info('All concurrent tasks completed')
  )
  const { results, cancelled } = await controller.run()
  logger.info(`Tasks completed: ${results.length}, cancelled: ${cancelled}`)
  logger.debug(`Task results:`, results)
  return results
}

/**
 * 把多个分段任务的最终结果合并为一个 mp3 + 一个 srt
 *  - 每个分段在自己的 tmpDir 下有 all_splits.mp3.json
 *  - 合并字幕 → 写合并 json → 生成 srt
 *  - 用 ffmpeg concat 拼 mp3（无损拼接）
 */
export const buildFinal = async (finalSegments: TTSResult[], id: string) => {
  const subtitleFiles: SubtitleFiles = await Promise.all(
    finalSegments.map((file) => {
      const base = path.basename(file.audio)
      const jsonPath = path.resolve(AUDIO_DIR, base.replace('.mp3', ''), 'all_splits.mp3.json')
      return readJsonOrEmpty<SubtitleFile>(jsonPath)
    })
  )

  const mergedJson = mergeSubtitleFiles(subtitleFiles)
  const finalDir = path.resolve(AUDIO_DIR, id.replace('.mp3', ''))
  await ensureDir(finalDir)
  const finalJson = path.resolve(finalDir, '[merged]all_splits.mp3.json')
  await fs.writeFile(finalJson, JSON.stringify(mergedJson, null, 2))
  await generateSrt(finalJson, path.resolve(AUDIO_DIR, id.replace('.mp3', '.srt')))
  const fileList = finalSegments.map((segment) =>
    path.resolve(AUDIO_DIR, path.parse(segment.audio).base)
  )
  const outputFile = path.resolve(AUDIO_DIR, id)
  await concatDirAudio({ inputDir: finalDir, fileList, outputFile })
  return {
    audio: `${audioUrl(id)}`,
    srt: `${audioUrl(id.replace('.mp3', '.srt'))}`,
  }
}

/**
 * 拼接音频文件
 */
export async function concatDirAudio({
  fileList,
  outputFile,
  inputDir,
}: ConcatAudioParams): Promise<void> {
  const mp3Files = sortAudioDir(fileList ?? [], '.mp3')
  if (!mp3Files.length) throw new Error('No MP3 files found in input directory')

  const tempListPath = path.resolve(inputDir, 'file_list.txt')
  await fs.writeFile(tempListPath, mp3Files.map((file) => `file '${file}'`).join('\n'))

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(tempListPath)
      .inputFormat('concat')
      .inputOption('-safe', '0')
      .audioCodec('copy')
      .output(outputFile)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Concat failed: ${err.message}`)))
      .run()
  })
}

/**
 * 拼接字幕文件
 *  - 优先用调用方提供的 jsonFiles
 *  - 否则从 fileList 推导出 .json 路径
 */
export async function concatDirSrt({
  fileList,
  outputFile,
  inputDir,
  jsonFiles,
}: ConcatAudioParams): Promise<void> {
  const files =
    jsonFiles ||
    sortAudioDir(
      (fileList ?? []).map((file) => `${file}.json`),
      '.json'
    )
  if (!files.length) throw new Error('No JSON files found for subtitles')

  const subtitleFiles: SubtitleFiles = await Promise.all(
    files.map((file) => readJsonOrEmpty<SubtitleFile>(file))
  )
  const mergedJson = mergeSubtitleFiles(subtitleFiles)
  const tempJsonPath = path.resolve(inputDir, 'all_splits.mp3.json')
  await fs.writeFile(tempJsonPath, JSON.stringify(mergedJson, null, 2))
  await generateSrt(tempJsonPath, outputFile.replace('.mp3', '.srt'))
}

/**
 * 按文件名开头的数字排序音频/字幕文件
 *  - "1_splits.mp3" / "2_splits.mp3" / "10_splits.mp3" -> [1, 2, 10]
 *  - 用 Number() 兜底，处理非数字前缀会返回 NaN（NaN 之间的比较保持稳定）
 */
export function sortAudioDir(fileList: string[], ext: string = '.mp3'): string[] {
  return fileList
    .filter((file) => path.extname(file).toLowerCase() === ext)
    .sort((a, b) => {
      const na = Number(path.parse(a).name.split('_')[0])
      const nb = Number(path.parse(b).name.split('_')[0])
      return na - nb
    })
}

export interface ConcatAudioParams {
  fileList?: string[]
  outputFile: string
  inputDir: string
  jsonFiles?: string[]
}
