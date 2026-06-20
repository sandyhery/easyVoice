import path, { resolve } from 'path'
import fs, { readdir } from 'fs/promises'
import { AUDIO_DIR, audioUrl, EDGE_API_LIMIT, MAX_AUDIO_FILE_SIZE } from '../config'
import { logger } from '../utils/logger'
import { getPrompt } from '../llm/prompt/generateSegment'
import {
  asyncSleep,
  ensureDir,
  generateId,
  getLangConfig,
  readJson,
  readJsonOrEmpty,
  streamToResponse,
  fileExist,
  waitForSrtSource,
} from '../utils'
import { openai, type OpenAIClient } from '../utils/openai'
import { splitText, detectChapters } from './text.service'
import { normalizeForTTS } from './normalize.service'
import { generateSingleVoiceStream, generateSrt } from './edge-tts.service'
import { EdgeSchema } from '../schema/generate'
import audioCacheInstance from './audioCache.service'
import { mergeSubtitleFiles, SubtitleFile, SubtitleFiles } from '../utils/subtitle'
import taskManager, { Task } from '../utils/taskManager'
import { Readable, PassThrough } from 'stream'
import { createWriteStream } from 'fs'
import {
  concatDirAudio,
  concatDirSrt,
  ErrorMessages,
  fetchLLMSegment,
  parseLLMResponse,
  runConcurrentTasks,
  sortAudioDir,
  validateLangAndVoiceForStream as validateLangAndVoice,
  validateTTSResult,
  type ConcatAudioParams,
} from './tts.shared'
// 复用错误枚举（向后兼容外部 import 路径）
export { ErrorMessages } from './tts.shared'
export type { ConcatAudioParams } from './tts.shared'


/**
 * 流式生成文本转语音 (TTS) 的音频和字幕
 */
