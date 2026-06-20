import { Application } from 'express'
import express from 'express'

interface StaticConfig {
  audioDir: string
  publicDir: string
}

/**
 * 静态文件服务
 *
 * 注意：audioDir 不再通过 `express.static` 暴露！
 * 改走 `/api/v1/tts/file/:token` 接口（HMAC 签名 token 鉴权），
 * 避免任意枚举/下载所有生成产物。
 */
export function configureStaticFiles(
  app: Application,
  { publicDir }: StaticConfig,
): void {
  app.use(express.static(publicDir))
}
