import { Request, Response, NextFunction } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { ALLOWED_EXTENSIONS, AUDIO_DIR } from '../config'
import { verifyDownloadToken } from '../utils/fileToken'
import { logger } from '../utils/logger'

/**
 * 校验 token 并 stream 文件到客户端。
 * URL: GET /api/v1/tts/file/:token
 */
export async function fileDownloadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.params.token
    const file = verifyDownloadToken(token)
    if (!file) {
      res.status(403).json({ success: false, message: 'Invalid or expired token' })
      return
    }
    const ext = path.extname(file).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({ success: false, message: 'Invalid file type' })
      return
    }
    const filePath = path.join(AUDIO_DIR, file)
    // 二次保险：解析后确保仍在 AUDIO_DIR 内
    const resolved = path.resolve(filePath)
    const audioRoot = path.resolve(AUDIO_DIR) + path.sep
    if (!resolved.startsWith(audioRoot)) {
      res.status(400).json({ success: false, message: 'Invalid file path' })
      return
    }
    try {
      await fs.access(resolved, fs.constants.R_OK)
    } catch {
      res.status(404).json({ success: false, message: 'File not found' })
      return
    }
    res.setHeader('Content-Type', `audio/${ext.slice(1)}`)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.sendFile(resolved, (err) => {
      if (err) {
        logger.warn(`sendFile error for ${file}: ${err.message}`)
      } else {
        logger.info(`Downloaded file via token: ${file}`)
      }
    })
  } catch (err) {
    next(err)
  }
}
