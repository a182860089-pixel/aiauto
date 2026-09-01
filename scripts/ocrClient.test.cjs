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

test('exe OCR client uses the same JSON repair', () => {
  const result = parseExeOcrContent('{"table":{"columns":["姓名","住院号"],"rows":[["杨旭","376813"]["李四","009281"]]}}')
  assert.deepEqual(result.table.rows, [['杨旭', '376813'], ['李四', '009281']])
})
