interface Task {
  (): Promise<any>
}

export interface MapLimitControllerOptions {
  /**
   * 可选：每个 task 启动前/中检查是否已取消
   * 返回 true 时 controller 立即停止派发新 task，正在运行的 task 也会被 cancel
   */
  isCancelled?: () => boolean
}

export class MapLimitController {
  private cancelled: boolean = false
  private runningTasks: Set<Promise<any>> = new Set()
  private isCancelledCheck: () => boolean

  constructor(
    private tasks: Task[],
    private concurrency: number = 3,
    private callback: () => void = () => {},
    options: MapLimitControllerOptions = {}
  ) {
    this.isCancelledCheck = options.isCancelled || (() => this.cancelled)
  }

  cancel(): void {
    this.cancelled = true
  }

  run(): Promise<{ results: any[]; cancelled: boolean }> {
    if (!Array.isArray(this.tasks) || this.tasks.length === 0) {
      this.callback()
      return Promise.resolve({ results: [], cancelled: false })
    }
    if (this.concurrency < 1) {
      this.concurrency = 1
    }

    let running = 0
    let completed = 0
    let index = 0
    const results: any[] = []
    const originalLength = this.tasks.length

    return new Promise((resolve) => {
      const complete = () => {
        this.callback()
        resolve({ results, cancelled: this.cancelled })
      }

      const runNext = () => {
        while (!this.isCancelledCheck() && running < this.concurrency && index < this.tasks.length) {
          const currentIndex = index++
          running++

          const taskPromise = this.tasks[currentIndex]()
          this.runningTasks.add(taskPromise)

          taskPromise
            .then((result) => {
              if (!this.isCancelledCheck()) {
                results[currentIndex] = { success: true, value: result }
              }
            })
            .catch((error) => {
              if (!this.isCancelledCheck()) {
                results[currentIndex] = {
                  success: false,
                  index: currentIndex,
                  error: (error as Error).message,
                }
              }
            })
            .finally(() => {
              this.runningTasks.delete(taskPromise)
              running--
              completed++

              if (completed === originalLength) {
                complete()
              } else if (!this.isCancelledCheck()) {
                runNext()
              } else if (running === 0) {
                complete()
              }
            })
        }
      }

      runNext()
    })
  }
}
