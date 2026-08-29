import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { JobStore } from './jobStore.js'
import { OcrJobService } from './jobService.js'
import { SiliconFlowClient } from './siliconFlowClient.js'
import type { JobRecord, ProgressEvent } from './types.js'

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 50 * 1024 * 1024) throw new Error('请求体超过 50 MB 限制')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

class EventHub {
  private readonly listeners = new Map<string, Set<ServerResponse>>()

  subscribe(jobId: string, response: ServerResponse) {
    const set = this.listeners.get(jobId) || new Set<ServerResponse>()
    set.add(response)
    this.listeners.set(jobId, set)
    response.on('close', () => { set.delete(response); if (!set.size) this.listeners.delete(jobId) })
  }

  publish(event: ProgressEvent) {
    for (const response of this.listeners.get(event.jobId) || []) response.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`)
  }
}

function getKeys(body?: Record<string, unknown>) {
  const requestKeys = typeof body?.apiKeys === 'string' ? body.apiKeys : ''
  const configured = process.env.SILICONFLOW_API_KEYS || ''
  return [...new Set(`${requestKeys},${configured}`.split(/[\s,;|]+/).map((value) => value.trim()).filter(Boolean))]
}

/** 独立 Node HTTP 服务：批量上传、查询任务、SSE 订阅进度；API Key 不写入任务存储。 */
export function createOcrHttpServer(options: { dataDir?: string; port?: number } = {}) {
  const store = new JobStore(options.dataDir)
  const service = new OcrJobService(store)
  const events = new EventHub()
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'POST' && url.pathname === '/jobs') {
        const body = await readJson(request)
        const images = Array.isArray(body.images) ? body.images as Array<Record<string, unknown>> : []
        if (!images.length || images.some((image) => typeof image.dataUrl !== 'string')) return sendJson(response, 400, { error: 'images 必须包含至少一张 Data URL 图片' })
        const keys = getKeys(body)
        if (!keys.length) return sendJson(response, 400, { error: '请配置 SILICONFLOW_API_KEYS 或提交 apiKeys' })
        const model = String(body.model || 'Qwen/Qwen3-VL-8B-Instruct')
        const client = new SiliconFlowClient({ apiKeys: keys })
        const concurrency = Math.min(8, Math.max(1, Number(body.concurrency) || keys.length))
        const accepted = images.map((image) => new Promise<JobRecord>((resolve, reject) => {
          void service.createAndRun({
            imageName: String(image.name || 'upload'), dataUrl: String(image.dataUrl), model,
            infer: ({ dataUrl, sliceIndex, source }) => client.infer(dataUrl, { ...source, index: sliceIndex }, model),
            concurrency, onProgress: (event) => events.publish(event), onCreated: resolve,
          }).catch(reject)
        }))
        const jobs = await Promise.all(accepted)
        return sendJson(response, 202, { jobs: jobs.map((job) => ({ id: job.id, stage: job.stage })) })
      }
      const resumeMatch = url.pathname.match(/^\/jobs\/([^/]+)\/resume$/)
      if (request.method === 'POST' && resumeMatch) {
        const body = await readJson(request)
        const id = decodeURIComponent(resumeMatch[1])
        const job = await store.get(id)
        if (!job) return sendJson(response, 404, { error: '任务不存在' })
        const keys = getKeys(body)
        if (!keys.length) return sendJson(response, 400, { error: '恢复任务时必须配置 API Key' })
        const client = new SiliconFlowClient({ apiKeys: keys })
        void service.resume(id, {
          model: job.model,
          dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : undefined,
          concurrency: Math.min(8, Math.max(1, Number(body.concurrency) || keys.length)),
          infer: ({ dataUrl, sliceIndex, source }) => client.infer(dataUrl, { ...source, index: sliceIndex }, job.model),
          onProgress: (event) => events.publish(event),
        }).catch((error) => console.error(`[ocr-job] resume ${id} failed: ${error instanceof Error ? error.message : String(error)}`))
        return sendJson(response, 202, { id, stage: job.stage })
      }
      const eventMatch = url.pathname.match(/^\/jobs\/([^/]+)\/events$/)
      if (request.method === 'GET' && eventMatch) {
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        response.setHeader('Cache-Control', 'no-cache')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders()
        events.subscribe(decodeURIComponent(eventMatch[1]), response)
        response.write(': connected\n\n')
        return
      }
      const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/)
      if (request.method === 'GET' && jobMatch) {
        const job = await store.get(decodeURIComponent(jobMatch[1]))
        return job ? sendJson(response, 200, job) : sendJson(response, 404, { error: '任务不存在' })
      }
      sendJson(response, 404, { error: '接口不存在' })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : '服务异常' })
    }
  })
  return { server, store, service, listen: (port = options.port ?? (Number(process.env.PORT) || 8787)) => server.listen(port) }
}

if (process.argv[1]?.endsWith('httpServer.js')) {
  const app = createOcrHttpServer()
  app.listen()
  console.log('aiauto OCR service listening on http://127.0.0.1:8787')
}