export async function generateTTSStream(params: Required<EdgeSchema>, task: Task, openaiClient?: OpenAIClient) {
  const { pitch, voice, rate, volume, useLLM } = params
  const text = normalizeForTTS((params.text || '').trim())
  // 章节检测（流式也用）
  const _detected = detectChapters(text)
  const _firstChapter = _detected[0]
  const segment: Segment = { id: generateId(useLLM ? 'aigen-' : voice, text, _firstChapter?.index), text }
  const { lang, voiceList } = await getLangConfig(segment.text)
  logger.debug(`Language detected lang: `, lang)
  task!.context!.segment = segment
  task!.context!.lang = lang
  task!.context!.voiceList = voiceList
  const { res } = task.context as Required<NonNullable<Task['context']>>
  if (!validateLangAndVoice(lang, voice, res)) {
    task?.endTask?.(task.id)
    return
  }

  // 检查缓存, 如果有缓存则直接返回
  const cacheKey = taskManager.generateTaskId({ text, pitch, voice, rate, volume })
  const cache = await audioCacheInstance.getAudio(cacheKey)
  if (cache) {
    const data = {
      ...cache,
      file: path.parse(cache.audio).base,
      srt: path.parse(cache.srt).base,
      text: '',
    }
    logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`)
    task.context?.res?.setHeader('x-generate-tts-type', 'application/json')
    task.context?.res?.setHeader('Access-Control-Expose-Headers', 'x-generate-tts-type')
    task.context?.res?.json({ code: 200, data, success: true })
    task.endTask?.(task.id)
    return
  }

  if (useLLM) {
    generateWithLLMStream(task, openaiClient)
  } else {
    generateWithoutLLMStream({ ...params, output: segment.id }, task)
  }
}
export async function generateTTSStreamJson(formatedBody: Required<EdgeSchema>[], task: Task) {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const output = path.resolve(AUDIO_DIR, segment.id)
  const segments = formatedBody
  logger.info(`generateTTSStreamJson splitText length: ${formatedBody.length} `)
  const buildSegments = segments.map((segment) => ({ ...segment, output }))
  logger.info('buildSegments:', buildSegments)
  buildSegmentList(buildSegments, task)
}

/**
 * 使用 LLM 生成 TTS
 */
async function generateWithLLMStream(task: Task, openaiClient?: OpenAIClient) {
  const { segment, voiceList, lang, res } = task.context as Required<NonNullable<Task['context']>>
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
    logger.debug(`Prompt for LLM: ${prompt}`)
    const llmResponse = await fetchLLMSegment(prompt, openaiClient ?? openai)
    let llmSegments = llmResponse?.result || llmResponse?.segments || []
    if (!Array.isArray(llmSegments)) {
      throw new Error(
        'LLM response is not an array, please switch to Edge TTS mode or use another model'
      )
    }
    buildSegmentList(formatLlmSegments(llmSegments), task)
  } else {
    const output = resolve(AUDIO_DIR, id)
    let count = 0
    logger.info('Splitting text into multiple segments:', segments.length)
    const getProgress = () => {
      return Number(((count / segments.length) * 100).toFixed(2))
    }
    const localStream = createWriteStream(output)
    const outputStream = new PassThrough()
    outputStream.pipe(res)
    outputStream.pipe(localStream)

    for (let seg of segments) {
      // 协作式取消
      if (task.cancelled) {
        logger.info(`LLM loop cancelled at ${count}/${segments.length}`)
        break
      }
      count++
      const prompt = getPrompt(lang, voiceList, seg)
      logger.debug(`Prompt for LLM: ${prompt}`)
      const llmResponse = await fetchLLMSegment(prompt, openaiClient ?? openai)
      let llmSegments = llmResponse?.result || llmResponse?.segments || []
      if (!Array.isArray(llmSegments)) {
        throw new Error(
          'LLM response is not an array, please switch to Edge TTS mode or use another model'
        )
      }
      for (let segment of formatLlmSegments(llmSegments)) {
        if (task.cancelled) {
          logger.info(`LLM inner loop cancelled`)
          break
        }
        const stream = (await generateSingleVoiceStream({
          ...segment,
          output,
          outputType: 'stream',
        })) as Readable
        stream.pipe(outputStream, { end: false })
        await new Promise((resolve) => {
          stream.on('end', resolve)
          // 如果 task 取消，强制结束 stream 的等待
          if (task.cancelled) {
            stream.destroy?.()
            resolve(undefined)
          }
        })
      }
      logger.info(`Progress: ${getProgress()}%`)
    }
    if (task.cancelled) {
      logger.info(`LLM stream ended (cancelled) at ${count}/${segments.length}`)
      outputStream.end()
      try { res.end() } catch {}
      return
    }
    outputStream.end()
    try {
      await waitForSrtSource(output)
      await handleSrt(output)
    } catch (err) {
      logger.warn(`handleSrt failed for ${output}: ${(err as Error).message}`)
    }
  }
}
async function generateWithoutLLMStream(params: TTSParams, task: Task) {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const { text } = segment
  const { length, segments } = splitText(text, undefined, { normalize: false })
  logger.info(`splitText length: ${length} `)
  if (length <= 1) {
    buildSegment(params, task)
  } else {
    const buildSegments = segments.map((segment) => ({ ...params, text: segment }))
    buildSegmentList(buildSegments, task)
  }
}

/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(params: TTSParams, task: Task, dir: string = '') {
  const { segment } = task.context as Required<NonNullable<Task['context']>>
  const output = path.resolve(AUDIO_DIR, dir, segment.id)
  const stream = (await generateSingleVoiceStream({
    ...params,
    output,
    outputType: 'stream',
  })) as Readable
  const { res } = task.context as Required<NonNullable<Task['context']>>

  streamToResponse(res, stream, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-generate-tts-type': 'stream',
      'x-generate-tts-id': task.id,
      'Access-Control-Expose-Headers': 'x-generate-tts-type, x-generate-tts-id',
    },
    fileName: segment.id,
    onError: (err) => `Custom error: ${err.message}`,
    onEnd: () => {
      // 已被用户取消则不要再 endTask 把状态翻回 completed
      if (task.cancelled) {
        logger.info(`Streaming ${task.id} ended (cancelled)`)
        return
      }
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} finished`)
      waitForSrtSource(output)
        .then(() => handleSrt(output))
        .catch((err) => logger.warn(`handleSrt failed: ${(err as Error).message}`))
    },
  })
}

/**
 * 生成多个片段并合并的 TTS
 */

