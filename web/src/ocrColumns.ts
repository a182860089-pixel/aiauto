function cellFilled(value: unknown) {
  var text = String(value ?? '').trim()
  if (!text) return false
  var compact = text.replace(/\s+/g, '')
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(compact)) return false
  if (/^[YMD\-/_.]{3,}$/i.test(compact)) return false
  if (/^[…·.•。,，;；:：\-—–_]+$/.test(compact)) return false
  return true
}

function compactHeader(value: unknown) {
  return String(value ?? '').replace(/[\s　]/g, '').trim()
}

function isIdHeader(header: string) {
  return /登记号|住院号|门诊号|病历号|病案号|挂号号/.test(compactHeader(header))
}

function looksLikeIdValue(value: string) {
  var text = String(value || '').trim().replace(/\s+/g, '')
  return /^\d{5,}$/.test(text) || /^[A-Za-z]{1,6}[-_]?\d{4,}$/.test(text)
}

function isMostlyFeeType(values: string[]) {
  var filled = values.map((value) => String(value ?? '').trim()).filter(cellFilled)
  if (!filled.length) return false
  var fee = filled.filter((value) => {
    var compact = value.replace(/\s+/g, '')
    return /(?:医保|自费|城乡居民|新农合|公费)/.test(compact) && !/\d/.test(compact)
  })
  return fee.length >= Math.ceil(filled.length * 0.6)
}

function isMostlyGender(values: string[]) {
  var filled = values.map((value) => String(value ?? '').trim()).filter(cellFilled)
  if (!filled.length) return false
  return filled.every((value) => /^(男|女|男性|女性)$/.test(value))
}

function looksCutOffHeader(header: string) {
  var text = compactHeader(header)
  if (!text) return true
  if (/[…⋯]|\.{2,}$/.test(text)) return true
  if (/^第?\d+列$/.test(text)) return true
  if (/^col(?:umn)?\d+$/i.test(text)) return true
  return false
}

function isTruncatedSibling(header: string, allHeaders: string[]) {
  var current = compactHeader(header)
  if (!current || current.length < 1) return false
  return allHeaders.some((other) => {
    var candidate = compactHeader(other)
    if (!candidate || candidate === current) return false
    return candidate.startsWith(current) && candidate.length >= current.length + 1
  })
}

function valuesLookIncomplete(values: string[]) {
  var filled = values.map((value) => String(value ?? '').trim()).filter(cellFilled)
  if (!filled.length) return true
  var broken = filled.filter((value) => /[…⋯]\s*$|\.{2,}$/.test(value) || /^[^\d]{1}$/.test(value))
  return broken.length >= Math.ceil(filled.length * 0.6)
}

function hasIncompleteValues(values: string[]) {
  var filled = values.filter(cellFilled)
  if (!filled.length) return true
  var broken = filled.filter((value) => /[…⋯]\s*$|\.{2,}$/.test(value))
  return broken.length > 0
}

function fillRate(values: string[]) {
  if (!values.length) return 0
  return values.filter(cellFilled).length / values.length
}

function median(numbers: number[]) {
  if (!numbers.length) return 0
  var sorted = [...numbers].sort((a, b) => a - b)
  var middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * 丢掉截断表头、空列、以及明显没读全的残缺列。
 * @param columns OCR 表头
 * @param rows 等长数据行
 * @return 去掉残缺列后的表
 */
export function dropIncompleteOcrColumns(columns: string[], rows: string[][]) {
  var headers = Array.isArray(columns) ? columns.map((column) => String(column ?? '')) : []
  var matrix = Array.isArray(rows) ? rows.map((row) => headers.map((_, index) => String((row && row[index]) ?? ''))) : []
  if (!headers.length) return { columns: [], rows: [] }

  var rates = headers.map((_, index) => fillRate(matrix.map((row) => row[index] || '')))
  var typicalFill = median(rates.filter((rate) => rate > 0))
  var keep = headers.map((header, index) => {
    var values = matrix.map((row) => row[index] || '')
    var rate = rates[index]
    var hasId = values.some((value) => looksLikeIdValue(value))
    if (isIdHeader(header) && hasId) return true
    if (isMostlyFeeType(values)) return false
    if (isMostlyGender(values)) return false
    if (looksCutOffHeader(header)) return false
    if (isTruncatedSibling(header, headers)) return false
    if (rate === 0) return false
    if (hasIncompleteValues(values) && !hasId) return false
    if (valuesLookIncomplete(values) && rate < 0.85 && !hasId) return false
    if (typicalFill >= 0.6 && rate < 0.5 && !hasId) return false
    return true
  })

  var nextColumns = headers.filter((_, index) => keep[index])
  var nextRows = matrix
    .map((row) => row.filter((_, index) => keep[index]))
    .filter((row) => row.some(cellFilled))
  return { columns: nextColumns, rows: nextRows }
}
