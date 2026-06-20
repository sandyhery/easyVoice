import path from 'path'
import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import taskManager from '../utils/taskManager'
import { EdgeSchema } from '../schema/generate'
import { generateTTSStream, generateTTSStreamJson } from '../services/tts.stream.service'
import { generateId, streamWithLimit, readJson, fileExist } from '../utils'
import { createOpenAIClient } from '../utils/openai'
import { AUDIO_DIR, audioUrl } from '../config'
import { positiveHz, positivePercent, formatEdgeBody } from '../utils/format'



/**
 * @description 流式返回音频, 支持长文本
 */
export async function createTaskStream(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.query?.mock) {
      logger.info('Mocking audio stream...')
      streamWithLimit(res, path.join(__dirname, '../../mock/flying.mp3'), 1280)
      return
    }
    logger.debug('Generating audio with body:', req.body)
    const formattedBody = formatEdgeBody(req.body)
    const task = taskManager.createTask(formattedBody)
    task.context = { req, res, body: req.body }
    // 注册 cancel 回调：cancelTask 调用时会让流式循环跳出
    task.cancel = () => {
      task.cancelled = true
    }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStream(formattedBody, task, createOpenAIClient(req.openaiOverrides))
  } catch (error) {
    logger.error(`createTaskStream error: ${(error as Error).message}`)
    next(error)
  }
}

export async function generateJson(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body?.data
    logger.debug('generateJson with body:', data)
    const formatedBody = data.map((item: any) => formatEdgeBody(item))
    const text = data.map((item: any) => item.text).join('')
    const taskParams = {
      ...formatedBody[0],
      text,
    }
    const task = taskManager.createTask(taskParams)
    const voice = formatedBody[0].voice

    const segment: Segment = { id: generateId(voice, text), text }
    task.context = { req, res, segment, body: req.body }
    // 同样注册 cancel 回调
    task.cancel = () => {
      task.cancelled = true
    }
    logger.info(`Generated stream task ID: ${task.id}`)
    generateTTSStreamJson(formatedBody, task)
  } catch (error) {
    logger.error(`generateJson error: ${(error as Error).message}`)
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

    const files: string[] = []
    let fileIndex = 1
    while (true) {
      const fileName = `${outputId}_${fileIndex}.mp3`
      const filePath = path.resolve(AUDIO_DIR, fileName)
      if (await fileExist(filePath)) {
        files.push(audioUrl(fileName))
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
    res.json({ code: 200, data: result, success: true })
  } catch (error) {
    logger.error(`resumeTask error: ${(error as Error).message}`)
    next(error)
  }
}

/**
 * 取消正在运行的 TTS 任务
 * - 让流式生成循环跳出（checkpoint 保留，可 resume）
 */
export async function cancelTask(req: Request, res: Response, next: NextFunction) {
  try {
    const { taskId } = req.params
    const task = taskManager.cancelTask(taskId)
    if (!task) {
      res.status(404).json({ code: 404, message: 'task not found', success: false })
      return
    }
    // 关闭 task 关联的 HTTP 响应流（如果有）。用 targetRes 避免与外层 res 遮蔽。
    try {
      const targetRes = task.context?.res
      if (targetRes && !targetRes.writableEnded) {
        // setImmediate 延后到下一个 tick，确保流管道先收到 close 事件
        setImmediate(() => {
          try {
            targetRes.end()
          } catch (e) {
            logger.warn('cancelTask deferred end error', e)
          }
        })
      }
    } catch (e) {
      logger.warn('cancelTask close res error', e)
    }
    res.json({ code: 200, data: { id: taskId, status: task.status }, success: true })
  } catch (error) {
    next(error)
  }
}