interface SegmentError extends Error {
  segmentIndex: number
  attempt: number
}
export async function handleSrt(audioPath: string, stream = true) {
  if (!stream) {
    const tempJsonPath = audioPath + '.json'
    await generateSrt(tempJsonPath, audioPath.replace('.mp3', '.srt'))
    return
  }
  const { dir, base } = path.parse(audioPath)
  const tmpDir = audioPath + '_tmp'
  await ensureDir(tmpDir)

  const fileList = (await readdir(tmpDir))
    .filter((file) => file.includes(base) && file.includes('.json'))
    .sort((a, b) => Number(a.split('.json.')?.[1] || 0) - Number(b.split('.json.')?.[1] || 0))
    .map((file) => path.join(tmpDir, file))
  if (!fileList.length) return
  concatDirSrt({ jsonFiles: fileList, inputDir: tmpDir, outputFile: audioPath })
}
/**
 * 断点续传检查点接口
 */
interface Checkpoint {
  taskId: string
  outputId: string
  currentIndex: number
  totalSegments: number
  completedFiles: string[]
  lastUpdate: string
}

// 保存检查点
async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  const checkpointPath = path.resolve(AUDIO_DIR, `${checkpoint.outputId}_checkpoint.json`)
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2))
  logger.info(`Checkpoint saved: ${checkpointPath}`)
}

// 加载检查点
async function loadCheckpoint(outputId: string): Promise<Checkpoint | null> {
  const checkpointPath = path.resolve(AUDIO_DIR, `${outputId}_checkpoint.json`)
  if (await fileExist(checkpointPath)) {
    const data = await readJson<Checkpoint>(checkpointPath)
    logger.info(`Checkpoint loaded: ${data.currentIndex}/${data.totalSegments}`)
    return data
  }
  return null
}

// 删除检查点
async function deleteCheckpoint(outputId: string): Promise<void> {
  const checkpointPath = path.resolve(AUDIO_DIR, `${outputId}_checkpoint.json`)
  try {
    await fs.unlink(checkpointPath)
  } catch { /* ignore */ }
}

