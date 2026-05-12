import path from 'path'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import taskManager from '../utils/taskManager'
import { EdgeSchema } from '../schema/generate'
import { generateTTSStream, generateTTSStreamJson } from '../services/tts.stream.service'
import { generateId, streamWithLimit, readJson, fileExist } from '../utils'
import { AUDIO_DIR, STATIC_DOMAIN } from '../config'
function formatBody({ text, pitch, voice, volume, rate, useLLM }: EdgeSchema) {
  const positivePercent = (value: string | undefined) => {
    if (value === '0%' || value === '0' || value === undefined || value === '') return '+0%'
    return value
  }
  const positiveHz = (value: string | undefined) => {
    if (value === '0Hz' || value === '0' || value === undefined || value === '') return '+0Hz'
    return value
  }
  return {
    text: text.trim(),
    pitch: positiveHz(pitch),
    voice: positivePercent(voice),
    rate: positivePercent(rate),
    volume: positivePercent(volume),
    useLLM,
  }
}
/**
 * @description 流式返回音频, 支持长文本
 * @param req
 * @param res
 * @param next
 * @returns ReadableStream
 */
export async function createTaskStream(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.query?.mock) {
      logger.info('Mocking audio stream...')
      streamWithLimit(res, path.join(__dirname, '../../mock/flying.mp3'), 1280) // Mock stream with limit
      return
    }
    logger.debug('Generating audio with body:', req.body)
    const formattedBody = formatBody(req.body)
    const task = taskManager.createTask(formattedBody)
    task.context = { req, res, body: req.body }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStream(formattedBody, task)
  } catch (error) {
    console.log(`createTaskStream error:`, error)
    next(error)
  }
}
export async function generateJson(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body?.data
    logger.debug('generateJson with body:', data)
    const formatedBody = data.map((item: any) => formatBody(item))
    const text = data.map((item: any) => item.text).join('')
    const taskParams = {
      ...formatedBody[0],
      text,
    }
    const task = taskManager.createTask(taskParams)
    const voice = formatedBody[0].voice

    const segment: Segment = { id: generateId(voice, text), text }
    task.context = { req, res, segment, body: req.body }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStreamJson(formatedBody, task)
  } catch (error) {
    console.log(`createTaskStream error:`, error)
    next(error)
  }
}

/**
 * 断点续传恢复任务
 */
export async function resumeTask(req: Request, res: Response, next: NextFunction) {
  try {
    const { taskId } = req.params
    const checkpointPath = path.resolve(AUDIO_DIR, `${taskId}_checkpoint.json`)

    if (!(await fileExist(checkpointPath))) {
      res.status(404).json({
        code: 404,
        success: false,
        message: 'No checkpoint found for this task',
      })
      return
    }

    const checkpoint = await readJson<any>(checkpointPath)
    const outputId = checkpoint.outputId

    // 检查是否有已完成的文件
    const files: string[] = []
    let fileIndex = 1
    while (true) {
      const filePath = path.resolve(AUDIO_DIR, `${outputId}_${fileIndex}.mp3`)
      if (await fileExist(filePath)) {
        files.push(`${STATIC_DOMAIN}/${outputId}_${fileIndex}.mp3`)
        fileIndex++
      } else {
        break
      }
    }

    const result = {
      taskId,
      outputId,
      checkpointIndex: checkpoint.currentIndex,
      totalSegments: checkpoint.totalSegments,
      progress: Number(((checkpoint.currentIndex / checkpoint.totalSegments) * 100).toFixed(2)),
      completedFiles: files,
      canResume: true,
    }

    logger.info(`Resume task: ${taskId}, progress: ${result.progress}%`)

    res.json({
      code: 200,
      data: result,
      success: true,
    })
  } catch (error) {
    console.log(`resumeTask error:`, error)
    next(error)
  }
}
