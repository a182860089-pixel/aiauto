import assert from 'node:assert/strict'
import test from 'node:test'
import { dropIncompleteOcrColumns } from '../src/ocrColumns.ts'

test('drops empty and truncated sibling columns', () => {
  const result = dropIncompleteOcrColumns(
    ['姓名', '住院号', '西医诊断', '西', '中医诊断…', ''],
    [
      ['张三', '10001', '(M47.921)颈椎病', '颈', '风寒…', ''],
      ['李四', '10002', '(I10.001)高血压', '高', '…', ''],
    ],
  )
  assert.deepEqual(result.columns, ['姓名', '住院号', '西医诊断'])
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows[0], ['张三', '10001', '(M47.921)颈椎病'])
})

test('keeps short alias column when it is the only filled diagnosis column', () => {
  const result = dropIncompleteOcrColumns(
    ['姓名', '中医诊'],
    [
      ['张三', '颈椎病:风寒湿痹阻证'],
      ['李四', '腰痛:肾虚'],
    ],
  )
  assert.deepEqual(result.columns, ['姓名', '中医诊'])
})

test('drops a mostly empty leftover column', () => {
  const result = dropIncompleteOcrColumns(
    ['姓名', '科室', 'X'],
    [
      ['张三', '通州呼吸科二区', ''],
      ['李四', '通州脑病科一区', '…'],
      ['王五', '通州心血管一区', ''],
    ],
  )
  assert.deepEqual(result.columns, ['姓名', '科室'])
})

test('drops a column when any populated cell is visibly truncated', () => {
  const result = dropIncompleteOcrColumns(
    ['姓名', '西医诊断', '备注'],
    [
      ['张三', '颈椎病…', '正常'],
      ['李四', '高血压', '正常'],
    ],
  )
  assert.deepEqual(result.columns, ['姓名', '备注'])
  assert.deepEqual(result.rows, [['张三', '正常'], ['李四', '正常']])
})

test('keeps 登记号 and drops 费别/性别', () => {
  const result = dropIncompleteOcrColumns(
    ['姓名', '性别', '登记号', '就诊科室', '诊断', '病历号', '费别'],
    [
      ['张正绮', '女', '0003437114', '眼科门诊', '1.睑腺炎[麦粒肿] 确诊', '异地医保', '异地医保'],
      ['刘潇航', '男', '0003178883', '眼科门诊', '1.睑板腺功能障碍 确诊', '医保', '医保'],
    ],
  )
  assert.deepEqual(result.columns, ['姓名', '登记号', '就诊科室', '诊断'])
  assert.deepEqual(result.rows[0], ['张正绮', '0003437114', '眼科门诊', '1.睑腺炎[麦粒肿] 确诊'])
})
