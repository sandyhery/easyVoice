import cors from 'cors'
import helmet from 'helmet'
import { rateLimit as RateLimit } from 'express-rate-limit'
import express, { Request, Response, NextFunction } from 'express'
import { requestLoggerMiddleware } from './info.middleware'
import { CORS_ALLOW_ALL, CORS_ORIGINS, USE_HELMET, USE_LIMIT } from '../config'

interface MiddlewareConfig {
  isDev: boolean
  rateLimit: number
  rateLimitWindow: number
}

export function createMiddlewareConfig({ isDev, rateLimit, rateLimitWindow }: MiddlewareConfig) {
  const useLimiter = RateLimit({
    windowMs: rateLimitWindow * 60 * 1000,
    limit: isDev ? 1e6 : rateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  // Helmet：默认开启。CSP 允许 Google Analytics 与内联（同源）资源。
  // 注意：开发期如果关掉 CSP，会更宽松；线上要保留。
  const useHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Element Plus / Vite 注入需要
          'https://www.google-analytics.com',
          'https://www.googletagmanager.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://www.google-analytics.com'],
        connectSrc: ["'self'", 'https://www.google-analytics.com'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
  // CORS：
  //   - 配置了 CORS_ORIGINS 时只放行白名单
  //   - 没配时，dev 模式放行所有（Vite proxy 不需要 CORS），prod 也放行
  //     （因为前端通常同源部署；如跨域请显式配 CORS_ORIGINS）
  const useCors = CORS_ALLOW_ALL
    ? cors({ origin: true, credentials: true })
    : cors({ origin: CORS_ORIGINS, credentials: true })
  const pass = (_req: Request, _res: Response, next: NextFunction) => next()
  return {
    cors: useCors,
    json: express.json({ limit: '20mb' }),
    requestLogger: requestLoggerMiddleware,
    // 默认开启 helmet；保留 USE_HELMET=false 逃生口（开发/调试用）
    helmet: USE_HELMET === false ? pass : useHelmet,
    limiter: USE_LIMIT ? useLimiter : pass,
  }
}
