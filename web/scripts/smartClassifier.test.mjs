import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateTcmFromWestern,
  inferPatientRow,
  looksLikeTimeOrStatus,
  resolveMixedDiagnoses,
  splitCombinedHisDiagnosis,
  splitDiagnosisItems,
} from '../src/smartClassifier.ts'

function row(source) {
  return inferPatientRow(source, 'his.png', '眼科门诊', 0)
}

test('rejects bare visit time as diagnosis', () => {
  assert.equal(looksLikeTimeOrStatus('10:54'), true)
  assert.equal(looksLikeTimeOrStatus('13:27'), true)
  assert.equal(looksLikeTimeOrStatus('睑板腺功能障碍'), false)
})

test('splits numbered HIS diagnosis items', () => {
  assert.deepEqual(
    splitDiagnosisItems('1.睑腺炎[麦粒肿] 确诊2.针眼 确诊3.肝热证 确诊'),
    ['睑腺炎[麦粒肿]', '针眼', '肝热证'],
  )
})

test('keeps existing (西)/(中) splitter', () => {
  const split = splitCombinedHisDiagnosis('(西)关节痛,(中)关节痛(风寒湿痹阻证)')
  assert.equal(split.wm, '关节痛')
  assert.equal(split.tcm, '关节痛(风寒湿痹阻证)')
  const rowResult = row({
    姓名: '测试',
    主要诊断名称: '(西)关节痛,(中)关节痛(风寒湿痹阻证)',
  })
  assert.equal(rowResult.wmDiag, '关节痛')
  assert.equal(rowResult.tcmDiag, '关节痛(风寒湿痹阻证)')
})

test('extracts western dx and composes HIS TCM disease:syndrome', () => {
  const zhang = row({
    病人姓名: '张正绮',
    住院号: '0003437114',
    中医诊断: '1.睑腺炎[麦粒肿] 确诊2.针眼 确诊3.肝热证 确诊',
    西医诊断: '',
  })
  assert.equal(zhang.wmDiag, '睑腺炎[麦粒肿]')
  assert.equal(zhang.tcmDiag, '针眼:肝热证')

  const fang = row({
    病人姓名: '方泳锜',
    住院号: '0001111111',
    中医诊断: '1.变应性结膜炎[免疫性结膜炎] 确诊2.过敏性鼻炎[变应性鼻炎] 确诊3.时复目痒 确诊4.风热犯目证 确诊',
  })
  assert.equal(fang.wmDiag, '变应性结膜炎[免疫性结膜炎]，过敏性鼻炎[变应性鼻炎]')
  assert.equal(fang.tcmDiag, '时复目痒:风热犯目证')

  const zhao = row({
    病人姓名: '赵秉枝',
    住院号: '0002222222',
    中医诊断: '1.丝状角膜炎 确诊2.角膜损伤 确诊3.结膜炎 确诊4.凝脂翳 确诊5.风热犯目证 确诊',
  })
  assert.equal(zhao.wmDiag, '丝状角膜炎，角膜损伤，结膜炎')
  assert.equal(zhao.tcmDiag, '凝脂翳:风热犯目证')

  const hou = row({
    病人姓名: '侯安娜',
    住院号: '0003333333',
    中医诊断: '1.干眼症 确诊2.白涩症 确诊3.肝阴虚证 确诊4.角膜损伤 确诊',
  })
  assert.equal(hou.wmDiag, '干眼症，角膜损伤')
  assert.equal(hou.tcmDiag, '白涩症:肝阴虚证')
})

test('generates TCM when western exists and TCM is missing or a timestamp', () => {
  const liu = row({
    病人姓名: '刘潇航',
    住院号: '0003178883',
    中医诊断: '10:54',
    西医诊断: '1.睑板腺功能障碍 确诊',
  })
  assert.equal(liu.tcmDiag, '白涩症:脾胃湿热证')
  assert.equal(liu.wmDiag, '睑板腺功能障碍')

  const cataract = row({
    病人姓名: '白内障患者',
    住院号: '0004444444',
    中医诊断: '14:06',
    西医诊断: '1.白内障 确诊',
  })
  assert.equal(cataract.wmDiag, '白内障')
  assert.equal(cataract.tcmDiag, '圆翳内障:肝肾阴虚证')

  assert.equal(generateTcmFromWestern('干眼症'), '白涩症:肝阴虚证')
  assert.equal(generateTcmFromWestern('屈光不正'), '能近怯远:肝肾不足证')
})

test('does not smash already-split ICD TCM/WM pair', () => {
  const result = row({
    姓名: '旧格式',
    中医诊断: '(A03.06.04.05)颈椎病:风寒湿痹阻证',
    西医诊断: '(M47.921)颈椎病',
  })
  assert.equal(result.tcmDiag, '颈椎病:风寒湿痹阻证')
  assert.equal(result.wmDiag, '颈椎病')
})

test('splits mixed general diagnosis instead of dumping it into TCM', () => {
  const result = row({
    姓名: '混写',
    诊断: '1.睑腺炎[麦粒肿] 确诊2.针眼 确诊3.肝热证 确诊',
  })
  assert.equal(result.wmDiag, '睑腺炎[麦粒肿]')
  assert.equal(result.tcmDiag, '针眼:肝热证')
})

test('resolveMixedDiagnoses keeps generated fallback when no TCM names exist', () => {
  const resolved = resolveMixedDiagnoses('', '1.结膜炎 确诊2.角膜损伤 确诊', '')
  assert.equal(resolved.wm, '结膜炎，角膜损伤')
  assert.equal(resolved.tcm, '暴风客热:风热犯目证')
})
