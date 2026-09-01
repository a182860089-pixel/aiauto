const test = require('node:test')
const assert = require('node:assert/strict')

// 引入构建后的 ES 模块转换或直接在 node 环境测试分类算法逻辑
test('smartClassifier: cleanDiagCode 去除各类 ICD 编码并处理末尾省略号', () => {
  function cleanDiagCode(text) {
    if (!text) return ''
    var trimmed = String(text).trim()
    if (['图片未识别', '未识别'].includes(trimmed.replace(/\s+/g, ''))) return ''
    trimmed = trimmed.replace(/\.{2,}$|…+$/g, '').trim()
    var original = trimmed
    trimmed = trimmed.replace(/^[（(]\s*[A-Za-z][A-Za-z0-9.+*_\-:xX]+\s*[）)]\s*/, '')
    trimmed = trimmed.replace(/^[\[【]\s*[A-Za-z][A-Za-z0-9.+*_\-:xX]+\s*[\]】]\s*/, '')
    trimmed = trimmed.replace(/^[A-Za-z]\d{2,3}(?:\.[0-9A-Za-z]+)?(?:xx\d+)?\s+/, '')
    if (trimmed.trim()) return trimmed.trim()
    var chinese = original.replace(/[A-Za-z0-9.+*_\-:xX（()）\[\]【】\s]/g, '').trim()
    return chinese || original
  }

  assert.equal(cleanDiagCode('(M47.921)颈椎病'), '颈椎病')
  assert.equal(cleanDiagCode('(A03.06.04.05)颈椎病:风寒湿痹阻证'), '颈椎病:风寒湿痹阻证')
  assert.equal(cleanDiagCode('[I10.001] 原发性高血压'), '原发性高血压')
  assert.equal(cleanDiagCode('I10 高血压'), '高血压')
  assert.equal(cleanDiagCode('普通支气管炎...'), '普通支气管炎')
  assert.equal(cleanDiagCode('（G47.001）失眠'), '失眠')
  assert.equal(cleanDiagCode('(M47.921)'), '(M47.921)')
  assert.equal(cleanDiagCode('(R91xx03)肺诊断性影像异常'), '肺诊断性影像异常')
})

test('smartClassifier: 中西医诊断智能分流与初复诊纠偏', () => {
  function isTcmDiagPattern(text) {
    if (!text) return false
    var t = text.trim()
    if (t.includes(':') || t.includes('：')) return true
    if (/(证|证型|证候|型)$/.test(t)) return true
    if (/(风寒|风热|湿热|寒湿|气虚|阴虚|阳虚|气阴两虚|痰湿|瘀血|肝郁|心火|肝火|脾虚|肾虚|血瘀|痹阻)/.test(t)) return true
    return false
  }

    assert.equal(isTcmDiagPattern('不寐病:心肝火旺证'), true)
  assert.equal(isTcmDiagPattern('头痛:肝郁血瘀证'), true)
  assert.equal(isTcmDiagPattern('急性支气管炎'), false)
  assert.equal(isTcmDiagPattern('原发性高血压'), false)
  assert.equal(isTcmDiagPattern('冠心病'), false)
  assert.equal(isTcmDiagPattern('糖尿病'), false)

  // 模拟初复诊纠偏
  var checkTypeMisplacement = (val) => /^[初复急门住]+(诊)?$/.test(val)
  assert.equal(checkTypeMisplacement('复'), true)
  assert.equal(checkTypeMisplacement('初诊'), true)
  assert.equal(checkTypeMisplacement('2600123'), false)
})

test('smartClassifier: 记录类别只接受图片明确列，号码和诊断保持对应列', () => {
  const source = {
    挂号单: '260012345678',
    门诊号: '99115370422',
    姓名: '李某某',
    中医诊: '颈痹病：风寒湿痹阻证',
    西医诊: '颈椎病',
  }
  const getVal = (aliases) => {
    const key = Object.keys(source).find((candidate) => aliases.includes(candidate))
    return key ? String(source[key]).trim() : ''
  }
  const outpatientNo = getVal(['门诊号', '门诊号码', 'outpatientNo'])
  const medicalRecordNo = getVal(['病历号', '病案号', '病案编号', 'medicalRecordNo'])
  const tcmDiag = getVal(['中医诊断', '中医诊', '中医病名', 'tcmDiag'])
  const wmDiag = getVal(['西医诊断', '西医诊', '西医病名', 'wmDiag'])
  const category = getVal(['记录类别', '记录类型', '病种类别', '业务类别'])

  assert.equal(outpatientNo, '99115370422')
  assert.equal(medicalRecordNo, '')
  assert.equal(tcmDiag, '颈痹病：风寒湿痹阻证')
  assert.equal(wmDiag, '颈椎病')
  assert.equal(category, '')
  assert.notEqual(tcmDiag, wmDiag)
})


test('smartClassifier: 记录类别不再按号码、日期、关键词或文件名推断', () => {
  const classify = (source) => {
    const category = source['记录类别'] || source['记录类型'] || ''
    return ['住院病种记录', '门诊病种记录', '临床技术记录', '手写大病历', '门诊病历'].includes(category)
      ? category
      : '未分类'
  }

  assert.equal(classify({ 住院号: '376813', 姓名: '杨旭' }), '未分类')
  assert.equal(classify({ 门诊号: '009281', 姓名: '王五' }), '未分类')
  assert.equal(classify({ 操作名称: '针灸治疗', 姓名: '李四' }), '未分类')
  assert.equal(classify({ 姓名: '赵六' }), '未分类')
  assert.equal(classify({ 记录类别: '住院病种记录', 住院号: '376813' }), '住院病种记录')
})

