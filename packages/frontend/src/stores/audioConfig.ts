import { defineStore } from 'pinia'
import { reactive } from 'vue'

export interface AudioConfig {
  volume: number
  rate: number
  pitch: number
  voiceMode: string
  inputText: string
  selectedLanguage: string
  selectedGender: string
  selectedVoice: string
  previewText: string
  openaiBaseUrl: string
  openaiKey: string
  openaiModel: string
  previewAudioUrl: string
  superLong?: boolean
  engine?: string
}

const defaultConfig: AudioConfig = {
  rate: 0,
  volume: 0,
  pitch: 0,
  voiceMode: 'preset',
  inputText: '',
  selectedLanguage: 'zh-CN',
  selectedGender: 'All',
  selectedVoice: 'zh-CN-YunxiNeural',
  previewText: '这是一段测试文本，用于试听语音效果。',
  openaiBaseUrl: '',
  openaiKey: '',
  openaiModel: '',
  previewAudioUrl: '',
  superLong: false,
  engine: 'edge-tts',
}

// 仅持久化非敏感字段，避免 OpenAI key 落到 localStorage
const PERSIST_KEYS: Array<keyof AudioConfig> = [
  'volume',
  'rate',
  'pitch',
  'voiceMode',
  'selectedLanguage',
  'selectedGender',
  'selectedVoice',
  'previewText',
  'superLong',
  'engine',
]
// 这些字段仅放在 sessionStorage（关闭浏览器即失效）
const SESSION_KEYS: Array<keyof AudioConfig> = [
  'openaiBaseUrl',
  'openaiKey',
  'openaiModel',
  'previewAudioUrl',
]

function loadFromStorage(): Partial<AudioConfig> {
  if (typeof window === 'undefined') return {}
  const result: Partial<AudioConfig> = {}
  try {
    const persist = window.localStorage.getItem('easyvoice:audioConfig')
    if (persist) {
      const parsed = JSON.parse(persist)
      for (const k of PERSIST_KEYS) {
        if (k in parsed) (result as any)[k] = parsed[k]
      }
    }
    const session = window.sessionStorage.getItem('easyvoice:audioConfig:session')
    if (session) {
      const parsed = JSON.parse(session)
      for (const k of SESSION_KEYS) {
        if (k in parsed) (result as any)[k] = parsed[k]
      }
    }
  } catch (e) {
    console.warn('Failed to load audioConfig from storage:', e)
  }
  return result
}

// 节流：slider 拖动时会高频调用 updateConfig，存盘做 IO 阻塞没意义
// 300ms 已经远低于人眼可感知的延迟，又能把每秒 60 次的写盘压到 3 次
let persistTimer: ReturnType<typeof setTimeout> | null = null
let sessionTimer: ReturnType<typeof setTimeout> | null = null

function flushPersist(state: AudioConfig) {
  if (typeof window === 'undefined') return
  try {
    const payload: Partial<AudioConfig> = {}
    for (const k of PERSIST_KEYS) (payload as any)[k] = state[k]
    window.localStorage.setItem('easyvoice:audioConfig', JSON.stringify(payload))
  } catch (e) {
    console.warn('Failed to persist audioConfig:', e)
  }
}

function flushSession(state: AudioConfig) {
  if (typeof window === 'undefined') return
  try {
    const payload: Partial<AudioConfig> = {}
    for (const k of SESSION_KEYS) (payload as any)[k] = state[k]
    window.sessionStorage.setItem('easyvoice:audioConfig:session', JSON.stringify(payload))
  } catch (e) {
    console.warn('Failed to persist session config:', e)
  }
}

function savePersist(state: AudioConfig) {
  if (typeof window === 'undefined') return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => flushPersist(state), 300)
}

function saveSession(state: AudioConfig) {
  if (typeof window === 'undefined') return
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => flushSession(state), 300)
}

export const useAudioConfigStore = defineStore('audioConfig', () => {
  const initial = { ...defaultConfig, ...loadFromStorage() }
  const audioConfig = reactive<AudioConfig>(initial as AudioConfig)

  function updateConfig<K extends keyof AudioConfig>(prop: K, value: AudioConfig[K]) {
    if (Object.prototype.hasOwnProperty.call(audioConfig, prop)) {
      audioConfig[prop] = value
      savePersist(audioConfig)
      saveSession(audioConfig)
    } else {
      console.warn(`Property "${prop}" does not exist in audioConfig`)
    }
  }

  function reset() {
    Object.assign(audioConfig, { ...defaultConfig })
    savePersist(audioConfig)
    saveSession(audioConfig)
  }

  return { audioConfig, updateConfig, reset }
})
