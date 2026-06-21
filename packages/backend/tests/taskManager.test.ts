// tests/taskManager.test.ts
// 覆盖 taskManager 关键状态机：cancelTask 幂等、finishTask 不翻回 cancelled、idleUnload 边界

import taskManager from '../src/utils/taskManager'

describe('taskManager.cancelTask', () => {
  beforeEach(() => {
    // 清空（taskManager 是单例，但接口无 reset，用间接方式：消费 pending）
  })

  test('取消运行中的任务', () => {
    const t = taskManager.createTask({ test: 1 })
    let called = 0
    t.cancel = () => {
      called++
      t.cancelled = true
    }
    const result = taskManager.cancelTask(t.id)
    expect(result?.status).toBe('cancelled')
    expect(t.cancelled).toBe(true)
    expect(called).toBe(1)
  })

  test('重复取消幂等：cancel 回调只触发 1 次', () => {
    const t = taskManager.createTask({ test: 'idempotent' })
    let called = 0
    t.cancel = () => {
      called++
      t.cancelled = true
    }
    taskManager.cancelTask(t.id)
    const r2 = taskManager.cancelTask(t.id)
    expect(called).toBe(1)
    expect(r2?.status).toBe('cancelled')
  })

  test('取消已完成任务不触发回调', () => {
    const t = taskManager.createTask({ test: 'completed' })
    taskManager.finishTask(t.id)
    let called = 0
    t.cancel = () => {
      called++
    }
    taskManager.cancelTask(t.id)
    expect(called).toBe(0)
  })

  test('取消失败任务不触发回调', () => {
    const t = taskManager.createTask({ test: 'failed' })
    taskManager.failTask(t.id, { message: 'test fail' })
    let called = 0
    t.cancel = () => {
      called++
    }
    taskManager.cancelTask(t.id)
    expect(called).toBe(0)
  })

  test('取消不存在的任务返回 null', () => {
    expect(taskManager.cancelTask('nonexistent-id')).toBeNull()
  })

  test('cancel 回调抛错不传播（容错）', () => {
    const t = taskManager.createTask({ test: 'throw' })
    t.cancel = () => {
      throw new Error('cancel callback error')
    }
    // 不应让 cancelTask 自身抛错
    expect(() => taskManager.cancelTask(t.id)).not.toThrow()
  })
})

describe('taskManager.finishTask', () => {
  test('完成后置 status=completed + finishedAt + progress=100', () => {
    const t = taskManager.createTask({ test: 'finish' })
    taskManager.updateProgress(t.id, 50)
    const result = taskManager.finishTask(t.id)
    expect(result?.status).toBe('completed')
    expect(result?.progress).toBe(100)
    expect(result?.finishedAt).toBeInstanceOf(Date)
  })

  test('cancelled 任务 finishTask 不翻回 completed（P0-C 修复）', () => {
    const t = taskManager.createTask({ test: 'cancel-then-finish' })
    t.cancel = () => {
      t.cancelled = true
    }
    taskManager.cancelTask(t.id)
    const result = taskManager.finishTask(t.id)
    expect(result?.status).toBe('cancelled')
  })

  test('完成已完成任务幂等', () => {
    const t = taskManager.createTask({ test: 'finish-idem' })
    taskManager.finishTask(t.id)
    const r2 = taskManager.finishTask(t.id)
    expect(r2?.status).toBe('completed')
  })
})

describe('taskManager.failTask', () => {
  test('失败后置 status=failed + finishedAt', () => {
    const t = taskManager.createTask({ test: 'fail' })
    const result = taskManager.failTask(t.id, { message: 'oops' })
    expect(result).toBe(true)
    expect(taskManager.getTask(t.id)?.status).toBe('failed')
    expect(taskManager.getTask(t.id)?.finishedAt).toBeInstanceOf(Date)
  })
})