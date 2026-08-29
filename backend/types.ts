export const JOB_STAGES = ['PENDING', 'SLICING', 'INFERRING', 'MERGING', 'COMPLETED', 'FAILED'] as const
export type JobStage = typeof JOB_STAGES[number]

export type SliceStage = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export type SliceRef = {
  index: number
  blobHash: string
  stage: SliceStage
  sourceYStart: number
  sourceYEnd: number
  headerYStart: number
  headerYEnd: number
  rowStart: number
  rowEnd: number
  attempts: number
  elapsedMs?: number
  error?: string
  resultCacheKey?: string
}

export type VisionTable = {
  columns: string[]
  rows: Array<string[] | Record<string, unknown>>
}

export type VisionResult = {
  fields: Record<string, string>
  table: VisionTable
  rawText?: string
  sliceIndex?: number
}

export type NormalizedRecord = {
  patientNo: string
  outpatientNo: string
  name: string
  gender: string
  age: string
  visitType: '初诊' | '复诊' | '急诊' | ''
  westernDiagnosis: string
  chineseDiagnosis: string
  chinesePattern: string
  visitDate: string
  remarks: string
  source: Record<string, string>
}

export type JobRecord = {
  id: string
  stage: JobStage
  createdAt: string
  updatedAt: string
  imageHash: string
  imageName: string
  model: string
  slices: SliceRef[]
  result?: {
    columns: string[]
    rows: string[][]
    records: NormalizedRecord[]
  }
  error?: string
}

export type ProgressEvent = {
  jobId: string
  stage: JobStage
  completed: number
  total: number
  percent: number
  elapsedMs: number
  etaMs: number | null
  message: string
  sliceIndex?: number
  at: string
}

export type VisionInfer = (input: {
  dataUrl: string
  sliceIndex: number
  source: Pick<SliceRef, 'sourceYStart' | 'sourceYEnd' | 'headerYStart' | 'headerYEnd' | 'rowStart' | 'rowEnd'>
}) => Promise<VisionResult>
