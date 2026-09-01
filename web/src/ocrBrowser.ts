export const DEFAULT_OCR_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'

type OcrResult = {
  rawText?: string
  fields?: Record<string, string>
  table?: { columns: string[]; rows: Array<Record<string, string> | string[]> }
  [key: string]: unknown
}
var MAX_IMAGE_EDGE = 3200

export { TEMPLATE_COLUMNS } from './templateMapping'

/**
 * 将用户输入拆成去重后的 API Key 列表。
 * @param input API Key 或分隔后的密钥集合
 * @return 可尝试的密钥列表
 */
export function normalizeApiKeys(input: string | string[]) {
  var values = Array.isArray(input) ? input : [input]
  return [...new Set(values.flatMap((value) => String(value || '').split(/[\s,;|]+/)).map((value) => value.trim()).filter(Boolean))]
}

/**
 * 生成按图片真实表头识别的 OCR 提示词。
 * @return OCR 提示词
 */
export function buildOcrPrompt() {
  return [
    '只识别图片中看得见的 HIS/病历表格。严格返回 JSON，不要 Markdown，不要解释。',
    'columns 必须按图片表头从左到右逐字输出，不能改名、漏列、合并列；若表头因宽度被截断，保留可见表头文字。',
    'rows 只含数据行，每个 row 必须与 columns 等长，按列位置对应。',
    '重点读取右侧诊断区：西医诊断列、中医诊断列必须分别逐行读取，保留括号内编码和后面的诊断文字；禁止把一列的内容复制到另一列。',
    '重点读取日期：图片里的“时间/日期/就诊时间/入院时间”列要读出可见的 YYYY-MM-DD，单元格后面的省略号不影响日期。',
    '每个单元格只能填写图片中该单元格实际看见的文字；看不清时填空字符串，不要猜测、复制上一行、复制其他列或使用示例文字。',
    '不要使用“图片未识别”、YYYY-MM-DD、YYYY-M、示例文字或占位符。挂号单/挂号流水号与门诊号是不同字段，必须按各自表头读取；不要根据姓名、上一行或其他行补齐号码。',
    '返回：{"table":{"columns":["表头1","表头2"],"rows":[["",""]]}}',
  ].join('\n')
}

/**
 * 取出模型回复中的 JSON 主体。
 * @param text 模型回复文本
 * @return JSON 主体
 */
function extractJsonText(text: string) {
  var cleanedText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  var startIndex = cleanedText.indexOf('{')
  if (startIndex < 0) return '{}'
  return cleanedText.slice(startIndex)
}

/**
 * 修复视觉模型常见的非严格 JSON 输出。
 * @param text 待修复的 JSON 文本
 * @return 可供 JSON.parse 处理的文本
 */
function repairJsonText(text: string) {
  var characters = [...text]
  var repairedText = ''
  var inString = false
  var escaped = false
  var stack: string[] = []
  var rootClosed = false
  characters.forEach((character, index) => {
    if (rootClosed) return
    if (inString) {
      if (escaped) {
        repairedText += /^["\\/bfnrtu]$/.test(character) ? character : `\\${character}`
        escaped = false
        return
      }
      if (character === '\\') {
        repairedText += character
        escaped = true
        return
      }
      if (character === '"') {
        var nextCharacter = characters.slice(index + 1).find((characterAfterQuote) => !/\s/.test(characterAfterQuote))
        var isClosingQuote = !nextCharacter || ',:}]"[{'.includes(nextCharacter) || (nextCharacter >= '0' && nextCharacter <= '9')
        if (isClosingQuote) inString = false
        else repairedText += '\\"'
        if (isClosingQuote) repairedText += character
        return
      }
      var controlCharacterMap: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
      repairedText += controlCharacterMap[character] || character
      return
    }
    if (character === '"') {
      inString = true
      repairedText += character
      return
    }
    if ('{['.includes(character)) stack.push(character)
    if (character === '}' || character === ']') {
      var expectedOpening = character === '}' ? '{' : '['
      if (stack[stack.length - 1] === expectedOpening) {
        stack.pop()
        repairedText += character
        if (stack.length === 0) rootClosed = true
        return
      }
    }
    repairedText += character
  })
  if (escaped) repairedText += '\\'
  if (inString) repairedText += '"'
  stack.reverse().forEach((opening) => { repairedText += opening === '{' ? '}' : ']' })
  return insertMissingJsonCommas(repairedText).replace(/,\s*([}\]])/g, '$1')
}

