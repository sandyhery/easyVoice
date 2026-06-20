import { Request, Response, NextFunction } from 'express'
import { generateTTS } from '../services/tts.service'
import { createOpenAIClient } from '../utils/openai'
import { logger } from '../utils/logger'
import path from 'path'
import { EdgeSchema } from '../schema/generate'
import taskManager from '../utils/taskManager'
import { buildDownloadUrl } from '../utils/fileToken'
import { FILE_DOWNLOAD_PATH, FILE_DOWNLOAD_TTL_MS, STATIC_DOMAIN } from '../config'
import { positiveHz, positivePercent } from '../utils/format'

function formatBody({ text, pitch, voice, volume, rate, useLLM, engine }: EdgeSchema) {
  return {
    text: text.trim(),
    pitch: positiveHz(pitch),
    voice: positivePercent(voice),
    rate: positivePercent(rate),
    volume: positivePercent(volume),
    useLLM,
    engine: engine || 'edge-tts',
  }
}

/**
 * 把 service 层返回的 TTSResult 包装成可对外暴露的形态：
 *  - audio / srt 改为带 HMAC token 的下载 URL
 *  - 额外提供不带前缀的 file 字段供前端 <audio src> 拼接
 */
function withSignedUrls(result: TTSResult) {
  const audioFile = path.parse(result.audio).base
  const srtFile = path.parse(result.srt).base
  return {
    ...result,
    audio: buildDownloadUrl(STATIC_DOMAIN, FILE_DOWNLOAD_PATH, audioFile, FILE_DOWNLOAD_TTL_MS),
    srt: buildDownloadUrl(STATIC_DOMAIN, FILE_DOWNLOAD_PATH, srtFile, FILE_DOWNLOAD_TTL_MS),
    file: audioFile,
    srtFile,
  }
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    logger.debug('Generating audio with body:', req.body)
    const formattedBody = formatBody(req.body)
    const task = taskManager.createTask(formattedBody)
    logger.info(`Generated task ID: ${task.id}`)

    generateTTS(formattedBody, task, createOpenAIClient(req.openaiOverrides))
      .then((result) => {
        taskManager.updateTask(task.id, { result: withSignedUrls(result) })
        logger.info(`Updated task ID: ${task.id} with result`)
      })
      .catch((err) => {
        taskManager.failTask(task.id, { message: (err as Error).message })
      })
    res.json({ success: true, data: { ...task }, code: 200 })
  } catch (error) {
    next(error)
  }
}

export async function getTask(req: Request, res: Response, next: NextFunction) {
  const taskId = req.params.id
  try {
    const task = taskManager.getTask(taskId)
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found', code: 404 })
      return
    }
    res.json({ success: true, data: { ...task }, code: 200 })
  } catch (error) {
    next(error)
  }
}

export async function getTaskStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = taskManager.getTaskStats()
    logger.debug('stats:', stats)
    if (!stats) {
      res.status(404).json({ success: false, message: 'stats not found', code: 404 })
      return
    }
    res.json({ success: true, data: { ...stats }, code: 200 })
  } catch (error) {
    next(error)
  }
}

export async function generateAudio(req: Request, res: Response, next: NextFunction) {
  try {
    logger.debug('Generating audio with body:', req.body)
    const formattedBody = formatBody(req.body)
    const result = await generateTTS(formattedBody, undefined, createOpenAIClient(req.openaiOverrides))
    res.json({
      success: true,
      data: withSignedUrls(result),
      code: 200,
    })
  } catch (error) {
    next(error)
  }
}

export async function getVoiceList(req: Request, res: Response, next: NextFunction) {
  try {
    logger.debug('Fetching voice list...')
    const voices = require('../llm/prompt/voice.json')
    res.json({
      code: 200,
      data: voices,
      success: true,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(`getVoiceList Error: ${errorMessage}`)
    res.status(500).json({
      code: 500,
      message: errorMessage,
      success: false,
    })
  }
}
