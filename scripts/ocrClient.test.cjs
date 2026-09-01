const test = require('node:test')
const assert = require('node:assert/strict')
const { parseOcrContent } = require('../electron/ocrClient.cjs')
const { parseOcrContent: parseExeOcrContent } = require('../exe/electron/ocrClient.cjs')

test('desktop OCR client repairs missing commas between table rows', () => {
  const result = parseOcrContent('{"table":{"columns":["姓名","住院号"],"rows":[["杨旭","376813"]["李四","009281"]]}}')
  assert.deepEqual(result.table.columns, ['姓名', '住院号'])
  assert.deepEqual(result.table.rows, [['杨旭', '376813'], ['李四', '009281']])
})

test('desktop OCR client repairs adjacent strings and returns empty table for junk JSON', () => {
  const adjacent = parseOcrContent('{"table":{"columns":["A","B"],"rows":[["x""y"]]}}')
  assert.deepEqual(adjacent.table.rows, [['x', 'y']])
  const junk = parseOcrContent('not json at all {]')
  assert.deepEqual(junk.table.columns, [])
  assert.deepEqual(junk.table.rows, [])
})

test('desktop OCR prompt keeps left columns from the first image', () => {
  const { buildOcrPrompt } = require('../electron/ocrClient.cjs')
  const prompt = buildOcrPrompt()
  assert.match(prompt, /左侧列禁止整列留空/)
  assert.match(prompt, /姓名、住院号、日期、主管\/参观以第一张完整表格为准/)
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/ocrClient.cjs'), 'utf8')
  assert.match(source, /禁止因第二张图裁切而清空左侧列/)
})

test('exe OCR client uses the same JSON repair', () => {
  const result = parseExeOcrContent('{"table":{"columns":["姓名","住院号"],"rows":[["杨旭","376813"]["李四","009281"]]}}')
  assert.deepEqual(result.table.rows, [['杨旭', '376813'], ['李四', '009281']])
})
