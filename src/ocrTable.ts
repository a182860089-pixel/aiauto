export type PreviewTable = {
  columns: string[]
  rows: string[][]
}

/**
 * 把一行 OCR 数据转成字符串数组。
 * @param row 行数据
 * @param columns 列名
 * @return 单元格文本
 */
function rowToValues(row: Record<string, string> | string[], columns: string[]) {
  if (Array.isArray(row)) return row.map((value) => String(value ?? ''))
  if (columns.length) return columns.map((column) => String(row[column] ?? ''))
  return Object.values(row).map((value) => String(value ?? ''))
}

/**
 * 从完整文字里尝试解析 Markdown / 竖线表格。
 * @param rawText OCR 原文
 * @return 解析出的表格，没有则返回空
 */
function tableFromRawText(rawText: string): PreviewTable {
  var lines = String(rawText || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('|'))
  var dataLines = lines.filter((line) => !/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, '')))
  var parsed = dataLines.map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
  if (parsed.length < 2) return { columns: [], rows: [] }
  return { columns: parsed[0], rows: parsed.slice(1) }
}

/**
 * 整理成结果区可预览的表格。
 * @param result OCR 结果
 * @return 预览表格
 */
export function buildPreviewTable(result: OcrResult | null): PreviewTable {
  if (!result) return { columns: [], rows: [] }
  var columns = result.table?.columns?.map(String).filter(Boolean) || []
  var sourceRows = result.table?.rows || []
  if (sourceRows.length) {
    if (!columns.length) {
      var firstRow = sourceRows[0]
      columns = Array.isArray(firstRow)
        ? firstRow.map((_, index) => `第${index + 1}列`)
        : Object.keys(firstRow || {})
    }
    return { columns, rows: sourceRows.map((row) => rowToValues(row, columns)) }
  }
  return tableFromRawText(String(result.rawText || ''))
}