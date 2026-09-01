import { inferPatientRow, type ClassifiedPatientRow } from './smartClassifier'
import { normalizeHeader } from './templateMapping'

export const DEFAULT_OCR_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'
var MAX_IMAGE_WIDTH = 2880
var MAX_DATA_URL_CHARS = 2200000

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
    '第一张图是完整表格，必须从左到右读出全部列，重点包括姓名、住院号/门诊号、日期/时间、主管/参观；这些左侧列禁止整列留空。',
    '重点读取右侧诊断区：西医诊断在中医诊断左边，两列必须分别读取，禁止合并、漏列或互相复制。',
    '西医诊断单元格常见格式是“(ICD编码)病名”，例如 (M47.921)颈椎病、(G47.001)失眠、(M51.202)腰椎间盘突出；编码和后面的中文病名都要读出，禁止只填编码，禁止整列留空。',
    '中医诊断在最右侧，常见格式是“(编码)病名:证型”或“(编码)病名-证型”。',
    '若表头被截成“西医诊”“中医诊”，仍按这两列从左到右对应西医诊断、中医诊断。',
    '诊断列即使字小、列窄、表头被截断，也必须逐行读出编码和中文病名/证型；禁止把西医诊断或中医诊断整列留空。',
    '重点读取日期：图片里的“时间/日期/就诊时间/入院时间”列要读出可见的 YYYY-MM-DD，单元格后面的省略号不影响日期。',
    '每个单元格只能填写图片中该单元格实际看见的文字。姓名、住院号、日期、主管/参观以第一张完整表格为准；只有第一张图对应单元格确实没有文字时才填空字符串。不要使用“图片未识别”、YYYY-MM-DD、YYYY-M、示例文字或占位符。',
    '挂号单/挂号流水号与门诊号是不同字段，必须按各自表头读取；不要根据姓名、上一行或其他行补齐号码。',
    '返回：{"rawText":"","fields":{"patientName":"","gender":"","age":"","admissionDate":"","diagnosis":"","chiefComplaint":"","course":"","treatment":""},"table":{"columns":["表头1","表头2"],"rows":[["",""]]}}',
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

export function cleanOcrCell(value: unknown) {
  var text = String(value ?? '').trim()
  var normalized = text.replace(/\s+/g, '')
  if (/^(?:如|例如|表头|列名|单元格内容)\s*[0-9一二三四五六七八九十]*\s*[:：]?/u.test(text)) return ''
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(normalized)) return ''
  if (/^[YMD\-/_.]{3,}$/i.test(normalized)) return ''
  if (/^Y{2,4}(?:[-/.]?M{1,2}(?:[-/.]?D{1,2})?)?$/i.test(normalized)) return ''
  if (/^\d{4}[-/.]M{1,2}(?:[-/.]D{1,2})?$/i.test(normalized)) return ''
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
      var scale = image.width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / image.width : 1
      var quality = 0.86
      var encoded = dataUrl
      for (var round = 0; round < 5; round += 1) {
        var canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        var context = canvas.getContext('2d')
        if (!context) return reject(new Error('无法压缩图片'))
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        encoded = canvas.toDataURL('image/jpeg', quality)
        if (encoded.length <= MAX_DATA_URL_CHARS) break
        quality = Math.max(0.62, quality - 0.08)
        if (round >= 3) scale *= 0.92
      }
      resolve(encoded)
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

export interface UploadedImageItem {
  id: string
  name: string
  dataUrl: string
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  recognizedRows?: ClassifiedPatientRow[]
}

/**
 * 压缩图片后按多密钥并发识别，并返回原始表格。
 * @param options 识别参数
 * @return 任务预览
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
  var created = await fetch('/ocr-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, apiKeys, model }),
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
 * 把 OCR 表格转成等长二维数组，兼容对象行和数组行。
 * @param table 识别结果中的表格
 * @return 表头与数据行
 */
