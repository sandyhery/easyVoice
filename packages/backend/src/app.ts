import express, { Application } from 'express'
import { logger } from './utils/logger'
import { createMiddlewareConfig } from './middleware/config'
import { configureStaticFiles } from './middleware/static'
import { setupRoutes } from './routes'
import { registerEngines } from './tts/engines'
import { ttsPluginManager } from './tts/pluginManager'
import { errorHandler } from './middleware/error.middleware'
import audioCacheInstance from './services/audioCache.service'

// 应用配置接口
interface AppConfig {
  isDev: boolean
  rateLimit: number
  rateLimitWindow: number
  audioDir: string
  publicDir: string
}

// 创建应用工厂函数
export function createApp(config: AppConfig): Application {
  const { isDev, rateLimit, rateLimitWindow, audioDir, publicDir } = config
  logger.debug('Initializing application...')

  const app = express()

  // 配置中间件
  const middleware = createMiddlewareConfig({
    isDev,
    rateLimit,
    rateLimitWindow,
  })

  // 应用中间件
  Object.values(middleware).forEach((mw) => app.use(mw))

  // 配置路由
  setupRoutes(app)

  // 配置静态文件服务
  configureStaticFiles(app, { audioDir, publicDir })

  registerEngines()
  app.use(errorHandler)

  // 启动后台清理：每小时清一次过期 audio cache（默认 TTL 365 天）
  const cleanTimer = setInterval(
    () => {
      audioCacheInstance
        .cleanExpired()
        .catch((err) => logger.warn('audio cache clean failed: ' + (err as Error).message))
    },
    60 * 60 * 1000
  )
  cleanTimer.unref?.()
  // 进程退出时清定时器
  app.on('close', () => clearInterval(cleanTimer))

  return app
}