function peekNonSpace(text: string, index: number) {
  while (index < text.length && /\s/.test(text[index])) index += 1
  return text[index]
}

function startsJsonValue(character: string | undefined) {
  return Boolean(character && '"{[-0123456789tfn'.includes(character))
}

function insertMissingJsonCommas(text: string) {
  var output = ''
  var inString = false
  var escaped = false
  for (var index = 0; index < text.length; index += 1) {
    var character = text[index]
    output += character
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      if (!inString && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if ((character === ']' || character === '}') && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
    if (/[0-9]/.test(character) && text[index + 1] && /\s/.test(text[index + 1]) && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
  }
  return output
}

function cleanOcrCell(value: unknown) {
  var text = String(value ?? '').trim()
  var normalized = text.replace(/\s+/g, '')
  if (/^(?:如|例如|表头|列名|单元格内容)\s*[0-9一二三四五六七八九十]*\s*[:：]?/u.test(text)) return ''
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(normalized)) return ''
  if (/^[YMD\-/_.]{3,}$/i.test(normalized)) return ''
  if (/^Y{2,4}(?:[-/.]?M{1,2}(?:[-/.]?D{1,2})?)?$/i.test(normalized)) return ''
  if (/^\d{4}[-/.]M{1,2}(?:[-/.]?D{1,2})?$/i.test(normalized)) return ''
  return text
}

/**
 * 将模型响应内容解析为结构化 OCR 数据。
 * @param content 模型返回的 content
 * @return 结构化识别结果
 */
export function parseOcrContent(content: unknown): OcrResult {
  var text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : (part as { text?: string })?.text || '').join('')
    : String(content || '')
  var jsonText = extractJsonText(text)
  var parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    try {
      parsed = JSON.parse(repairJsonText(jsonText))
    } catch {
      parsed = { rawText: text, fields: {}, table: { columns: [], rows: [] } }
    }
  }
  var fields = parsed.fields && typeof parsed.fields === 'object'
    ? Object.fromEntries(Object.entries(parsed.fields as Record<string, unknown>).map(([key, value]) => [key, cleanOcrCell(value)]))
    : {}
  var table = parsed.table && typeof parsed.table === 'object' ? parsed.table as { columns?: unknown; rows?: unknown } : {}
  return {
    ...parsed,
    rawText: String(parsed.rawText || ''),
    fields,
    table: {
      columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
      rows: Array.isArray(table.rows) ? table.rows.map((row) => Array.isArray(row)
        ? row.map(cleanOcrCell)
        : Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, cleanOcrCell(value)]))) as Array<Record<string, string> | string[]> : [],
    },
  }
}

/**
 * 压缩过大的图片，避免请求体过大导致长时间无响应。
 * @param dataUrl 原始图片 Data URL
 * @return 压缩后的 JPEG Data URL
 */
export function compressImage(dataUrl: string) {
  return new Promise<string>((resolve, reject) => {
    var image = new Image()
    image.onload = () => {
      var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height))
      var canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      var context = canvas.getContext('2d')
      if (!context) return reject(new Error('无法压缩图片'))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    image.onerror = () => reject(new Error('图片无法读取，请换一张再试'))
    image.src = dataUrl
  })
}

/**
 * 把表头和一段表体画成一张切片。
 * @param image 原图
 * @param headerHeight 表头高度
 * @param start 表体起点
 * @param end 表体终点
 * @return 切片 Data URL
 */
