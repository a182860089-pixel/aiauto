import { buildOcrPrompt, parseVisionJson } from './json.js'
import { ApiKeyPool, HttpStatusError, retryDelay, sleep, type RetryPolicy, TokenBucket } from './rateLimiter.js'
import type { SliceRef, VisionResult } from './types.js'

const DEFAULT_POLICY: Required<RetryPolicy> = { maxAttempts: 5, baseDelayMs: 700, maxDelayMs: 30_000 }

function retryAfterMs(value: string | null) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export class SiliconFlowClient {
  private readonly keys: ApiKeyPool
  private readonly globalBucket: TokenBucket
  private readonly policy: Required<RetryPolicy>

  constructor(options: { apiKeys: string[]; requestsPerSecond?: number; burst?: number; retry?: RetryPolicy; endpoint?: string }) {
    this.keys = new ApiKeyPool(options.apiKeys)
    this.globalBucket = new TokenBucket(options.burst ?? Math.max(1, options.apiKeys.length), options.requestsPerSecond ?? Math.max(1, options.apiKeys.length))
    this.policy = { ...DEFAULT_POLICY, ...options.retry }
    this.endpoint = options.endpoint ?? 'https://api.siliconflow.cn/v1/chat/completions'
  }

  private readonly endpoint: string

  async infer(dataUrl: string, slice: Pick<SliceRef, 'index' | 'sourceYStart' | 'sourceYEnd' | 'headerYEnd' | 'rowStart' | 'rowEnd'>, model: string): Promise<VisionResult> {
    let lastError: unknown = new Error('OCR 请求失败')
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      await this.globalBucket.consume()
      const key = this.keys.acquire()
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 8192,
            messages: [{ role: 'user', content: [{ type: 'text', text: buildOcrPrompt(slice) }, { type: 'image_url', image_url: { url: dataUrl } }] }],
          }),
        })
        if (!response.ok) {
          const error = new HttpStatusError(response.status, `OCR 请求失败：${response.status}`, retryAfterMs(response.headers.get('retry-after')))
          lastError = error
          if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === this.policy.maxAttempts) throw error
          await sleep(retryDelay(attempt, error, this.policy))
          continue
        }
        const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
        const content = payload.choices?.[0]?.message?.content
        if (content === undefined) throw new Error('模型响应缺少 choices[0].message.content')
        const result = parseVisionJson(content, slice.index)
        this.keys.release(key, true)
        return result
      } catch (error) {
        this.keys.release(key, false, error instanceof HttpStatusError ? error.retryAfterMs : undefined)
        lastError = error
        const retryable = error instanceof HttpStatusError ? [408, 429, 500, 502, 503, 504].includes(error.status) : true
        if (!retryable || attempt === this.policy.maxAttempts) throw error
        await sleep(retryDelay(attempt, error, this.policy))
      }
    }
    throw lastError
  }

  keyHealth() {
    return this.keys.snapshot()
  }
}
