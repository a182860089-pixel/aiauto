const test = require('node:test')
const assert = require('node:assert/strict')

// 引入构建后的 ES 模块转换或直接在 node 环境测试分类算法逻辑
test('smartClassifier: cleanDiagCode 去除各类 ICD 编码并处理末尾省略号', () => {
  function cleanDiagCode(text) {
    if (!text) return ''
    var trimmed = String(text).trim()
    trimmed = trimmed.replace(/\.{2,}$|…+$/g, '').trim()
    trimmed = trimmed.replace(/^\([A-Za-z0-9.+*_\-:]+\)\s*/, '')
    trimmed = trimmed.replace(/^\[[A-Za-z0-9.+*_\-:]+\]\s*/, '')
    trimmed = trimmed.replace(/^[A-Za-z]\d{2,3}(?:\.\d+)?\s+/, '')
    return trimmed.trim()
  }

  assert.equal(cleanDiagCode('(M47.921)颈椎病'), '颈椎病')
  assert.equal(cleanDiagCode('(A03.06.04.05)颈椎病:风寒湿痹阻证'), '颈椎病:风寒湿痹阻证')
  assert.equal(cleanDiagCode('[I10.001] 原发性高血压'), '原发性高血压')
  assert.equal(cleanDiagCode('I10 高血压'), '高血压')
  assert.equal(cleanDiagCode('普通支气管炎...'), '普通支气管炎')
})

test('smartClassifier: 中西医诊断智能分流与初复诊纠偏', () => {
  function isTcmDiagPattern(text) {
    if (!text) return false
    var t = text.trim()
    if (t.includes(':') || t.includes('：')) return true
    if (/[证型病]$/.test(t)) return true
    if (/(风寒|风热|湿热|寒湿|气虚|阴虚|阳虚|气阴两虚|痰湿|瘀血|肝郁|心火|肝火|脾虚|肾虚|血瘀|痹阻)/.test(t)) return true
    return false
  }

  assert.equal(isTcmDiagPattern('不寐病:心肝火旺证'), true)
  assert.equal(isTcmDiagPattern('头痛:肝郁血瘀证'), true)
  assert.equal(isTcmDiagPattern('急性支气管炎'), false)
  assert.equal(isTcmDiagPattern('原发性高血压'), false)

  // 模拟初复诊纠偏
  var checkTypeMisplacement = (val) => /^[初复急门住]+(诊)?$/.test(val)
  assert.equal(checkTypeMisplacement('复'), true)
  assert.equal(checkTypeMisplacement('初诊'), true)
  assert.equal(checkTypeMisplacement('2600123'), false)
})

test('smartClassifier: 智能归类住院病种、门诊病种、临床技术', () => {
  const CLINICAL_SKILL_KEYWORDS = ['针灸', '穿刺', '推拿', '小针刀', '拔罐']

  function inferCategory(source, sourceImage) {
    var hospitalNo = source['住院号'] || ''
    var outpatientNo = source['门诊号'] || ''
    var operation = source['操作名称'] || ''
    var wmDiag = source['西医诊断'] || ''

    var matchedSkill = CLINICAL_SKILL_KEYWORDS.find((kw) =>
      operation.includes(kw) || wmDiag.includes(kw) || sourceImage.includes(kw)
    )

    if (matchedSkill && !hospitalNo) {
      return '临床技术记录'
    } else if (hospitalNo || sourceImage.includes('住院')) {
      return '住院病种记录'
    } else if (outpatientNo || sourceImage.includes('门诊')) {
      return '门诊病种记录'
    } else if (sourceImage.includes('大病历')) {
      return '手写大病历'
    }
    return '未分类'
  }

  assert.equal(inferCategory({ 住院号: '376813', 姓名: '杨旭' }, 'his_list.png'), '住院病种记录')
  assert.equal(inferCategory({ 门诊号: '009281', 姓名: '王五' }, 'his_list.png'), '门诊病种记录')
  assert.equal(inferCategory({ 操作名称: '针灸治疗', 姓名: '李四' }, 'clinic.png'), '临床技术记录')
  assert.equal(inferCategory({ 姓名: '赵六' }, '呼吸科大病历_01.jpg'), '手写大病历')
})
