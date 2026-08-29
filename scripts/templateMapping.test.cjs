const test = require('node:test')
const assert = require('node:assert/strict')
const { mapOcrRowsToTemplate, mapSelectedOcrRowsToTemplate, getManualOverrideError, requireManualOverrides } = require('../electron/templateMapping.cjs')

const headers = ['记录类别', '所在科室', '病人姓名', '住院号', '中医诊断', '西医诊断', '主管/参观', '住院日期', '就诊日期', '初诊/复诊', '病历号', '操作日期', '操作名称', '日期', '备注', '图片文件']

test('只映射明确别名，保留模板列数', () => {
  const result = mapOcrRowsToTemplate(
    ['是否备案', '住院号', '姓名', '入院日期', '身份证号', '地址'],
    [['已备案', '376813', '杨旭', '2026-06-01', '22058119920109366X', '辽宁省大连市']],
    headers,
  )
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].length, headers.length)
  assert.equal(result.rows[0][2], '杨旭')
  assert.equal(result.rows[0][3], '376813')
  assert.equal(result.rows[0][7], '2026-06-01')
  assert.equal(result.rows[0][0], '')
  assert.equal(result.rows[0][8], '')
  assert.deepEqual(result.ignoredColumns, ['是否备案', '身份证号', '地址'])
})

test('字段为空时不生成空记录', () => {
  const result = mapOcrRowsToTemplate(['姓名', '住院号'], [['', '']], headers)
  assert.equal(result.rows.length, 0)
})

test('支持规范化字段名', () => {
  const result = mapOcrRowsToTemplate([' patientName ', 'admissionDate'], [['张三', '2026-08-01']], headers)
  assert.equal(result.rows[0][2], '张三')
  assert.equal(result.rows[0][7], '2026-08-01')
})

test('人工覆盖写入记录类别和所在科室', () => {
  const result = mapOcrRowsToTemplate(
    ['姓名', '住院号', '入院日期'],
    [['杨旭', '376813', '2026-06-01']],
    headers,
    { 记录类别: '住院病种记录', 所在科室: '通州呼吸科二区' },
  )
  assert.equal(result.rows[0][0], '住院病种记录')
  assert.equal(result.rows[0][1], '通州呼吸科二区')
  assert.equal(result.rows[0][2], '杨旭')
  assert.deepEqual(result.matchedColumns.slice(0, 4), ['记录类别', '所在科室', '病人姓名', '住院号'])
})

test('OCR 已有科室时不覆盖人工值', () => {
  const result = mapOcrRowsToTemplate(
    ['姓名', '科室'],
    [['杨旭', '心内科']],
    headers,
    { 记录类别: '住院病种记录', 所在科室: '通州呼吸科二区' },
  )
  assert.equal(result.rows[0][0], '住院病种记录')
  assert.equal(result.rows[0][1], '心内科')
})

test('只导出勾选行并写入类别', () => {
  const result = mapSelectedOcrRowsToTemplate(
    ['姓名', '住院号'],
    [['杨旭', '376813'], ['王海鸥', '304971'], ['李卫华', '369379']],
    [0, 2],
    headers,
    { 记录类别: '住院病种记录', 所在科室: '通州呼吸科二区' },
  )
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0][0], '住院病种记录')
  assert.equal(result.rows[0][2], '杨旭')
  assert.equal(result.rows[1][2], '李卫华')
})

test('未选择记录类别或科室时拦截', () => {
  assert.equal(getManualOverrideError({}), '请先选择记录类别')
  assert.equal(getManualOverrideError({ 记录类别: '住院病种记录' }), '请先选择或输入所在科室')
  assert.throws(() => requireManualOverrides({}), /请先选择记录类别/)
})
