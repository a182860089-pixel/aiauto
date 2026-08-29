import type { VisionResult } from './types.js'

function extractBalancedObject(text: string) {
  const start = text.indexOf('{')
  if (start < 0) return '{}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  return text.slice(start)
}

/** 修复未闭合字符串、尾逗号和截断的对象/数组，不修改字符串中的内容。 */
export function repairJson(text: string) {
  let output = ''
  let inString = false
  let escaped = false
  const stack: string[] = []
  for (const character of text) {
    if (inString) {
      if (escaped) {
        output += character
        escaped = false
      } else if (character === '\\') {
        output += character
        escaped = true
      } else if (character === '"') {
        output += character
        inString = false
      } else if (character === '\n') output += '\\n'
      else if (character === '\r') output += '\\r'
      else if (character === '\t') output += '\\t'
      else output += character
      continue
    }
    if (character === '"') {
      inString = true
      output += character
    } else if (character === '{' || character === '[') {
      stack.push(character)
      output += character
    } else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.at(-1) === expected) {
        stack.pop()
        output += character
      }
    } else output += character
  }
  if (inString) output += '"'
  while (stack.length) output += stack.pop() === '{' ? '}' : ']'
  return output.replace(/,\s*([}\]])/g, '$1')
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

function parseRows(value: unknown, columns: string[]) {
  if (!Array.isArray(value)) return []
  return value.flatMap((row): Array<string[] | Record<string, unknown>> => {
    if (Array.isArray(row)) return [columns.map((_, index) => stringValue(row[index]))]
    if (row && typeof row === 'object') return [Object.fromEntries(Object.entries(row).map(([key, item]) => [key, stringValue(item)]))]
    return []
  })
}

/** 二阶段 Schema 归一化：确保列名、行结构和字段全部可安全消费。 */
export function parseVisionJson(content: unknown, sliceIndex?: number): VisionResult {
  const text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : (part as { text?: unknown })?.text || '').join('')
    : String(content ?? '')
  const candidate = extractBalancedObject(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim())
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>
  } catch {
    try {
      parsed = JSON.parse(repairJson(candidate)) as Record<string, unknown>
    } catch {
      parsed = { rawText: text, fields: {}, table: { columns: [], rows: [] } }
    }
  }
  const rawTable = parsed.table && typeof parsed.table === 'object' ? parsed.table as Record<string, unknown> : {}
  const columns = Array.isArray(rawTable.columns) ? rawTable.columns.map(stringValue).filter(Boolean) : []
  const rows = parseRows(rawTable.rows, columns)
  const fields = parsed.fields && typeof parsed.fields === 'object'
    ? Object.fromEntries(Object.entries(parsed.fields).map(([key, value]) => [key, stringValue(value)]))
    : {}
  return { fields, table: { columns, rows }, rawText: stringValue(parsed.rawText) || text, sliceIndex }
}

export function buildOcrPrompt(source: { rowStart: number; rowEnd: number; headerYEnd: number }) {
  return [
    '只识别图片中看得见的表格，严格返回 JSON，不要 Markdown，不要解释。',
    'table.columns 必须逐字抄录图片中的表头，禁止改名、漏列、合并列。',
    'table.rows 只包含数据行，不要重复表头；每行长度必须与 columns 相同。无法确认的格子填空字符串，禁止猜测。',
    `当前切片来自原图表体行约 ${source.rowStart}-${source.rowEnd}，顶部重复表头到原图 Y=${source.headerYEnd}；请利用表头做列对齐。`,
    '返回格式：{"fields":{},"table":{"columns":["表头1","表头2"],"rows":[["","..."]]}}',
  ].join('\n')
}
