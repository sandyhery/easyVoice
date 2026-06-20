import { AxiosError } from 'axios'
import { MODEL_NAME, OPENAI_BASE_URL, OPENAI_API_KEY } from '../config'
import { logger } from './logger'
import { fetcher } from './request'

/**
 * OpenAI 客户端工厂
 *
 * 历史问题：早期版本把 client 写成单例（模块级 currentConfig 闭包），
 * 然后 `openai.config({...})` 会在多请求并发时互相覆盖，导致：
 *   - 跨用户串 key
 *   - 跨请求串 baseURL / model
 *
 * 改造：每次请求都 `createOpenAIClient({...})` 拿到独立实例，
 * controller / service 负责把 per-request 字段传进来。
 */

interface OpenAIConfig {
  baseURL: string
  model?: string
  timeout: number
  apiKey: string
}

export interface OpenAIClient {
  createChatCompletion(request: ChatCompletionRequest, customConfig?: Partial<OpenAIConfig>): Promise<ChatCompletionResponse>
  getModels(customConfig?: Partial<OpenAIConfig>): Promise<{ data: { id: string }[] }>
}

// 扩展 Express Request，挂 per-request openai 配置
declare global {
  namespace Express {
    interface Request {
      openaiOverrides?: Partial<OpenAIConfig>
    }
  }
}

export function createOpenAIClient(overrides: Partial<OpenAIConfig> = {}): OpenAIClient {
  const currentConfig: OpenAIConfig = {
    baseURL: OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: MODEL_NAME,
    timeout: 60_000,
    apiKey: OPENAI_API_KEY || '',
    ...overrides,
  }
  logger.debug(`init openai client:`, {
    baseURL: currentConfig.baseURL,
    model: currentConfig.model,
    apiKey: currentConfig.apiKey ? currentConfig.apiKey.slice(0, 10) + '***' : '(empty)',
  })

  const getHeaders = (apiKey: string) => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  })

  async function createChatCompletion(
    request: ChatCompletionRequest,
    customConfig?: Partial<OpenAIConfig>,
  ): Promise<ChatCompletionResponse> {
    const cfg = { ...currentConfig, ...(customConfig || {}) }
    if (!cfg.apiKey) {
      throw new Error('OpenAI API key not provided')
    }
    try {
      const response = await fetcher.post<ChatCompletionResponse>(
        `${cfg.baseURL}${cfg.baseURL?.endsWith('/') ? '' : '/'}chat/completions`,
        {
          model: request.model || cfg.model,
          temperature: request.temperature ?? 1.0,
          max_tokens: request.max_tokens,
          top_p: request.top_p ?? 1.0,
          stream: request.stream ?? false,
          ...request,
        },
        { headers: getHeaders(cfg.apiKey), timeout: cfg.timeout },
      )
      return response.data
    } catch (error) {
      if (error instanceof AxiosError) {
        logger.error(`createChatCompletion failed: ${error.response?.data?.error?.message || error.message}`)
      }
      throw new Error(
        `Chat completion request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function getModels(customConfig?: Partial<OpenAIConfig>) {
    const cfg = { ...currentConfig, ...(customConfig || {}) }
    if (!cfg.apiKey) {
      throw new Error('OpenAI API key not provided')
    }
    const response = await fetcher.get<{ data: { id: string }[] }>(
      `${cfg.baseURL}/models`,
      {},
      { headers: getHeaders(cfg.apiKey), timeout: cfg.timeout },
    )
    return response.data
  }

  return { createChatCompletion, getModels }
}

// 兼容旧调用方：导出一个 default client（用环境变量）。新代码请直接 createOpenAIClient({...})。
export const openai = createOpenAIClient()
