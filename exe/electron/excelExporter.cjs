var ExcelJS = require('exceljs')
var fs = require('node:fs')
var path = require('node:path')
var { mapOcrRowsToTemplate, mapSelectedOcrRowsToTemplate } = require('./templateMapping.cjs')

var TEMPLATE_PATH = path.join(__dirname, 'GP自动录入助手_五类合并测试样例.xlsx')

/**
 * 将 OCR 响应整理成列名和全部数据行。
 * @param {{ table?: { columns?: string[], rows?: Array<Record<string, unknown>|unknown[]> }, fields?: Record<string, unknown>, rawText?: string }} result OCR 结果
 * @return {{ columns: string[], rows: Record<string, string>[] }} 表格数据
 */
function normalizeOcrTable(result) {
  var table = result?.table || {}
  var sourceRows = Array.isArray(table.rows) ? table.rows : []
  var columns = Array.isArray(table.columns) ? table.columns.map(String).filter(Boolean) : []
  if (columns.length === 0 && sourceRows.length > 0) {
    columns = [...new Set(sourceRows.flatMap((row) => Array.isArray(row) ? [] : Object.keys(row || {})))]
  }
  if (columns.length > 0) {
    var rows = sourceRows.map((row) => {
      var values = Array.isArray(row) ? row : columns.map((column) => row?.[column])
      return Object.fromEntries(columns.map((column, index) => [column, String(values[index] ?? '')]))
    })
    return { columns, rows }
  }
  var fields = result?.fields && typeof result.fields === 'object' ? result.fields : {}
  if (Object.keys(fields).length > 0) {
    var fieldColumns = Object.keys(fields)
    return { columns: fieldColumns, rows: [Object.fromEntries(fieldColumns.map((field) => [field, String(fields[field] ?? '')]))] }
  }
  var fieldRows = Object.entries(fields).map(([field, value]) => ({ 字段: field, 识别内容: String(value ?? '') }))
  if (fieldRows.length === 0 && String(result?.rawText || '').trim()) fieldRows.push({ 字段: '完整内容', 识别内容: String(result.rawText).trim() })
  return { columns: ['字段', '识别内容'], rows: fieldRows }
}

/**
 * 设置表头、冻结行和适合查看的列宽。
 * @param {import('exceljs').Worksheet} worksheet Excel 工作表
 * @param {string[]} columns 列名
 * @return {void}
 */
function styleWorksheet(worksheet, columns) {
  var headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 24
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  columns.forEach((column, index) => {
    var values = worksheet.getColumn(index + 1).values.slice(1).map((value) => String(value ?? ''))
    var contentWidth = values.reduce((width, value) => Math.max(width, value.length), String(column).length)
    worksheet.getColumn(index + 1).width = Math.min(Math.max(contentWidth + 3, 12), 42)
  })
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.alignment = { vertical: 'top', wrapText: true }
  })
}

/**
 * 读取用户上传的模板，或读取随应用提供的默认模板。
 * @param {string|undefined} templateDataUrl 用户上传的模板 Data URL
 * @return {Promise<import('exceljs').Workbook>} Excel 工作簿
 */
async function loadTemplateWorkbook(templateDataUrl) {
  var workbook = new ExcelJS.Workbook()
  if (templateDataUrl) {
    var base64 = String(templateDataUrl).split(',').pop()
    await workbook.xlsx.load(Buffer.from(base64, 'base64'))
    return workbook
  }
  if (fs.existsSync(TEMPLATE_PATH)) await workbook.xlsx.readFile(TEMPLATE_PATH)
  return workbook
}

/**
 * 将 OCR 结果写入用户模板的全部数据行。
 * @param {{ table?: { columns?: string[], rows?: Array<Record<string, unknown>|unknown[]> }, fields?: Record<string, unknown>, rawText?: string }} result OCR 结果
 * @param {string} outputPath 输出路径
 * @param {string|undefined} templateDataUrl 用户上传的模板 Data URL
 * @return {Promise<{ outputPath: string, rowCount: number, columnCount: number, matchedColumns: string[], ignoredColumns: string[], usedTemplate: boolean }>} 导出信息
 */
async function writeOcrWorkbook(result, outputPath, templateDataUrl, overrides, selectedIndexes) {
  var { columns, rows } = normalizeOcrTable(result)
  if (rows.length === 0) throw new Error('OCR 结果中没有可导出的内容')
  var workbook = await loadTemplateWorkbook(templateDataUrl)
  var worksheet
  var usedTemplate = Boolean(templateDataUrl) || fs.existsSync(TEMPLATE_PATH)
  if (usedTemplate) {
    worksheet = workbook.worksheets[0] || workbook.addWorksheet('OCR识别结果')
    var templateColumns = worksheet.getRow(1).values.slice(1).map((value) => String(value ?? '').trim())
    var sourceRows = rows.length ? rows : [Object.assign({}, result?.fields || {})]
    var sourceColumns = columns.length ? columns : Object.keys(sourceRows[0] || {})
    var mapped = Array.isArray(selectedIndexes)
      ? mapSelectedOcrRowsToTemplate(sourceColumns, sourceRows, selectedIndexes, templateColumns, overrides)
      : mapOcrRowsToTemplate(sourceColumns, sourceRows, templateColumns, overrides)
    if (!mapped.rows.length) throw new Error('OCR 结果没有可对应模板的非空字段')
    var styleSource = worksheet.getRow(Math.max(2, worksheet.rowCount))
    mapped.rows.forEach((outputRow) => {
      var target = worksheet.addRow(outputRow)
      target.height = styleSource.height
      target.eachCell((cell, columnNumber) => {
        var sourceCell = styleSource.getCell(columnNumber)
        cell.style = { ...sourceCell.style }
        cell.alignment = { vertical: 'top', wrapText: true }
      })
    })
    await workbook.xlsx.writeFile(outputPath)
    return {
      outputPath,
      rowCount: mapped.rows.length,
      columnCount: worksheet.columnCount,
      matchedColumns: mapped.matchedColumns,
      ignoredColumns: mapped.ignoredColumns,
      usedTemplate,
    }
  } else {
    worksheet = workbook.addWorksheet('OCR识别结果')
    worksheet.addRow(columns)
    rows.forEach((row) => worksheet.addRow(columns.map((column) => row[column] ?? '')))
    styleWorksheet(worksheet, columns)
  }
  await workbook.xlsx.writeFile(outputPath)
  return { outputPath, rowCount: rows.length, columnCount: worksheet.columnCount, matchedColumns: columns, ignoredColumns: [], usedTemplate }
}

module.exports = { normalizeOcrTable, writeOcrWorkbook }
