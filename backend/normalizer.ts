import type { NormalizedRecord } from './types.js'

const TCM_PATTERNS = [
  /(?:^|[：:、，,；;\s])[^：:、，,；;]{1,18}(?:证|證|证候|型)(?:$|[、，,；;\s])/u,
  /(气虚|血虚|阴虚|阳虚|气滞|血瘀|痰湿|湿热|寒湿|风寒|风热|肝郁|脾虚|肾虚|肺虚|心脾两虚|气血两虚|津液亏虚|痰瘀互结)/u,
]

const FIELD_ALIASES = {
  patientNo: ['病历号', '病案号', '住院号'],
  outpatientNo: ['门诊号', '就诊号', '挂号号'],
  name: ['姓名', '患者姓名'],
  gender: ['性别'],
  age: ['年龄'],
  visitType: ['初复诊', '初/复诊', '就诊类型', '诊别'],
  diagnosis: ['诊断', '主要诊断', '疾病诊断'],
  westernDiagnosis: ['西医诊断', '西医病名'],
  chineseDiagnosis: ['中医诊断', '中医病名'],
  chinesePattern: ['中医证型', '证型', '辨证分型'],
  visitDate: ['就诊日期', '日期', '入院日期', '诊疗日期'],
  remarks: ['备注'],
} as const

function compactHeader(value: string) {
  return value.replace(/[\s:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
}

function pick(source: Record<string, string>, aliases: readonly string[]) {
  const entry = Object.entries(source).find(([key]) => aliases.some((alias) => compactHeader(key) === compactHeader(alias)))
  return entry?.[1]?.trim() || ''
}

export function normalizeEllipsis(value: string) {
  return value
    .replace(/[.．。]{3,}/g, '…')
    .replace(/…{2,}/g, '…')
    .replace(/\s*…\s*/g, '…')
    .trim()
}

/** 仅在诊断字段中调用，避免把病历号误当成 ICD 编码。 */
export function stripIcdCodes(value: string) {
  return normalizeEllipsis(value)
    .replace(/[（(\[【]\s*[A-Z][0-9]{2,3}(?:\.[0-9A-Z]{1,4})?\s*[）)\]】]/gi, ' ')
    .replace(/(?:^|[\s,，;；])(?:ICD[-\s]?10[:：]?\s*)?[A-Z][0-9]{2,3}(?:\.[0-9A-Z]{1,4})?(?=$|[\s,，;；])/gi, ' ')
    .replace(/\s*[,，;；]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,，;；\s]+|[,，;；\s]+$/g, '')
}

function looksLikeTcmPattern(value: string) {
  return TCM_PATTERNS.some((pattern) => pattern.test(` ${value} `))
}

export function splitChineseDiagnosis(value: string) {
  const cleaned = stripIcdCodes(value)
  if (!cleaned) return { disease: '', pattern: '' }
  const colon = cleaned.match(/^(.{1,30}?)[：:]\s*(.{1,30}(?:证|證|型|证候))$/u)
  if (colon) return { disease: colon[1].trim(), pattern: colon[2].trim() }
  const segments = cleaned.split(/[、，,；;]/).map((item) => item.trim()).filter(Boolean)
  const patterns = segments.filter(looksLikeTcmPattern)
  const diseases = segments.filter((item) => !patterns.includes(item))
  if (patterns.length) return { disease: diseases.join('、'), pattern: patterns.join('、') }
  return looksLikeTcmPattern(cleaned) ? { disease: '', pattern: cleaned } : { disease: cleaned, pattern: '' }
}

export function normalizeVisitType(value: string): NormalizedRecord['visitType'] {
  const cleaned = value.trim()
  if (/急/.test(cleaned)) return '急诊'
  if (/复|複/.test(cleaned)) return '复诊'
  if (/初/.test(cleaned)) return '初诊'
  return ''
}

function recoverVisitType(value: string) {
  const match = value.match(/(?:^|[\s_\-/])(初|复|複|急)(?:诊)?$/u) || value.match(/^(初|复|複|急)(?:诊)?$/u)
  if (!match) return { value: value.trim(), visitType: '' as NormalizedRecord['visitType'] }
  return {
    value: value.slice(0, match.index).replace(/[\s_\-/]+$/g, '').trim(),
    visitType: normalizeVisitType(match[1]),
  }
}

export function normalizeDate(value: string) {
  const cleaned = value.trim().replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '')
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+.*)?$/)
  if (!match) return value.trim()
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value.trim()
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function diagnosisRouter(source: Record<string, string>) {
  const explicitWestern = stripIcdCodes(pick(source, FIELD_ALIASES.westernDiagnosis))
  const explicitChinese = pick(source, FIELD_ALIASES.chineseDiagnosis)
  const explicitPattern = pick(source, FIELD_ALIASES.chinesePattern)
  const generic = pick(source, FIELD_ALIASES.diagnosis)
  const chinese = splitChineseDiagnosis(explicitChinese || (looksLikeTcmPattern(generic) ? generic : ''))
  return {
    westernDiagnosis: explicitWestern || (!looksLikeTcmPattern(generic) ? stripIcdCodes(generic) : ''),
    chineseDiagnosis: chinese.disease,
    chinesePattern: explicitPattern || chinese.pattern,
  }
}

/** 将一行 OCR 字段归一化，并将误入号码列的初/复/急单字自动归位。 */
export function normalizeRecord(input: Record<string, unknown>): NormalizedRecord {
  const source = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, normalizeEllipsis(String(value ?? ''))]))
  const patient = recoverVisitType(pick(source, FIELD_ALIASES.patientNo))
  const outpatient = recoverVisitType(pick(source, FIELD_ALIASES.outpatientNo))
  const diagnosis = diagnosisRouter(source)
  const explicitVisitType = normalizeVisitType(pick(source, FIELD_ALIASES.visitType))
  return {
    patientNo: patient.value,
    outpatientNo: outpatient.value,
    name: pick(source, FIELD_ALIASES.name),
    gender: pick(source, FIELD_ALIASES.gender),
    age: pick(source, FIELD_ALIASES.age),
    visitType: explicitVisitType || outpatient.visitType || patient.visitType,
    westernDiagnosis: diagnosis.westernDiagnosis,
    chineseDiagnosis: diagnosis.chineseDiagnosis,
    chinesePattern: diagnosis.chinesePattern,
    visitDate: normalizeDate(pick(source, FIELD_ALIASES.visitDate)),
    remarks: pick(source, FIELD_ALIASES.remarks),
    source,
  }
}
