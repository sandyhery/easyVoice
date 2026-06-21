import axios from 'axios'

const DEV_URL = 'http://localhost:3000/api/v1/tts'
const PROD_URL = import.meta.env.VITE_API_URL || '/api/v1/tts'
const baseURL = import.meta.env.MODE === 'development' ? DEV_URL : PROD_URL

const api = axios.create({
  baseURL: baseURL,
  timeout: 60000,
})

export interface GenerateRequest {
  text: string
  voice?: string
  rate?: string
  pitch?: string
  useLLM?: boolean
  engine?: string
  openaiBaseUrl?: string
  openaiKey?: string
  openaiModel?: string
}
export interface TaskRequest {
  id: string
}
export interface TaskResponse {
  success: string
  url: string
  progress: number
  message?: string
}

export interface ResponseWrapper<T> {
  success: boolean
  data?: T
  code: number
  message?: string
}
export interface GenerateResponse {
  audio: string
  file: string
  srt?: string
  size?: number
  id: string
}
export type Voice = {
  Name: string
  cnName?: string
  Gender: string
  ContentCategories: string[]
  VoicePersonalities: string[]
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
  updateProgress?: (taskId: string, progress: number) => Task | undefined
}
export const getVoiceList = async () => {
  const response = await api.get<ResponseWrapper<Voice[]>>('/voiceList')
  if (response.data?.code !== 200 || !response.data?.success) {
    throw new Error(response.data?.message || '生成语音失败')
  }
  return response.data
}

export const generateTTS = async (data: GenerateRequest) => {
  const response = await api.post<ResponseWrapper<GenerateResponse>>('/generate', data)
  if (response.data?.code !== 200 || !response.data?.success) {
    throw new Error(response.data?.message || '生成语音失败')
  }
  return response.data
}
export const getTask = async (data: TaskRequest) => {
  const response = await api.get<ResponseWrapper<Task>>(`/task/${data.id}`)
  if (response.data?.code !== 200 || !response.data?.success) {
    throw new Error(response.data?.message || '获取任务')
  }
  return response.data
}
export const createTask = async (data: TaskRequest) => {
  const response = await api.post<ResponseWrapper<Task>>(`/create`, data)
  if (response.data?.code !== 200 || !response.data?.success) {
    throw new Error(response.data?.message || '获取任务')
  }
  return response.data
}

export const createTaskStream = async (
  data: TaskRequest
): Promise<{ stream: ReadableStream | null; json?: ResponseWrapper<GenerateResponse>; taskId: string }> => {
  const response = await api.post<ReadableStream | ResponseWrapper<GenerateResponse>>(
    `/createStream`,
    data,
    {
      responseType: 'stream',
      adapter: 'fetch',
      timeout: 0,
    }
  )
  const ttsType = response.headers['x-generate-tts-type']
  const contentType = response.headers['content-type']
  // 后端在流式响应头里挂 task.id，前端通过 x-generate-tts-id 读取
  // （同时通过 Access-Control-Expose-Headers 暴露给浏览器）
  const taskId =
    response.headers['x-generate-tts-id'] ||
    response.headers['access-control-expose-headers-generate-tts-id'] ||
    ''
  if (response.status !== 200 || ttsType === 'application/json' || contentType?.includes?.('application/json')) {
    const text = await new Response(response.data as any).text()
    const json = JSON.parse(text)
    return { stream: null, json, taskId }
  }
  return { stream: response.data as ReadableStream, taskId }
}

export const downloadFile = (file: string) => `${api.defaults.baseURL}/download/${file}`

/**
 * 把 Edge 风格的 "+10%" / "-3Hz" 字符串转成 number。
 *  - "+5%"  -> 5
 *  - "-3Hz" -> -3
 *  - "0%"   -> 0
 *  - ""     -> 0
 *  - 非法   -> 0
 */
export const parseSignedValue = (s?: string): number => {
  if (!s) return 0
  const n = parseInt(String(s).replace(/[^0-9+\-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

// ====== 新增：引擎列表 ======
export interface EngineInfo {
  name: string
  displayName?: string
  supported?: boolean
  description?: string
}
export const listEngines = async () => {
  const response = await api.get<ResponseWrapper<EngineInfo[]>>('/engines/list')
  if (response.data?.code !== 200 || !response.data?.success) {
    throw new Error(response.data?.message || '获取引擎失败')
  }
  return response.data
}

// ====== 新增：任务取消 ======
export const cancelTask = async (taskId: string) => {
  const response = await api.post<ResponseWrapper<{ id: string; status: string }>>(
    `/cancel/${taskId}`
  )
  return response.data
}

// ====== 新增：声音预设（Voice Profile） ======
export interface VoiceProfile {
  id: string
  name: string
  voice: string
  engine: string
  rate?: string
  pitch?: string
  volume?: string
  style?: string
  description?: string
  createdAt: string
  updatedAt: string
}
export const listProfiles = async () => {
  const response = await api.get<ResponseWrapper<VoiceProfile[]>>('/profile')
  return response.data
}
export const createProfile = async (
  data: Omit<VoiceProfile, 'id' | 'createdAt' | 'updatedAt'>
) => {
  const response = await api.post<ResponseWrapper<VoiceProfile>>('/profile', data)
  return response.data
}
export const updateProfile = async (id: string, data: Partial<VoiceProfile>) => {
  const response = await api.put<ResponseWrapper<VoiceProfile>>(`/profile/${id}`, data)
  return response.data
}
export const deleteProfile = async (id: string) => {
  const response = await api.delete<ResponseWrapper<null>>(`/profile/${id}`)
  return response.data
}
