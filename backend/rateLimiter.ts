import type { ProgressEvent } from './types.js'

export class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfterMs?: number) {
    super(message)
    this.name = 'HttpStatusError'
  }
}

export type RetryPolicy = {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export async function sleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export function retryDelay(attempt: number, error: unknown, policy: Required<RetryPolicy>) {
  if (error instanceof HttpStatusError && error.retryAfterMs !== undefined) return Math.min(policy.maxDelayMs, error.retryAfterMs)
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)))
  return Math.round(exponential * (0.5 + Math.random()))
}

export class TokenBucket {
  private tokens: number
  private lastRefill = Date.now()

  constructor(private readonly capacity: number, private readonly refillPerSecond: number) {
    this.tokens = capacity
  }

  async consume(count = 1) {
    while (true) {
      this.refill()
      if (this.tokens >= count) {
        this.tokens -= count
        return
      }
      const missing = count - this.tokens
      await sleep(Math.ceil((missing / this.refillPerSecond) * 1000))
    }
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond)
    this.lastRefill = now
  }
}

type KeyState = { key: string; failures: number; inFlight: number; cooldownUntil: number; lastUsed: number }

/** 多 Key 调度：健康度加权选择，分数相同时保持轮转，避免单 Key 热点。 */
export class ApiKeyPool {
  private readonly states: KeyState[]
  private cursor = 0

  constructor(keys: string[]) {
    const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
    if (!unique.length) throw new Error('至少需要一个 SiliconFlow API Key')
    this.states = unique.map((key) => ({ key, failures: 0, inFlight: 0, cooldownUntil: 0, lastUsed: 0 }))
  }

  acquire() {
    const now = Date.now()
    const available = this.states.filter((state) => state.cooldownUntil <= now)
    const candidates = available.length ? available : this.states
    const ranked = candidates.map((state) => ({
      state,
      score: (1 / (1 + state.failures)) / (1 + state.inFlight) + (state.lastUsed ? 0 : 0.05),
    })).sort((left, right) => right.score - left.score)
    const selected = ranked.find(({ state }) => this.states.indexOf(state) >= this.cursor) || ranked[0]
    const state = selected.state
    this.cursor = (this.states.indexOf(state) + 1) % this.states.length
    state.inFlight += 1
    state.lastUsed = now
    return state.key
  }

  release(key: string, success: boolean, retryAfterMs?: number) {
    const state = this.states.find((candidate) => candidate.key === key)
    if (!state) return
    state.inFlight = Math.max(0, state.inFlight - 1)
    if (success) {
      state.failures = Math.max(0, state.failures - 1)
      state.cooldownUntil = 0
      return
    }
    state.failures = Math.min(8, state.failures + 1)
    const cooldown = retryAfterMs ?? Math.min(30_000, 500 * (2 ** state.failures))
    state.cooldownUntil = Date.now() + cooldown
  }

  snapshot() {
    return this.states.map(({ key, ...state }) => ({ keyHint: `${key.slice(0, 4)}…${key.slice(-4)}`, ...state }))
  }
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = Array<R>(items.length)
  let cursor = 0
  const run = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, run))
  return results
}

export class ProgressTracker {
  private readonly startedAt = Date.now()
  private readonly samples: number[] = []
  private completed = 0

  constructor(private readonly jobId: string, private readonly total: number, private readonly emit: (event: ProgressEvent) => void) {}

  update(stage: ProgressEvent['stage'], message: string, sliceIndex?: number) {
    this.completed = Math.min(this.total, this.completed + (sliceIndex === undefined ? 0 : 1))
    const elapsedMs = Date.now() - this.startedAt
    if (this.completed) this.samples.push(elapsedMs / this.completed)
    const average = this.samples.length ? this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length : 0
    this.emit({ jobId: this.jobId, stage, completed: this.completed, total: this.total, percent: this.total ? Math.round(this.completed / this.total * 100) : 100, elapsedMs, etaMs: average ? Math.max(0, Math.round(average * (this.total - this.completed))) : null, message, sliceIndex, at: new Date().toISOString() })
  }
}
