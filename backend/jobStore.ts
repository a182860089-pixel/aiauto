import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { JobRecord, JobStage } from './types.js'

function now() { return new Date().toISOString() }

const TRANSITIONS: Record<JobStage, readonly JobStage[]> = {
  PENDING: ['SLICING', 'FAILED'],
  SLICING: ['INFERRING', 'FAILED'],
  INFERRING: ['MERGING', 'FAILED'],
  MERGING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['SLICING', 'INFERRING', 'MERGING', 'FAILED'],
}

function isTransitionAllowed(from: JobStage, to: JobStage) {
  return from === to || TRANSITIONS[from].includes(to)
}

/** 文件型持久化存储：原图/切片以 hash 文件保存，任务 JSON 原子替换，重启可继续。 */
export class JobStore {
  private readonly jobs = new Map<string, JobRecord>()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()
  private readonly jobsPath: string
  private readonly blobDir: string
  private readonly cacheDir: string

  constructor(rootDir = path.resolve('.aiauto-data')) {
    this.jobsPath = path.join(rootDir, 'jobs.json')
    this.blobDir = path.join(rootDir, 'blobs')
    this.cacheDir = path.join(rootDir, 'cache')
  }

  async init() {
    if (this.loaded) return
    await mkdir(this.blobDir, { recursive: true })
    await mkdir(this.cacheDir, { recursive: true })
    try {
      const saved = JSON.parse(await readFile(this.jobsPath, 'utf8')) as JobRecord[]
      saved.forEach((job) => this.jobs.set(job.id, job))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.loaded = true
  }

  async create(input: Pick<JobRecord, 'imageHash' | 'imageName' | 'model'>): Promise<JobRecord> {
    await this.init()
    const timestamp = now()
    const job: JobRecord = { id: `job-${randomUUID()}`, stage: 'PENDING', createdAt: timestamp, updatedAt: timestamp, ...input, slices: [] }
    this.jobs.set(job.id, job)
    await this.persist()
    return structuredClone(job)
  }

  async get(id: string) {
    await this.init()
    const job = this.jobs.get(id)
    return job ? structuredClone(job) : undefined
  }

  async update(id: string, mutate: (job: JobRecord) => void) {
    await this.init()
    const job = this.jobs.get(id)
    if (!job) throw new Error(`任务不存在：${id}`)
    mutate(job)
    job.updatedAt = now()
    await this.persist()
    return structuredClone(job)
  }

  async transition(id: string, stage: JobStage, error?: string) {
    return this.update(id, (job) => {
      if (!isTransitionAllowed(job.stage, stage)) throw new Error(`非法任务状态迁移：${job.stage} -> ${stage}`)
      job.stage = stage
      if (error) job.error = error
      else delete job.error
    })
  }

  async putBlob(data: Buffer | string) {
    await this.init()
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const filePath = path.join(this.blobDir, hash)
    try { await readFile(filePath) } catch { await writeFile(filePath, buffer, { flag: 'wx' }).catch(() => undefined) }
    return { hash, filePath }
  }

  async putDataUrl(dataUrl: string) {
    const match = /^data:[^;]+;base64,(.*)$/s.exec(dataUrl)
    if (!match) throw new Error('图片必须是 base64 Data URL')
    return this.putBlob(Buffer.from(match[1], 'base64'))
  }

  async readBlob(hash: string) {
    await this.init()
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('非法内容哈希')
    return readFile(path.join(this.blobDir, hash))
  }

  async getCachedResult(hash: string) {
    await this.init()
    try { return JSON.parse(await readFile(path.join(this.cacheDir, `${hash}.json`), 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async putCachedResult(hash: string, result: unknown) {
    await this.init()
    const target = path.join(this.cacheDir, `${hash}.json`)
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(result), 'utf8')
    await rename(temporary, target)
  }

  private async persist() {
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${this.jobsPath}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify([...this.jobs.values()], null, 2), 'utf8')
      await rename(temporary, this.jobsPath)
    })
    return this.writeChain
  }
}
