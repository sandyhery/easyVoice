import crypto from 'crypto'
import { memoryUsage } from 'process'
import { Request, Response, NextFunction } from 'express'
import { formatFileSize } from '.'
import { logger } from './logger'
import { MAX_TASKS, TASK_IDLE_UNLOAD_MS } from '../config'

interface Options {
  prefix?: string
  length?: number
}
interface TaskManagerOptions {
  length?: number
  // idleUnloadMs: 任务完成后超过此毫秒数，从内存中卸载（用于长任务场景释放内存）
  idleUnloadMs?: number
}
export interface Task {
  id: string
  fields: any
  status: string
  progress: number
  message: string
  code?: string | number
  result: any
  createdAt: Date
  updatedAt?: Date
  finishedAt?: Date
  updateProgress?: (taskId: string, progress: number) => Task | undefined
  endTask?: (taskId: string) => void
  // 取消回调：让流式生成循环能优雅退出
  cancel?: () => void
  cancelled?: boolean
  context?: {
    req?: Request
    res?: Response
    body?: any
    result?: TTSResult
    segment?: Segment
    lang?: string
    voiceList?: VoiceConfig[]
  }
}
class TaskManager {
  tasks: Map<string, Task>
  MAX_TASKS: number
  idleUnloadMs: number
  idleUnloadTimer?: NodeJS.Timeout
  constructor(options?: TaskManagerOptions) {
    this.tasks = new Map()
    this.MAX_TASKS = options?.length || MAX_TASKS
    this.idleUnloadMs = options?.idleUnloadMs ?? TASK_IDLE_UNLOAD_MS
  }

  generateTaskId(fields: any, options: Options = {}) {
    const { prefix = 'task', length = 32 } = options
    const hash = crypto.createHash('md5')

    Object.keys(fields)
      .sort()
      .forEach((key) => {
        const value = fields[key]
        if (!value) return
        hash.update(key)
        if (typeof value === 'string' && value.length > 1000) {
          for (let i = 0; i < value.length; i += 1000) {
            hash.update(value.slice(i, i + 1000))
          }
        } else {
          hash.update(JSON.stringify(value))
        }
      })

    const hashValue = hash.digest('hex')
    return `${prefix}${hashValue.slice(0, length)}`
  }

  createTask(fields: any, options?: Options): Task {
    const taskId = this.generateTaskId(fields, options)
    if (this.isTaskPending(taskId)) {
      throw new Error(`task: ${taskId} already exists!`)
    }
    if (this.getPendingTasks()?.length >= this.MAX_TASKS) {
      throw new Error(`Cannot create more than ${this.MAX_TASKS} tasks!`)
    }
    const task = {
      id: taskId,
      fields,
      status: 'pending',
      progress: 0,
      message: '',
      result: null,
      createdAt: new Date(),
      updateProgress: this.updateProgress.bind(this),
      endTask: this.finishTask.bind(this),
    }
    this.tasks.set(taskId, task)
    return task
  }

  finishTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task) {
      // 已被 idle unload 清掉，视为完成
      logger.debug(`finishTask: task ${taskId} not in memory (already idle-unloaded)`)
      return null as any
    }
    // 已被 cancel 的任务不能再被 endTask 翻回 completed
    if (task.cancelled || task.status === 'cancelled') {
      logger.debug(`finishTask: task ${taskId} already cancelled, skip`)
      return task
    }
    if (task.status === 'completed' || task.status === 'failed') return task
    task.status = 'completed'
    task.progress = 100
    task.updatedAt = new Date()
    task.finishedAt = new Date()
    this.tasks.set(taskId, task)
    logger.info(`Task ${taskId} completed`)
    this.scheduleIdleUnload()
    return task
  }

  /**
   * 取消任务：
   * - 把状态置为 cancelled
   * - 调用 cancel 回调，让生成循环能跳出
   * - 不会删 checkpoint（用户可 resume）
   */
  cancelTask(taskId: string): Task | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    // 幂等：已取消的 task 不重复触发 cancel 回调
    if (task.cancelled || task.status === 'cancelled') return task
    // 终态任务不能取消
    if (task.status === 'completed' || task.status === 'failed') return task

    task.cancelled = true
    task.status = 'cancelled'
    task.message = 'cancelled by user'
    task.updatedAt = new Date()
    task.finishedAt = new Date()
    try {
      task.cancel?.()
    } catch (e) {
      logger.warn(`cancelTask: cancel callback threw for ${taskId}: ${(e as Error).message}`)
    }
    logger.info(`Task ${taskId} cancelled`)
    this.scheduleIdleUnload()
    return task
  }

  /**
   * idle unload：扫描 finished/failed/cancelled 任务，超过 idleUnloadMs 的从内存中删除
   * checkpoint 文件还在硬盘上，用户可恢复
   */
  private scheduleIdleUnload() {
    if (this.idleUnloadTimer) return
    this.idleUnloadTimer = setTimeout(() => {
      this.idleUnloadTimer = undefined
      const now = Date.now()
      let removed = 0
      for (const [id, task] of this.tasks) {
        const endTime = task.finishedAt || task.updatedAt || task.createdAt
        const idle = now - new Date(endTime).getTime()
        const isDone =
          task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled'
        if (isDone && idle >= this.idleUnloadMs) {
          this.tasks.delete(id)
          removed++
        }
      }
      if (removed) logger.info(`Idle-unloaded ${removed} finished tasks`)
    }, 30_000) // 每 30 秒扫一次
  }
  isTaskPending(taskId: string) {
    return this.getTask(taskId)?.status === 'pending' || false
  }
  getTask(taskId: string) {
    return this.tasks.get(taskId) || null
  }
  failTask(taskId: string, { code, message }: { code?: number; message: string }) {
    const findTask = this.getTask(taskId)
    if (!findTask) {
      throw new Error(`Cannot find task: ${taskId}`)
    }
    findTask.status = 'failed'
    findTask.message = message
    findTask.code = code
    findTask.updatedAt = new Date()
    findTask.finishedAt = new Date()
    this.tasks.set(taskId, findTask)
    this.scheduleIdleUnload()
    return true
  }
  updateProgress(taskId: string, progress: number): Task | undefined {
    const findTask = this.getTask(taskId)
    if (!findTask) return
    findTask.progress = progress
    findTask.updatedAt = new Date()
    this.tasks.set(taskId, findTask)
    return findTask
  }
  updateTask(
    taskId: string,
    {
      status = 'completed',
      progress = 100,
      result,
    }: { status?: string; progress?: number; result: any }
  ) {
    const findTask = this.getTask(taskId)
    if (!findTask) {
      throw new Error(`Cannot find task: ${taskId}`)
    }
    findTask.status = status
    findTask.updatedAt = new Date()
    findTask.progress = progress
    findTask.result = result
    this.tasks.set(taskId, findTask)
    return findTask
  }
  getTaskLength() {
    return this.tasks.size
  }
  getPendingTasks() {
    return Array.from(this.tasks.values()).filter((task) => task.status === 'pending')
  }
  getTaskStats() {
    const tasks = Array.from(this.tasks.values())
    const memory = {
      heapUsed: formatFileSize(memoryUsage().heapUsed),
      heapTotal: formatFileSize(memoryUsage().heapTotal),
      rss: formatFileSize(memoryUsage().rss),
    }
    const stats = {
      totalTasks: this.getTaskLength(),
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      pendingTasks: tasks.filter((task) => task.status === 'pending').length,
      memory,
    }
    return stats
  }
}
const instance = new TaskManager()
export default instance
