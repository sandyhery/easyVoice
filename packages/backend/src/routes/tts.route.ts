import { Router } from 'express'
import {
  generateAudio,
  getVoiceList,
  createTask,
  getTask,
  getTaskStats,
} from '../controllers/tts.controller'
import { pickSchema } from '../controllers/pick.controller'
import { ttsPluginManager } from '../tts/pluginManager'
import { createTaskStream, generateJson, resumeTask, cancelTask } from '../controllers/stream.controller'
import { validateJson } from '../schema/generate'
import { voiceProfileRouter } from '../services/voiceProfile.service'
import { fileDownloadHandler } from '../middleware/fileDownload'

const router = Router()

router.get('/engines', async (req, res) => {
  const engines = await Promise.all(
    ttsPluginManager.getAllEngines().map(async (engine) => ({
      name: engine.name,
      languages: await engine.getSupportedLanguages(),
      voices: (await engine.getVoiceOptions?.()) || [],
    }))
  )
  res.json(engines)
})

// 列出已注册引擎 + 引擎详情（前端下拉用）
router.get('/engines/list', (req, res) => {
  const engines = ttsPluginManager.getAllEngines().map((engine) => ({
    name: engine.name,
  }))
  res.json({ code: 200, data: engines, success: true })
})

router.get('/voiceList', getVoiceList)
router.get('/task/stats', getTaskStats)
router.get('/task/:id', getTask)
// 文件下载：使用 HMAC 签名 token，避免 express.static 暴露整目录
router.get('/file/:token', fileDownloadHandler)

router.post('/create', pickSchema, createTask)
router.post('/createStream', pickSchema, createTaskStream)
router.post('/generate', pickSchema, generateAudio)
router.post('/generateJson', validateJson, generateJson)
router.post('/resume/:taskId', resumeTask)
router.post('/cancel/:taskId', cancelTask)

// 声音预设
router.use('/profile', voiceProfileRouter)

export default router
