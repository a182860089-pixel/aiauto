const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const ExcelJS = require('exceljs')
const { writeOcrWorkbook } = require('../electron/excelExporter.cjs')

test('导出时保留模板表头和原有数据行', async () => {
  const outputPath = path.join(os.tmpdir(), `aiauto-excel-${Date.now()}.xlsx`)
  try {
    const result = await writeOcrWorkbook({
      table: {
        columns: ['是否备案', '住院号', '姓名', '入院日期', '身份证号', '地址'],
        rows: [['已备案', '376813', '杨旭', '2026-06-01', '22058119920109366X', '辽宁省大连市']],
      },
    }, outputPath)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(outputPath)
    const sheet = workbook.worksheets[0]
    assert.equal(result.rowCount, 1)
    assert.equal(sheet.columnCount, 16)
    assert.equal(sheet.rowCount, 17)
    assert.equal(sheet.getCell(1, 1).value, '记录类别')
    assert.equal(sheet.getCell(1, 16).value, '图片文件')
    assert.equal(sheet.getCell(17, 3).value, '杨旭')
    assert.equal(sheet.getCell(17, 4).value, '376813')
    assert.equal(sheet.getCell(17, 8).value, '2026-06-01')
    assert.equal(sheet.getCell(17, 1).value, '')
    assert.deepEqual(result.ignoredColumns, ['是否备案', '身份证号', '地址'])
  } finally {
    await fs.rm(outputPath, { force: true })
  }
})

test('导出时写入人工选择的记录类别和所在科室', async () => {
  const outputPath = path.join(os.tmpdir(), `aiauto-excel-override-${Date.now()}.xlsx`)
  try {
    await writeOcrWorkbook({
      table: {
        columns: ['住院号', '姓名', '入院日期'],
        rows: [['376813', '杨旭', '2026-06-01']],
      },
    }, outputPath, undefined, { 记录类别: '住院病种记录', 所在科室: '通州呼吸科二区' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(outputPath)
    const sheet = workbook.worksheets[0]
    assert.equal(sheet.getCell(17, 1).value, '住院病种记录')
    assert.equal(sheet.getCell(17, 2).value, '通州呼吸科二区')
    assert.equal(sheet.getCell(17, 3).value, '杨旭')
  } finally {
    await fs.rm(outputPath, { force: true })
  }
})