function tableToMatrix(table?: { columns?: string[]; rows?: Array<Record<string, string> | string[]> }) {
  var columns = Array.isArray(table?.columns) ? table.columns.map(String) : []
  var rows = (table?.rows || []).map((row) => {
    if (Array.isArray(row)) return columns.map((_, index) => String(row[index] ?? ''))
    return columns.map((column) => {
      var sourceKey = Object.keys(row || {}).find((key) => normalizeHeader(key) === normalizeHeader(column))
      return sourceKey ? String(row[sourceKey] ?? '') : ''
    })
  })
  return { columns, rows }
}

/**
 * 识别单张图片并将其每一行转换为 ClassifiedPatientRow 结构
 */
export async function recognizeAndClassifyImage(
  imageItem: UploadedImageItem,
  apiKeys: string | string[],
  model: string = DEFAULT_OCR_MODEL,
  defaultDepartment: string = '通州呼吸科二区',
): Promise<ClassifiedPatientRow[]> {
  var columns: string[]
  var rows: string[][]
  if (typeof window !== 'undefined' && window.desktopApi?.recognizeImage) {
    var dataUrl = await compressImage(imageItem.dataUrl)
    var desktopResult = await window.desktopApi.recognizeImage({
      dataUrl,
      apiKey: Array.isArray(apiKeys) ? apiKeys.join('\n') : String(apiKeys || ''),
      model,
    })
    var matrix = tableToMatrix(desktopResult.table)
    columns = matrix.columns
    rows = matrix.rows
  } else {
    var preview = await requestVisionOcr({ dataUrl: imageItem.dataUrl, apiKeys, model })
    columns = preview.columns
    rows = preview.rows
  }

  var classifiedRows: ClassifiedPatientRow[] = []
  rows.forEach((rowValues, rowIndex) => {
    var rowObj: Record<string, string> = {}
    columns.forEach((col, cIdx) => {
      rowObj[col] = String(rowValues[cIdx] ?? '')
    })
    var patientRow = inferPatientRow(rowObj, imageItem.name, defaultDepartment, rowIndex)
    classifiedRows.push(patientRow)
  })

  // 如果没有识别到表格数据行，但有文字，兜底作为单条记录
  if (classifiedRows.length === 0) {
    var fallback = inferPatientRow({}, imageItem.name, defaultDepartment, 0)
    fallback.remarks = '未能识别到多行表格'
    classifiedRows.push(fallback)
  }

  return classifiedRows
}

/**
 * 批量并发识别多张图片
 */
export async function processBatchImages(
  items: UploadedImageItem[],
  apiKeys: string | string[],
  model: string = DEFAULT_OCR_MODEL,
  defaultDepartment: string = '通州呼吸科二区',
  onProgress?: (updatedItem: UploadedImageItem, allItems: UploadedImageItem[]) => void,
): Promise<ClassifiedPatientRow[]> {
  var keys = normalizeApiKeys(apiKeys)
  if (keys.length === 0 && !(typeof window !== 'undefined' && window.desktopApi)) {
    throw new Error('请先填写硅基流动 API Key')
  }

  // 限制同时处理的图片并发数，避免耗尽连接
  var concurrency = Math.min(Math.max(1, keys.length), 3)
  var results: ClassifiedPatientRow[] = []
  var activeItems = [...items]

  var runQueue = async (queue: UploadedImageItem[]) => {
    var workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        var item = queue.shift()
        if (!item) break
        item.status = 'processing'
        onProgress?.(item, activeItems)
        try {
          var rows = await recognizeAndClassifyImage(item, keys, model, defaultDepartment)
          item.status = 'done'
          item.recognizedRows = rows
          results.push(...rows)
        } catch (err) {
          item.status = 'error'
          var message = err instanceof Error ? err.message : '识别失败'
          item.error = message.replace(/^Error invoking remote method '[^']+':\s*/, '')
        }
        onProgress?.(item, activeItems)
      }
    })
    await Promise.all(workers)
  }

  var pendingQueue = activeItems.filter((it) => it.status === 'pending' || it.status === 'error')
  await runQueue(pendingQueue)

  return results
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
