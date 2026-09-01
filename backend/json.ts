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
  return insertMissingJsonCommas(output).replace(/,\s*([}\]])/g, '$1')
}

function peekNonSpace(text: string, index: number) {
  while (index < text.length && /\s/.test(text[index])) index += 1
  return text[index]
}

function startsJsonValue(character: string | undefined) {
  return Boolean(character && ('"{[-0123456789tfn'.includes(character)))
}

/** 补上模型漏写的逗号，例如 `][`、`"" ""`。 */
function insertMissingJsonCommas(text: string) {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
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

function stringValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value.trim() : String(value).trim()
  const normalized = text.replace(/\s+/g, '')
  // 模型把提示词中的示例当成单元格内容时，不能展示为识别结果。
  if (/^(?:如|例如|表头|列名|单元格内容)\s*[0-9一二三四五六七八九十]*\s*[:：]?/u.test(text)) return ''
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(normalized)) return ''
  if (/^[YMD\-/_.]{3,}$/i.test(normalized)) return ''
  if (/^Y{2,4}(?:[-/.]?M{1,2}(?:[-/.]?D{1,2})?)?$/i.test(normalized)) return ''
  if (/^\d{4}[-/.]M{1,2}(?:[-/.]D{1,2})?$/i.test(normalized)) return ''
  return text
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
    '只识别图片中看得见的 HIS/病历表格，严格返回 JSON，不要 Markdown，不要解释。',
    'table.columns 必须按图片表头从左到右逐字输出，禁止改名、漏列、合并列；若表头因宽度被截断，保留可见表头文字。',
    'table.rows 只包含数据行，不要重复表头；每行长度必须与 columns 相同，按列位置对应。',
    '重点读取右侧诊断区：西医诊断列、中医诊断列必须分别逐行读取，保留括号内编码和后面的诊断文字；禁止复制一列内容到另一列。',
    '重点读取日期：图片里的“时间/日期/就诊时间/入院时间”列要读出可见的 YYYY-MM-DD，单元格后面的省略号不影响日期。',
    '每个单元格只能填写图片中对应位置实际看见的文字；看不清时填空字符串，不要猜测、复制上一行、复制其他列或使用示例文字。',
    '不要使用“图片未识别”、YYYY-MM-DD、YYYY-M、示例文字或占位符。挂号单/挂号流水号与门诊号是不同字段，按各自表头读取；不要根据姓名、上一行或其他行补齐号码。',
    `当前切片来自原图表体行约 ${source.rowStart}-${source.rowEnd}，顶部重复表头到原图 Y=${source.headerYEnd}；请利用表头做列对齐。`,
    '返回格式：{"fields":{},"table":{"columns":["表头1","表头2"],"rows":[["","..."]]}}',
  ].join('\n')
}
