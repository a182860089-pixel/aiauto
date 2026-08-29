import { createHash } from 'node:crypto'
import { mergeVisionResults } from './merge.js'
import { preprocessImage, smartSlice } from './smartSlicing.js'
import { mapWithConcurrency, ProgressTracker } from './rateLimiter.js'
import { JobStore } from './jobStore.js'
import type { JobRecord, ProgressEvent, VisionInfer, VisionResult } from './types.js'

export type CreateJobInput = {
  imageName: string
  dataUrl: string
  model: string
  infer: VisionInfer
  concurrency?: number
  onProgress?: (event: ProgressEvent) => void
  onCreated?: (job: JobRecord) => void
}

function cacheKey(imageHash: string, model: string) {
  return createHash('sha256').update(`${imageHash}\0${model}`).digest('hex')
}

function sliceCacheKey(blobHash: string, model: string) {
  return createHash('sha256').update(`slice\0${blobHash}\0${model}`).digest('hex')
}

/** 可恢复任务编排器：每个切片完成后立即写 checkpoint，进程重启时只重跑未完成切片。 */
export class OcrJobService {
  constructor(private readonly store: JobStore) {}

  async createAndRun(input: CreateJobInput) {
    const prepared = await preprocessImage(input.dataUrl)
    const key = cacheKey(prepared.sha256, input.model)
    const cached = await this.store.getCachedResult(key) as JobRecord['result'] | undefined
    const job = await this.store.create({ imageHash: prepared.sha256, imageName: input.imageName, model: input.model })
    input.onCreated?.(job)
    if (cached) {
      await this.store.transition(job.id, 'SLICING')
      await this.store.transition(job.id, 'INFERRING')
      await this.store.transition(job.id, 'MERGING')
      await this.store.update(job.id, (current) => { current.result = cached })
      await this.store.transition(job.id, 'COMPLETED')
      input.onProgress?.({ jobId: job.id, stage: 'COMPLETED', completed: 1, total: 1, percent: 100, elapsedMs: 0, etaMs: 0, message: '命中图片识别缓存', at: new Date().toISOString() })
      return this.store.get(job.id)
    }
    await this.run(job.id, prepared.dataUrl, input)
    return this.store.get(job.id)
  }

  async resume(id: string, input: Omit<CreateJobInput, 'imageName' | 'dataUrl'> & { dataUrl?: string }) {
    const job = await this.store.get(id)
    if (!job) throw new Error(`任务不存在：${id}`)
    if (job.stage === 'COMPLETED') return job
    if (!job.slices.length && !input.dataUrl) throw new Error('任务尚未完成切片，恢复时必须提供原图')
    await this.run(id, input.dataUrl || '', { ...input, imageName: job.imageName, dataUrl: input.dataUrl || '' })
    return this.store.get(id)
  }

  private async run(id: string, dataUrl: string, input: CreateJobInput) {
    const initial = await this.store.get(id)
    if (!initial) throw new Error(`任务不存在：${id}`)
    try {
      if (!initial.slices.length) {
        await this.store.transition(id, 'SLICING')
        const slices = await smartSlice(dataUrl)
        for (const slice of slices) await this.store.putDataUrl(slice.dataUrl)
        await this.store.update(id, (current) => { current.slices = slices.map(({ dataUrl: _dataUrl, ...ref }) => ref) })
      } else if (initial.stage === 'FAILED') {
        await this.store.transition(id, 'SLICING')
      }
      const current = await this.store.get(id)
      if (!current) throw new Error('任务状态读取失败')
      await this.store.transition(id, 'INFERRING')
      const tracker = new ProgressTracker(id, current.slices.length, (event) => input.onProgress?.(event))
      const completedResults: VisionResult[] = []
      const pending = [] as typeof current.slices
      for (const slice of current.slices) {
        const resultKey = sliceCacheKey(slice.blobHash, input.model)
        const cachedSlice = await this.store.getCachedResult(resultKey) as VisionResult | undefined
        if (cachedSlice) {
          completedResults.push(cachedSlice)
          await this.store.update(id, (record) => {
            const target = record.slices.find((candidate) => candidate.index === slice.index)
            if (target) { target.stage = 'COMPLETED'; target.resultCacheKey = resultKey; delete target.error }
          })
          tracker.update('INFERRING', `切片 ${slice.index + 1}/${current.slices.length} 已从 checkpoint 恢复`, slice.index)
          continue
        }
        pending.push(slice)
      }
      await mapWithConcurrency(pending, input.concurrency ?? 4, async (slice) => {
        const started = Date.now()
        await this.store.update(id, (record) => {
          const target = record.slices.find((candidate) => candidate.index === slice.index)
          if (target) { target.stage = 'PROCESSING'; target.attempts += 1 }
        })
        try {
          const blob = await this.store.readBlob(slice.blobHash)
          const result = await input.infer({ dataUrl: `data:image/jpeg;base64,${blob.toString('base64')}`, sliceIndex: slice.index, source: slice })
          const resultKey = sliceCacheKey(slice.blobHash, input.model)
          await this.store.putCachedResult(resultKey, result)
          completedResults.push(result)
          await this.store.update(id, (record) => {
            const target = record.slices.find((candidate) => candidate.index === slice.index)
            if (target) { target.stage = 'COMPLETED'; target.elapsedMs = Date.now() - started; target.resultCacheKey = resultKey; delete target.error }
          })
          tracker.update('INFERRING', `切片 ${slice.index + 1}/${current.slices.length} 已完成`, slice.index)
        } catch (error) {
          await this.store.update(id, (record) => {
            const target = record.slices.find((candidate) => candidate.index === slice.index)
            if (target) { target.stage = 'FAILED'; target.elapsedMs = Date.now() - started; target.error = error instanceof Error ? error.message : '识别失败' }
          })
          throw error
        }
      })
      if (completedResults.length !== current.slices.length) throw new Error('切片 checkpoint 不完整，请重试任务')
      await this.store.transition(id, 'MERGING')
      const merged = mergeVisionResults(completedResults)
      await this.store.update(id, (record) => { record.result = merged })
      const latest = await this.store.get(id)
      if (!latest) throw new Error('任务结果写入失败')
      await this.store.putCachedResult(cacheKey(latest.imageHash, latest.model), merged)
      await this.store.transition(id, 'COMPLETED')
    } catch (error) {
      const message = error instanceof Error ? error.message : '识别任务失败'
      const latest = await this.store.get(id)
      if (latest?.stage !== 'COMPLETED') await this.store.transition(id, 'FAILED', message)
      throw error
    }
  }
}