function drawSlice(image: HTMLImageElement, headerHeight: number, start: number, end: number) {
  var bodyHeight = Math.max(1, end - start)
  var canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = headerHeight + bodyHeight
  var context = canvas.getContext('2d')
  if (!context) throw new Error('无法切分图片')
  context.drawImage(image, 0, 0, image.width, headerHeight, 0, 0, image.width, headerHeight)
  context.drawImage(image, 0, headerHeight + start, image.width, bodyHeight, 0, headerHeight, image.width, bodyHeight)
  return canvas.toDataURL('image/jpeg', 0.8)
}

/**
 * 按密钥数量横切，每张切片都带上表头，避免后半段丢列。
 * @param dataUrl 压缩后的图片
 * @param partCount 切片数量
 * @return 切片 Data URL
 */
export function splitImage(dataUrl: string, partCount: number) {
  return new Promise<string[]>((resolve, reject) => {
    var image = new Image()
    image.onload = () => {
      var headerHeight = Math.min(Math.round(image.height * 0.1), 180)
      var bodyHeight = Math.max(1, image.height - headerHeight)
      var count = Math.min(Math.max(1, partCount), Math.max(1, Math.ceil(bodyHeight / 280)))
      if (count <= 1) return resolve([dataUrl])
      var overlap = Math.round(bodyHeight * 0.05)
      resolve(Array.from({ length: count }, (_, index) => {
        var start = Math.max(0, Math.floor((bodyHeight * index) / count) - (index ? overlap : 0))
        var end = Math.min(bodyHeight, Math.ceil((bodyHeight * (index + 1)) / count) + overlap)
        return drawSlice(image, headerHeight, start, end)
      }))
    }
    image.onerror = () => reject(new Error('图片无法切分'))
    image.src = dataUrl
  })
}

export type OcrPreviewJob = {
  id: string
  columns: string[]
  rows: string[][]
  rowCount: number
}

export type OcrExportJob = {
  id: string
  downloadUrl: string
  outputPath?: string
  rowCount: number
  matchedColumns?: string[]
  ignoredColumns?: string[]
}

/**
 * 压缩图片后按多密钥并发识别，并生成 Excel。
 * @param options 识别参数
 * @return 导出任务结果
 */
export async function requestVisionOcr(options: {
  dataUrl: string
  apiKeys: string | string[]
  model?: string
}) {
  var apiKeys = normalizeApiKeys(options.apiKeys)
  if (apiKeys.length === 0) throw new Error('请先填写硅基流动 API Key')
  var model = options.model || DEFAULT_OCR_MODEL
  var dataUrl = await compressImage(options.dataUrl)
  var slices = await splitImage(dataUrl, apiKeys.length)
  var created = await fetch('/ocr-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slices, apiKeys, model }),
  })
  if (!created.ok) throw new Error(await created.text())
  var jobInfo = await created.json()
  var pollJob = async (): Promise<OcrPreviewJob> => {
    var statusResponse = await fetch(`/ocr-status?id=${encodeURIComponent(jobInfo.id)}`)
    var job = await statusResponse.json()
    if (job.error && job.done) throw new Error(job.error)
    if (job.done) return {
      id: jobInfo.id,
      columns: Array.isArray(job.columns) ? job.columns.map(String) : [],
      rows: Array.isArray(job.rows) ? job.rows : [],
      rowCount: job.rowCount || 0,
    }
    await new Promise((resolve) => window.setTimeout(resolve, 700))
    return pollJob()
  }
  return pollJob()
}

/**
 * 把勾选行写入 Excel。
 * @param options 导出参数
 * @return 导出任务
 */
export async function exportRecognizedRows(options: {
  id: string
  fileName?: string
  templateDataUrl?: string
  recordCategory: string
  department: string
  selectedIndexes: number[]
}) {
  var response = await fetch('/ocr-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  if (!response.ok) {
    var payload = await response.json().catch(() => ({ error: '导出失败' }))
    throw new Error(payload.error || '导出失败')
  }
  return response.json() as Promise<OcrExportJob>
}