test('smartClassifier: HIS 西医诊断在中医诊断左侧，表头截断时仍能取到病名', () => {
  const normalizeHeader = (value) => String(value ?? '').replace(/[\s　:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
  const source = {
    姓名: '龚庆华',
    门诊号: '99115370422',
    西医诊: '(M47.921)颈椎病',
    中医诊断: '(A03.06.04.05)颈椎病:风寒湿痹阻证',
  }
  const findKey = (aliases) => Object.keys(source).find((key) => aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(key)))
  const wmKey = findKey(['西医诊断', '西医诊', '西医', '西诊'])
  const tcmKey = findKey(['中医诊断', '中医诊'])
  assert.equal(source[wmKey], '(M47.921)颈椎病')
  assert.equal(source[tcmKey], '(A03.06.04.05)颈椎病:风寒湿痹阻证')

  const neighborSource = {
    姓名: '王婴',
    门诊号: '2509260250',
    医诊: '(A07.06)痹证类风湿',
    中医诊断: '(A07.06.04.05)痹证类风湿:气虚血瘀证',
  }
  const keys = Object.keys(neighborSource)
  const tcmIndex = keys.indexOf('中医诊断')
  assert.equal(keys[tcmIndex - 1], '医诊')
  assert.match(neighborSource[keys[tcmIndex - 1]], /痹证类风湿/)
})

test('smartClassifier: 表头带 ICD 后缀或右侧列也能取到中西医诊断', () => {
  const normalizeHeader = (value) => String(value ?? '').replace(/[\s　:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
  const headerMatches = (key, alias) => {
    const k = normalizeHeader(key)
    const a = normalizeHeader(alias)
    if (!k || !a) return false
    if (k === a) return true
    if (k.length < 2 || a.length < 2) return false
    return k.startsWith(a) || a.startsWith(k)
  }
  const findKey = (source, aliases) => Object.keys(source).find((key) => aliases.some((alias) => headerMatches(key, alias)))
  const source = {
    姓名: '龚庆华',
    '西医诊断(ICD)': '(M47.921)颈椎病',
    中医诊断及证型: '(A03.06.04.05)颈椎病:风寒湿痹阻证',
  }
  assert.equal(source[findKey(source, ['西医诊断', '西医诊'])], '(M47.921)颈椎病')
  assert.equal(source[findKey(source, ['中医诊断', '中医诊'])], '(A03.06.04.05)颈椎病:风寒湿痹阻证')

  const rightSource = {
    姓名: '王墨',
    住院号: '2509260250',
    操作名称: '技术操作',
    列A: '(M51.202)腰椎间盘突出',
    列B: '(A03.06.04.05)腰痛:寒湿痹阻证',
  }
  const keys = Object.keys(rightSource)
  let rawTcm = ''
  let rawWm = ''
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const value = String(rightSource[keys[index]] || '').trim()
    if (!rawTcm && /证/.test(value)) {
      rawTcm = value
      continue
    }
    if (!rawWm && /\([A-Za-z]\d/.test(value) && !/证/.test(value)) rawWm = value
  }
  assert.equal(rawWm, '(M51.202)腰椎间盘突出')
  assert.equal(rawTcm, '(A03.06.04.05)腰痛:寒湿痹阻证')
})

test('smartClassifier: 表头截断时仍能取到姓名住院号日期和就诊角色', () => {
  const normalizeHeader = (value) => String(value ?? '').replace(/[\s　:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
  const headerMatches = (key, alias) => {
    const k = normalizeHeader(key)
    const a = normalizeHeader(alias)
    if (!k || !a) return false
    if (k === a) return true
    if (k.length < 2 || a.length < 2) return false
    return k.startsWith(a) || a.startsWith(k)
  }
  const getCell = (source, aliases, accept) => {
    const keys = Object.keys(source).filter((key) => aliases.some((alias) => headerMatches(key, alias)))
    for (const key of keys) {
      const value = String(source[key] ?? '').trim()
      if (!value) continue
      if (accept && !accept(value)) continue
      return value
    }
    return ''
  }
  const looksLikePersonName = (text) => {
    const value = String(text || '').trim().replace(/\s+/g, '')
    if (['主管', '参观', '初诊', '复诊', '确诊', '中医', '西医', '门诊', '住院'].includes(value)) return false
    if (/(科|区|院|病区|病)$/.test(value)) return false
    return /^[\u4e00-\u9fa5·]{2,4}$/.test(value)
  }
  const looksLikeRecordNo = (text) => /^\d{5,}$/.test(String(text || '').trim())
  const parseVisitRole = (text) => {
    const value = String(text || '').trim()
    if (value.includes('参观')) return '参观'
    if (value.includes('主管')) return '主管'
    return ''
  }
  const source = {
    姓名: '龚庆华',
    住院: '376813',
    时间: '2026-07-24...',
    主管: '主管',
    挂号单: '260012345678',
    西医诊: '(M47.921)颈椎病',
    中医诊断: '(A03.06.04.05)颈椎病:风寒湿痹阻证',
  }
  assert.equal(getCell(source, ['姓名', '患者姓名', '病人姓名'], looksLikePersonName), '龚庆华')
  assert.equal(getCell(source, ['住院号', '住院病案号', 'hospitalNo'], looksLikeRecordNo), '376813')
  assert.match(getCell(source, ['日期', '时间']), /2026-07-24/)
  assert.equal(parseVisitRole(getCell(source, ['主管/参观', '主管参观'])), '主管')
  assert.notEqual(getCell(source, ['住院号', '住院'], looksLikeRecordNo), '260012345678')
})

