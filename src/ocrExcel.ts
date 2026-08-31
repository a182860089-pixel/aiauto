import ExcelJS from 'exceljs'
import {
  ALL_CATEGORIES,
  inferPatientRow,
  mapClassifiedRowToTemplateRow,
  type ClassifiedPatientRow,
  type PatientCategory,
} from './smartClassifier'
import { TEMPLATE_COLUMNS } from './templateMapping'

function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    var record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
    if (Array.isArray(record.richText)) return record.richText.map((part) => String(part.text || '')).join('').trim()
    if (record.text != null) return String(record.text).trim()
    if (record.result != null) return cellText(record.result)
  }
  return String(value).trim()
}

/**
 * 触发浏览器下载 ArrayBuffer。
 * @param buffer Excel 二进制内容
 * @param fileName 下载文件名
 * @return 无
 */
export function downloadBuffer(buffer: ArrayBuffer, fileName: string) {
  var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  var url = URL.createObjectURL(blob)
  var link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * 将五类分类好的患者数据导出为规范的 16 列 Excel
 */
export async function exportClassifiedRowsToExcel(
  rows: ClassifiedPatientRow[],
  fileName: string = '五类病种合并登记表',
  templateDataUrl?: string,
) {
  var checkedRows = rows.filter((r) => r.checked)
  if (checkedRows.length === 0) {
    throw new Error('没有选中的记录可导出')
  }

  var workbook = new ExcelJS.Workbook()
  if (templateDataUrl) {
    var base64 = String(templateDataUrl).split(',').pop() || ''
    var binary = atob(base64)
    var bytes = Uint8Array.from([...binary].map((char) => char.charCodeAt(0)))
    await workbook.xlsx.load(bytes.buffer)
  }

  var worksheet = workbook.worksheets[0]
  if (!worksheet) {
    worksheet = workbook.addWorksheet('五类合并记录')
    // 写入标准 16 列表头
    var headerRow = worksheet.addRow(TEMPLATE_COLUMNS)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
    headerRow.height = 24
  }

  // 映射并添加数据行
  checkedRows.forEach((item) => {
    var mappedValues = mapClassifiedRowToTemplateRow(item)
    var newRow = worksheet.addRow(mappedValues)
    newRow.alignment = { vertical: 'top', wrapText: true }
  })

  // 调整列宽
  TEMPLATE_COLUMNS.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = Math.max(14, col.length * 2.5 + 4)
  })

  var buffer = await workbook.xlsx.writeBuffer()
  downloadBuffer(buffer as ArrayBuffer, fileName)

  return {
    rowCount: checkedRows.length,
    fileName: `${fileName}.xlsx`,
  }
}

/**
 * 读取已导出的 16 列合并表，还原为可预览、可填入的分类行。
 */
export async function parseClassifiedRowsFromExcel(dataUrl: string, fileName: string): Promise<ClassifiedPatientRow[]> {
  var workbook = new ExcelJS.Workbook()
  var base64 = String(dataUrl).split(',').pop() || ''
  var binary = atob(base64)
  var bytes = Uint8Array.from([...binary].map((char) => char.charCodeAt(0)))
  await workbook.xlsx.load(bytes.buffer)
  var worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  var columns: string[] = []
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    columns[colNumber - 1] = cellText(cell.value)
  })
  if (!columns.some(Boolean)) columns = [...TEMPLATE_COLUMNS]

  var rows: ClassifiedPatientRow[] = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    var source: Record<string, string> = {}
    columns.forEach((column, index) => {
      if (!column) return
      source[column] = cellText(row.getCell(index + 1).value)
    })
    if (!Object.values(source).some(Boolean)) return
    var classified = inferPatientRow(source, fileName, source['所在科室'] || '', rowNumber - 2)
    classified.id = `xlsx-${rowNumber}-${classified.patientName || 'row'}`
    classified.checked = true
    var category = source['记录类别'] as PatientCategory
    if (ALL_CATEGORIES.includes(category) || category === '未分类') classified.category = category
    rows.push(classified)
  })
  return rows
}