async function buildSegmentList(segments: BuildSegment[], task: Task): Promise<void> {
  const { res, segment } = task.context as Required<NonNullable<Task['context']>>
  const { id: outputId } = segment
  const totalSegments = segments.length
  const output = path.resolve(AUDIO_DIR, outputId)
  let completedSegments = 0
  if (!totalSegments) {
    task?.endTask?.(task.id)
    return void res.status(400).end('No segments provided')
  }

  const MAX_FILE_SIZE = MAX_AUDIO_FILE_SIZE
  const progress = () => Number(((completedSegments / totalSegments) * 100).toFixed(2))

  // 检查断点续传
  const checkpoint = await loadCheckpoint(outputId)
  let startIndex = 0
  const files: string[] = checkpoint?.completedFiles || []
  let currentFileIndex = files.length || 0

  if (checkpoint && checkpoint.currentIndex > 0) {
    logger.info(`Resuming from checkpoint: segment ${checkpoint.currentIndex + 1}/${totalSegments}`)
    startIndex = checkpoint.currentIndex + 1
    completedSegments = checkpoint.currentIndex
  }

  // 文件分片：每个文件最大 500MB
  let currentFileSize = 0
  let currentOutputStream: PassThrough | null = null
  let currentWriteStream: ReturnType<typeof createWriteStream> | null = null

  // 如果有正在进行的文件，获取其大小
  if (currentFileIndex > 0) {
    const currentFilePath = path.resolve(AUDIO_DIR, `${outputId}_${currentFileIndex}.mp3`)
    if (await fileExist(currentFilePath)) {
      const stats = await fs.stat(currentFilePath)
      currentFileSize = stats.size
      logger.info(`Resuming file ${currentFileIndex}, current size: ${(currentFileSize / 1024 / 1024).toFixed(2)}MB`)
    }
  }

  const startNewFile = async () => {
    if (currentWriteStream) {
      currentWriteStream.end()
    }
    files.push(`${outputId}_${currentFileIndex + 1}.mp3`)
    currentFileIndex++
    currentFileSize = 0

    const newFilePath = path.resolve(AUDIO_DIR, `${outputId}_${currentFileIndex}.mp3`)
    currentOutputStream = new PassThrough()
    currentWriteStream = createWriteStream(newFilePath)
    currentOutputStream.pipe(currentWriteStream)
    logger.info(`Started new file ${currentFileIndex}: ${newFilePath}`)
  }

  // 如果有已完成文件，恢复文件流
  if (currentFileIndex > 0) {
    await startNewFile()
  } else {
    await startNewFile()
  }

  streamToResponse(res, currentOutputStream!, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-generate-tts-type': 'stream',
      'x-generate-tts-id': task.id,
      'Access-Control-Expose-Headers': 'x-generate-tts-type, x-generate-tts-id',
    },
    onError: (err) => `Custom error: ${err.message}`,
    fileName: segment.id,
    onEnd: () => {
      // 取消时不要 endTask（endTask 会把状态翻回 completed，破坏状态机）
      if (task.cancelled) {
        logger.info(`Streaming ${task.id} ended (cancelled)`)
        return
      }
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} finished`)
      deleteCheckpoint(outputId)
    },
    onClose: () => {
      task?.endTask?.(task.id)
      logger.info(`Streaming ${task.id} closed`)
    },
  })

  const saveCurrentCheckpoint = async () => {
    await saveCheckpoint({
      taskId: task.id,
      outputId,
      currentIndex: completedSegments,
      totalSegments,
      completedFiles: files,
      lastUpdate: new Date().toISOString(),
    })
  }

  const processSegment = async (index: number, maxRetries = 3): Promise<void> => {
    // 协作式取消：让长循环能跳出
    if (task.cancelled) {
      logger.info(`Task ${task.id} cancelled, stopping at segment ${index}`)
      currentOutputStream?.end()
      return
    }
    if (index >= totalSegments) {
      currentOutputStream?.end()
      task?.endTask?.(task.id)
      const audioUrls = files.map((_, i) => `${audioUrl(`${outputId}_${i + 1}.mp3`)}`)
      logger.info(`Generated ${files.length} files: ${audioUrls.join(', ')}`)
      deleteCheckpoint(outputId)
      return
    }

    const seg = segments[index]
    const segFilePath = path.resolve(AUDIO_DIR, `${outputId}_${currentFileIndex}_seg_${index}.mp3`)

    // 检查是否已存在该段落（断点续传）
    const segExists = await fileExist(segFilePath)
    if (segExists) {
      logger.info(`Segment ${index + 1} already exists, skipping`)
      completedSegments++
      await saveCurrentCheckpoint()
      await processSegment(index + 1)
      return
    }

    const generateWithRetry = async (attempt = 0): Promise<Readable> => {
      try {
        return (await generateSingleVoiceStream({
          ...seg,
          outputType: 'stream',
          output: path.resolve(AUDIO_DIR, `${outputId}_${currentFileIndex}`),
        })) as Readable
      } catch (err) {
        const error = err as Error
        if (attempt + 1 >= maxRetries) {
          throw Object.assign(error, { segmentIndex: index, attempt: attempt + 1 } as SegmentError)
        }
        logger.warn(
          `Segment ${index + 1} failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}`
        )
        await asyncSleep(1000)
        return generateWithRetry(attempt + 1)
      }
    }

    try {
      const audioStream = await generateWithRetry()
      // 启动 pipe 前再检查一次（流启动可能赶上 cancel）
      if (task.cancelled) {
        logger.info(`Task ${task.id} cancelled before pipe segment ${index + 1}`)
        audioStream.destroy?.()
        currentOutputStream?.end()
        return
      }
      audioStream.pipe(currentOutputStream!, { end: false })
      await new Promise((resolve) => audioStream.on('end', resolve))

      // 获取实际文件大小
      const currentFilePath = path.resolve(AUDIO_DIR, `${outputId}_${currentFileIndex}.mp3`)
      const stats = await fs.stat(currentFilePath)
      currentFileSize = stats.size

      if (currentFileSize >= MAX_FILE_SIZE && index < totalSegments - 1) {
        logger.info(`File ${currentFileIndex} reached size limit (${(currentFileSize / 1024 / 1024).toFixed(2)}MB), starting new file`)
        await startNewFile()
      }

      completedSegments++
      logger.info(`processing text:\n ${seg.text.slice(0, 10)}...`)
      logger.info(`Segment ${index + 1}/${totalSegments} completed. Progress: ${progress()}%`)

      // 每完成一个段落保存检查点
      await saveCurrentCheckpoint()

      await processSegment(index + 1)
    } catch (err) {
      const { segmentIndex, attempt, message } = err as SegmentError
      logger.error(`Segment ${segmentIndex + 1} failed after ${attempt} retries: ${message}`)
      currentOutputStream?.emit('error', err)
    }
  }

  try {
    await processSegment(startIndex)
  } catch (err) {
    logger.error(`Audio processing aborted: ${(err as Error).message}`)
    // 保存检查点以便恢复
    await saveCurrentCheckpoint()
    !res.headersSent && res.status(500).end('Internal server error')
  }
}
