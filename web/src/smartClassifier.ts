import { normalizeHeader } from './templateMapping'

export type PatientCategory = string

export const ALL_CATEGORIES: PatientCategory[] = [
  '住院病种记录',
  '门诊病种记录',
  '临床技术记录',
  '手写大病历',
  '门诊病历',
]

export interface ClassifiedPatientRow {
  id: string
  checked: boolean
  sourceImage: string
  patientName: string
  recordNo: string // 住院号 / 门诊号 / 病历号
  hospitalNo: string // 住院号专用
  outpatientNo: string // 门诊号专用
  medicalRecordNo: string // 病历号专用
  tcmDiag: string // 中医诊断
  wmDiag: string // 西医诊断
  operationName: string // 操作名称
  visitType: '主管' | '参观' | '初诊' | '复诊' | '确诊' | ''
  date: string // 通用日期
  admissionDate: string // 住院日期
  visitDate: string // 就诊日期
  operationDate: string // 操作日期
  generalDate: string // 大病历/门诊病历日期
  department: string
  category: PatientCategory
  inferredReason: string
  confidence: 'high' | 'medium' | 'low'
  isManualModified?: boolean
  remarks: string
  imageFile: string
  rawSourceRow: Record<string, string>
}

// 常见临床技术关键词识别库
export const CLINICAL_SKILL_KEYWORDS = [
  '穿刺', '胸穿', '腹穿', '腰穿', '骨穿', '关节腔穿刺',
  '纤支镜', '支气管镜', '胃镜', '肠镜', '喉镜',
  '灌洗', '吸痰', '导尿', '插管', '气管插管',
  '心电图', '动态心电图', '肺功能', '脑电图', '肌电图',
  '血糖监测', '血压监测', '除颤', '心肺复苏',
  '针灸', '电针', '艾灸', '拔罐', '穴位贴敷', '穴位注射',
  '推拿', '手法复位', '正骨', '小针刀', '放血', '耳穴',
  '清创', '缝合', '换药', '拆线', '引流', '石膏固定', '夹板固定',
]

function isPlaceholderText(text: string) {
  const normalized = String(text || '').trim().replace(/\s+/g, '')
  if (!normalized) return true
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(normalized)) return true
  if (/^[YMD\-/_.]{3,}$/i.test(normalized)) return true
  if (/^Y{2,4}(?:[-/.]?M{1,2}(?:[-/.]?D{1,2})?)?$/i.test(normalized)) return true
  if (/^\d{4}[-/.]M{1,2}(?:[-/.]D{1,2})?$/i.test(normalized)) return true
  if (/^[-—–·.]{2,}$/.test(normalized)) return true
  return false
}

/**
 * 清理诊断文本中的 ICD 编码或证型编号
 * 例如: "(M47.921)颈椎病" -> "颈椎病"
 * 例如: "(A03.06.04.05)颈椎病:风寒湿痹阻证" -> "颈椎病:风寒湿痹阻证"
 * 例如: "I10.001 高血压" -> "高血压"
 * 若窄列只识别到编码，保留原文，避免西医诊断被清空。
 */
export function cleanDiagCode(text: string): string {
  if (!text) return ''
  var trimmed = String(text).trim()
  if (isPlaceholderText(trimmed)) return ''
  trimmed = trimmed.replace(/\.{2,}$|…+$/g, '').trim()
  var original = trimmed
  trimmed = trimmed.replace(/^[（(]\s*[A-Za-z][A-Za-z0-9.+*_\-:xX]+\s*[）)]\s*/, '')
  trimmed = trimmed.replace(/^[\[【]\s*[A-Za-z][A-Za-z0-9.+*_\-:xX]+\s*[\]】]\s*/, '')
  trimmed = trimmed.replace(/^[A-Za-z]\d{2,3}(?:\.[0-9A-Za-z]+)?(?:xx\d+)?\s+/, '')
  if (trimmed.trim()) return trimmed.trim()
  var chinese = original.replace(/[A-Za-z0-9.+*_\-:xX（()）\[\]【】\s]/g, '').trim()
  return chinese || original
}

const TCM_DIAG_ALIASES = ['中医诊断', '中医诊', '中医病名', '中医诊断病名', 'tcmDiag']
const WM_DIAG_ALIASES = ['西医诊断', '西医诊', '西医病名', '西医诊断病名', 'wmDiag', '西医', '西诊']

function headerMatches(key: string, alias: string) {
  var k = normalizeHeader(key)
  var a = normalizeHeader(alias)
  if (!k || !a) return false
  if (k === a) return true
  if (k.length < 2 || a.length < 2) return false
  return k.startsWith(a) || a.startsWith(k)
}

function findSourceKey(source: Record<string, string>, aliases: string[]) {
  return Object.keys(source).find((key) => aliases.some((alias) => headerMatches(key, alias))) || ''
}

function getCell(source: Record<string, string>, aliases: string[], accept?: (value: string) => boolean) {
  var keys = Object.keys(source).filter((key) => aliases.some((alias) => headerMatches(key, alias)))
  for (var index = 0; index < keys.length; index += 1) {
    var value = String(source[keys[index]] ?? '').trim()
    if (!value || isPlaceholderText(value)) continue
    if (accept && !accept(value)) continue
    return value
  }
  return ''
}

/** 表头完全一致时直接取原文，避免把 Excel 里的长姓名、字母数字住院号滤掉。 */
function getExactCell(source: Record<string, string>, aliases: string[]) {
  var keys = Object.keys(source).filter((key) => aliases.some((alias) => normalizeHeader(key) === normalizeHeader(alias)))
  for (var index = 0; index < keys.length; index += 1) {
    var value = String(source[keys[index]] ?? '').trim()
    if (!value || isPlaceholderText(value)) continue
    return value
  }
  return ''
}

function diagnosisKeySet(source: Record<string, string>) {
  return new Set([findSourceKey(source, TCM_DIAG_ALIASES), findSourceKey(source, WM_DIAG_ALIASES)].filter(Boolean))
}

const HOSPITAL_NO_ALIASES = ['住院号', '登记号', '住院登记号', '就诊登记号', '门诊登记号', '住院号码', '住院编号', '住院病历号', '住院患者号', '住院病案号', 'hospitalNo']
const OUTPATIENT_NO_ALIASES = ['门诊号', '门诊号码', '挂号号', '挂号码', 'outpatientNo']
const MEDICAL_NO_ALIASES = ['病历号', '病案号', '病案编号', '医疗记录号', 'medicalRecordNo']

/** HIS 费别：医保/自费/异地医保，不能当住院号或编号。 */
export function looksLikeFeeType(text: string) {
  var value = String(text || '').trim().replace(/\s+/g, '')
  if (!value) return false
  if (/^(?:异地)?(?:医保|自费|公费)$/.test(value)) return true
  if (/^(?:城乡居民|居民医保|儿童医保|职工医保|新农合|农合|商业保险|全自费)$/.test(value)) return true
  if (/(?:医保|自费|新农合|城乡居民)/.test(value) && !/\d/.test(value) && value.length <= 6) return true
  return false
}

function looksLikeGender(text: string) {
  return /^(男|女|男性|女性|未知)$/.test(String(text || '').trim())
}

function looksLikeDiagnosisText(text: string) {
  var value = String(text || '').trim()
  if (!value) return false
  if (/确诊/.test(value)) return true
  if (/^\d+\./.test(value) && /[\u4e00-\u9fa5]{2,}/.test(value)) return true
  return false
}

function looksLikePersonName(text: string) {
  var value = String(text || '').trim().replace(/\s+/g, '')
  if (!value || isPlaceholderText(value)) return false
  if (looksLikeGender(value) || looksLikeFeeType(value)) return false
  if (ALL_CATEGORIES.includes(value as PatientCategory)) return false
  if (['主管', '参观', '初诊', '复诊', '确诊', '中医', '西医', '门诊', '住院', '未分类'].includes(value)) return false
  if (/[（(]\s*[A-Za-z]/.test(value)) return false
  if (/(科|区|院|病区|病|诊)$/.test(value)) return false
  if (/门诊|科室|确诊|医保|自费/.test(value)) return false
  return /^[\u4e00-\u9fa5·]{2,4}$/.test(value)
}

function looksLikeRecordNo(text: string) {
  var value = String(text || '').trim().replace(/\s+/g, '')
  if (!value || isPlaceholderText(value)) return false
  if (looksLikeFeeType(value) || looksLikeGender(value)) return false
  if (/\d{4}[-/.]\d{1,2}/.test(value)) return false
  if (/^\d{5,}$/.test(value)) return true
  return /^[A-Za-z]{1,6}[-_]?\d{4,}$/.test(value)
}

function pickValidatedRecordNo(source: Record<string, string>, aliases: string[]) {
  var exact = getExactCell(source, aliases)
  if (exact && looksLikeRecordNo(exact)) return exact
  return getCell(source, aliases, looksLikeRecordNo)
}

function firstRecordNoValue(source: Record<string, string>) {
  var keys = Object.keys(source)
  for (var index = 0; index < keys.length; index += 1) {
    var header = normalizeHeader(keys[index])
    if (/费别|性别|诊断|科室|医生|医师|药品|检查|化验|姓名/.test(header)) continue
    var value = String(source[keys[index]] ?? '').trim()
    if (looksLikeRecordNo(value)) return value
  }
  return ''
}

function firstNonDiagValue(source: Record<string, string>, accept: (value: string) => boolean) {
  var skip = diagnosisKeySet(source)
  var keys = Object.keys(source)
  for (var index = 0; index < keys.length; index += 1) {
    if (skip.has(keys[index])) continue
    if (/挂号|医生|医师|费别|性别/.test(normalizeHeader(keys[index]))) continue
    var value = String(source[keys[index]] ?? '').trim()
    if (accept(value)) return value
  }
  return ''
}

function parseVisitRole(text: string): ClassifiedPatientRow['visitType'] {
  var value = String(text || '').trim()
  if (value.includes('参观')) return '参观'
  if (value.includes('主管')) return '主管'
  if (value.includes('复诊') || value === '复') return '复诊'
  if (value.includes('初诊') || value === '初') return '初诊'
  if (value.includes('确诊')) return '确诊'
  return ''
}

/**
 * 判断单元格是否像西医诊断：ICD 括号编码，或常见西医病名。
 */
export function looksLikeWesternDiagCell(text: string): boolean {
  var value = String(text || '').trim()
  if (!value || isPlaceholderText(value)) return false
  if (/[（(]\s*[A-Za-z][0-9][0-9A-Za-z.xX]{1,}\s*[）)]/.test(value)) return true
  if (/(颈椎病|腰椎|间盘突出|筋膜炎|关节炎|高血压|糖尿病|感冒|失眠|头痛|腰痛|膝关|髋关|肺炎|支气管|综合征|影像异常|功能紊乱|高脂血|糖耐量|胃肠|眩晕|肾炎|干眼|白内障|睑腺炎|结膜炎|角膜炎|屈光不正|睑板腺|鼻炎|麦粒肿|霰粒肿)/.test(value)) return true
  if (/(?:炎|损伤|障碍|出血|不正|囊肿|功能紊乱)(?:\s|$|确诊|\[|（|\(|，|,)/.test(value)) return true
  return false
}

function padDatePart(value: string | number) {
  return String(value).padStart(2, '0')
}

function isValidMonthDay(month: string | number, day: string | number) {
  var monthNum = Number(month)
  var dayNum = Number(day)
  return monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31
}

/** HIS 开始时间/结束时间/就诊状态/记录时间，不能当成诊断。 */
export function looksLikeTimeOrStatus(text: string): boolean {
  var value = String(text || '').trim()
  if (!value) return false
  var withoutStatus = value.replace(/结束就诊|暂挂|候诊|已就诊/g, '').trim()
  if (/结束就诊|暂挂|候诊|已就诊/.test(value) && !/[\u4e00-\u9fa5]{2,}(病|证|炎|痔|痛|痹)/.test(withoutStatus)) return true
  if (/[\u4e00-\u9fa5]{2,}/.test(withoutStatus) && !/结束就诊|暂挂|候诊|已就诊/.test(value)) return false
  if (/^\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/.test(value)) return true
  if (/^-?\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/.test(value)) return true
  if (/\d{1,2}:\d{2}/.test(value) && /\d{1,2}[-/.]\d{1,2}/.test(value) && /结束就诊|暂挂/.test(value)) return true
  if (/^\d{1,2}[:：]\d{2}(?:[:：]\d{2})?$/.test(value)) return true
  return false
}

/** 拆 HIS「主要诊断名称」里的 (西)… (中)… 合格。 */
export function splitCombinedHisDiagnosis(text: string): { tcm: string, wm: string } {
  var value = String(text || '').trim()
  if (!/[（(]\s*[西中]\s*[）)]/.test(value)) return { tcm: '', wm: '' }
  var tcm = ''
  var wm = ''
  value.split(/(?=[（(]\s*[西中]\s*[）)])/).forEach((part) => {
    var trimmed = part.trim().replace(/^[,，;；]+|[,，;；]+$/g, '').trim()
    var wmHit = trimmed.match(/^[（(]\s*西\s*[）)]\s*(.*)$/)
    var tcmHit = trimmed.match(/^[（(]\s*中\s*[）)]\s*(.*)$/)
    if (wmHit) wm = wmHit[1].trim()
    else if (tcmHit) tcm = tcmHit[1].trim()
  })
  return { tcm, wm }
}

const TCM_DISEASE_NAMES = [
  '针眼', '时复目痒', '凝脂翳', '白涩症', '圆翳内障', '暴风客热', '天行赤眼',
  '聚星障', '花翳白陷', '能近怯远', '能远怯近', '视瞻昏渺', '云雾移睛',
  '睑弦赤烂', '白睛溢血', '瞳神紧小', '青风内障', '绿风内障', '鼻鼽',
  '胞生痰核', '漏睛', '目劄', '项痹', '消渴', '哮病', '不寐', '物损真睛',
]

const WM_TO_TCM_RULES = [
  { keys: ['睑腺炎', '麦粒肿'], tcm: '针眼:肝经风热证' },
  { keys: ['霰粒肿', '睑板腺囊肿'], tcm: '胞生痰核:痰湿结聚证' },
  { keys: ['睑板腺功能障碍'], tcm: '白涩症:脾胃湿热证' },
  { keys: ['变应性结膜炎', '免疫性结膜炎', '过敏性结膜炎'], tcm: '时复目痒:风热犯目证' },
  { keys: ['过敏性鼻炎', '变应性鼻炎'], tcm: '鼻鼽:风热犯肺证' },
  { keys: ['丝状角膜炎'], tcm: '白涩症:阴虚夹风证' },
  { keys: ['角膜炎'], tcm: '聚星障:风热犯目证' },
  { keys: ['角膜损伤', '角膜上皮'], tcm: '物损真睛:风热犯目证' },
  { keys: ['结膜下出血'], tcm: '白睛溢血:热伤血络证' },
  { keys: ['结膜炎'], tcm: '暴风客热:风热犯目证' },
  { keys: ['干眼症', '干眼'], tcm: '白涩症:肝阴虚证' },
  { keys: ['白内障'], tcm: '圆翳内障:肝肾阴虚证' },
  { keys: ['屈光不正', '近视'], tcm: '能近怯远:肝肾不足证' },
  { keys: ['青光眼'], tcm: '青风内障:肝风上扰证' },
  { keys: ['高血压'], tcm: '眩晕:肝阳上亢证' },
  { keys: ['糖尿病'], tcm: '消渴:阴虚燥热证' },
  { keys: ['颈椎病'], tcm: '项痹:风寒湿痹阻证' },
  { keys: ['腰椎间盘突出'], tcm: '腰痛:寒湿痹阻证' },
  { keys: ['失眠'], tcm: '不寐:心肝火旺证' },
  { keys: ['上呼吸道感染'], tcm: '感冒:风热犯肺证' },
  { keys: ['支气管哮喘', '哮喘'], tcm: '哮病:痰热壅肺证' },
  { keys: ['肺炎'], tcm: '风温肺热:痰热壅肺证' },
  { keys: ['关节炎'], tcm: '痹证:风寒湿痹阻证' },
  { keys: ['头痛'], tcm: '头痛:肝阳上亢证' },
  { keys: ['感冒'], tcm: '感冒:风热犯肺证' },
]

type DiagKind = 'tcm' | 'wm' | 'unknown'

function uniqueKeepOrder(items: Array<string | null | undefined> | null | undefined): string[] {
  var seen = new Set<string>()
  var result: string[] = []
  ;(items || []).forEach((item) => {
    var value = String(item || '').trim()
    var key = value.replace(/\s+/g, '')
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(value)
  })
  return result
}

function hasTcmDiseaseName(text: string): boolean {
  var value = String(text || '')
  return TCM_DISEASE_NAMES.some((name) => value.includes(name))
}

function joinDiagItems(items: string[]): string {
  return uniqueKeepOrder(items).join('，')
}

/**
 * 拆 HIS 编号诊断：1.病名 确诊2.病名 确诊
 */
export function splitDiagnosisItems(text: string): string[] {
  var value = String(text || '').trim()
  if (!value) return []
  var cleanPart = (part: string) => part
    .replace(/^\d+\s*[.、．]\s*/, '')
    .replace(/(?:确诊|疑诊|待查|待诊)\s*$/g, '')
    .replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, '')
    .trim()
  var numbered = value.split(/(?:确诊|疑诊|待查|待诊)?\s*(?=\d+\s*[.、．]\s*)/g).map(cleanPart).filter(Boolean)
  if (numbered.length >= 2) return uniqueKeepOrder(numbered)
  var comma = value.split(/[,，;；]+/).map(cleanPart).filter(Boolean)
  if (comma.length >= 2) return uniqueKeepOrder(comma)
  var single = cleanPart(value)
  return single ? [single] : []
}

/**
 * 单条诊断判中医 / 西医。中医病名和证型优先，避免把针眼、白涩症当成西医。
 */
export function classifyDiagnosisItem(text: string): DiagKind {
  var value = String(text || '').trim()
  if (!value || isPlaceholderText(value) || looksLikeTimeOrStatus(value)) return 'unknown'
  if (hasTcmDiseaseName(value) || /[:：]/.test(value) || /(证|证型|证候)\s*$/.test(value)) return 'tcm'
  if (/(风寒|风热|湿热|寒湿|气虚|阴虚|阳虚|气阴两虚|痰湿|瘀血|肝郁|心火|肝火|脾虚|肾虚|血瘀|痹阻|肝热|肝阴)/.test(value)) return 'tcm'
  if (/[（(]\s*[A-Za-z][0-9]/.test(value) && !/(证|证型|证候)/.test(value)) return 'wm'
  if (looksLikeWesternDiagCell(value)) return 'wm'
  if (/(?:炎|损伤|障碍|出血|不正|综合征|功能紊乱)(?:\s|$|确诊|\[|（|\()/.test(value)) return 'wm'
  return 'unknown'
}

export function isMixedDiagnosisText(text: string): boolean {
  var items = splitDiagnosisItems(text)
  if (items.length < 2) return /[（(]\s*[西中]\s*[）)]/.test(String(text || ''))
  var kinds = new Set(items.map(classifyDiagnosisItem).filter((kind) => kind !== 'unknown'))
  return kinds.has('tcm') && kinds.has('wm')
}

/**
 * 按西医病名生成常用中医病名:证型，优先匹配更长的关键词。
 */
export function generateTcmFromWestern(wm: string): string {
  var text = String(wm || '').trim()
  if (!text) return ''
  var items = splitDiagnosisItems(text)
  if (!items.length) items = [text]
  var pairs: Array<{ key: string, tcm: string }> = []
  WM_TO_TCM_RULES.forEach((rule) => {
    rule.keys.forEach((key) => pairs.push({ key, tcm: rule.tcm }))
  })
  pairs.sort((a, b) => b.key.length - a.key.length)
  for (var index = 0; index < items.length; index += 1) {
    var item = items[index]
    for (var pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      if (item.includes(pairs[pairIndex].key)) return pairs[pairIndex].tcm
    }
  }
  for (var fallback = 0; fallback < pairs.length; fallback += 1) {
    if (text.includes(pairs[fallback].key)) return pairs[fallback].tcm
  }
  return ''
}

export function composeTcmDiagnosis(tcmItems: string[], wmText: string): string {
  var items = uniqueKeepOrder(tcmItems)
  if (!items.length) return generateTcmFromWestern(wmText)
  var formatted = items.find((item) => /[:：]/.test(item))
  if (formatted) return formatted.replace(/：/g, ':')
  var syndromes = items.filter((item) => /(证|证型|证候)\s*$/.test(item))
  var diseases = items.filter((item) => !/(证|证型|证候)\s*$/.test(item))
  var generated = generateTcmFromWestern(wmText)
  var genParts = generated.split(':')
  var disease = diseases[0] || genParts[0] || ''
  var syndrome = syndromes[0] || genParts[1] || ''
  if (disease && syndrome) return disease + ':' + syndrome
  if (disease) return generated && generated.startsWith(disease) ? generated : disease
  if (syndrome) return genParts[0] ? genParts[0] + ':' + syndrome : syndrome
  return generated
}

function collectKindedItems(text: string, fallbackKind: DiagKind): Array<{ item: string, kind: 'tcm' | 'wm' }> {
  var items = splitDiagnosisItems(text)
  return items.map((item) => {
    var kind: DiagKind = classifyDiagnosisItem(item)
    if (kind === 'unknown') kind = fallbackKind
    return { item, kind }
  }).filter((entry): entry is { item: string, kind: 'tcm' | 'wm' } => entry.kind === 'tcm' || entry.kind === 'wm')
}

/**
 * 中西医混写时抽出西医诊断；中医优先用原文病名/证型，没有则按西医自动生成。
 */
export function resolveMixedDiagnoses(tcm: string, wm: string, general = ''): { tcm: string, wm: string } {
  var tcmText = rejectTimeLike(String(tcm || '').trim())
  var wmText = rejectTimeLike(String(wm || '').trim())
  var generalText = rejectTimeLike(String(general || '').trim())
  var tcmCollected: string[] = []
  var wmCollected: string[] = []
  function absorb(text: string, fallbackKind: DiagKind) {
    collectKindedItems(text, fallbackKind).forEach((entry) => {
      if (entry.kind === 'tcm') tcmCollected.push(entry.item)
      else wmCollected.push(entry.item)
    })
  }
  absorb(wmText, 'wm')
  absorb(tcmText, isMixedDiagnosisText(tcmText) ? 'unknown' : 'tcm')
  if ((!tcmCollected.length || !wmCollected.length) && generalText && generalText !== tcmText && generalText !== wmText) {
    absorb(generalText, 'unknown')
  } else if (!tcmCollected.length && !wmCollected.length && generalText) {
    absorb(generalText, 'unknown')
  }
  var resolvedWm = joinDiagItems(wmCollected)
  var resolvedTcm = composeTcmDiagnosis(tcmCollected, resolvedWm)
  if (!resolvedTcm && resolvedWm) resolvedTcm = generateTcmFromWestern(resolvedWm)
  return {
    tcm: resolvedTcm,
    wm: resolvedWm,
  }
}

export function cleanDepartmentName(text: string): string {
  return String(text || '')
    .replace(/[./．、]门诊病人$/u, '')
    .replace(/[./．]门诊.*$/u, '')
    .trim()
}

function rejectTimeLike(value: string) {
  return looksLikeTimeOrStatus(value) ? '' : value
}

function pickRawDiagnoses(source: Record<string, string>) {
  var keys = Object.keys(source)
  var tcmKey = findSourceKey(source, TCM_DIAG_ALIASES)
  var wmKey = findSourceKey(source, WM_DIAG_ALIASES)
  var rawTcmDiag = rejectTimeLike(tcmKey ? String(source[tcmKey] ?? '').trim() : '')
  var rawWmDiag = rejectTimeLike(wmKey ? String(source[wmKey] ?? '').trim() : '')
  if (!rawWmDiag && tcmKey) {
    var tcmIndex = keys.indexOf(tcmKey)
    if (tcmIndex > 0) {
      var leftKey = keys[tcmIndex - 1]
      var leftVal = rejectTimeLike(String(source[leftKey] ?? '').trim())
      if (leftKey !== tcmKey && looksLikeWesternDiagCell(leftVal)) rawWmDiag = leftVal
    }
  }
  if (!rawWmDiag) {
    keys.some((key) => {
      if (key === tcmKey) return false
      var value = rejectTimeLike(String(source[key] ?? '').trim())
      if (!looksLikeWesternDiagCell(value)) return false
      if (isTcmDiagPattern(cleanDiagCode(value))) return false
      rawWmDiag = value
      return true
    })
  }
  if (!rawTcmDiag || !rawWmDiag) {
    for (var index = keys.length - 1; index >= 0; index -= 1) {
      var key = keys[index]
      if (key === tcmKey || key === wmKey) continue
      var value = rejectTimeLike(String(source[key] ?? '').trim())
      if (!value || isPlaceholderText(value)) continue
      var cleaned = cleanDiagCode(value)
      if (!rawTcmDiag && isTcmDiagPattern(cleaned)) {
        rawTcmDiag = value
        continue
      }
      if (!rawWmDiag && looksLikeWesternDiagCell(value) && !isTcmDiagPattern(cleaned)) {
        rawWmDiag = value
      }
      if (rawTcmDiag && rawWmDiag) break
    }
  }
  return { rawTcmDiag, rawWmDiag }
}

/**
 * 判断文本是否明显属于中医诊断（含证型特征）
 */
export function isTcmDiagPattern(text: string): boolean {
  if (!text) return false
  var tcmText = text.trim()
  if (tcmText.includes(':') || tcmText.includes('：')) return true
  if (hasTcmDiseaseName(tcmText)) return true
  // “病”单独作为结尾不能判断为中医诊断；高血压病、冠心病等西医病名也常以“病”结尾。
  if (/(证|证型|证候)/.test(tcmText)) return true
  if (/(风寒|风热|湿热|寒湿|气虚|阴虚|阳虚|气阴两虚|痰湿|瘀血|肝郁|心火|肝火|脾虚|肾虚|血瘀|痹阻|肝热|肝阴)/.test(tcmText)) return true
  return false
}

/**
 * 提取中医诊断和证型
 */
export function parseTcmDiag(text: string): string {
  return cleanDiagCode(text)
}

/**
 * 清洗日期格式并去掉省略号
 */
export function cleanDateText(text: string): string {
  if (!text) return ''
  if (isPlaceholderText(text)) return ''
  var ymd = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (ymd && isValidMonthDay(ymd[2], ymd[3])) {
    return `${ymd[1]}-${padDatePart(ymd[2])}-${padDatePart(ymd[3])}`
  }
  var yymmdd = text.match(/(?:^|[^\d])(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?=\s|$|[^\d])/)
  if (yymmdd && isValidMonthDay(yymmdd[2], yymmdd[3])) {
    return `20${padDatePart(yymmdd[1])}-${padDatePart(yymmdd[2])}-${padDatePart(yymmdd[3])}`
  }
  var monthDay = text.match(/(?:^|[^\d])-?(\d{1,2})[-/.](\d{1,2})(?=\s|$|[^\d])/)
  if (monthDay && isValidMonthDay(monthDay[1], monthDay[2]) && (looksLikeTimeOrStatus(text) || /\d{1,2}:\d{1,2}/.test(text))) {
    return `${new Date().getFullYear()}-${padDatePart(monthDay[1])}-${padDatePart(monthDay[2])}`
  }
  if (looksLikeTimeOrStatus(text)) return ''
  return text.replace(/\.{2,}$|…+$/g, '').trim()
}

/**
 * 从单行 OCR 键值对中推断患者数据与分类
 */
export function inferPatientRow(
  source: Record<string, string>,
  sourceImage: string,
  defaultDepartment: string = '',
  index: number = 0,
): ClassifiedPatientRow {
  var id = `row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`

  // 1. 抽取基础字段（表头截断时用前缀匹配；诊断列仍走 pickRawDiagnoses）
  var getVal = (aliases: string[], accept?: (value: string) => boolean): string => getCell(source, aliases, accept)

  var patientName = getExactCell(source, ['姓名', '患者姓名', '病人姓名', 'patientName', 'patient_name'])
  if (!looksLikePersonName(patientName)) patientName = ''
  if (!patientName) {
    var genderCell = getExactCell(source, ['性别', 'sex', 'gender'])
    if (looksLikePersonName(genderCell)) patientName = genderCell
  }
  if (!patientName) patientName = getVal(['姓名', '患者姓名', '病人姓名', '患者', '病人', 'name'], looksLikePersonName)
  if (!patientName) patientName = firstNonDiagValue(source, looksLikePersonName)

  var hospitalNo = pickValidatedRecordNo(source, HOSPITAL_NO_ALIASES)
  var outpatientNo = pickValidatedRecordNo(source, OUTPATIENT_NO_ALIASES)
  var medicalRecordNo = pickValidatedRecordNo(source, MEDICAL_NO_ALIASES)
  if (!hospitalNo && !outpatientNo) {
    var fallbackNo = firstRecordNoValue(source)
    if (fallbackNo && fallbackNo !== medicalRecordNo) {
      var hasOutpatientHeader = Object.keys(source).some((key) => /挂号|门诊号/.test(normalizeHeader(key)))
      if (hasOutpatientHeader) outpatientNo = fallbackNo
      else hospitalNo = fallbackNo
    }
  }

  // 兼容 HIS 截断表头；西医诊断在中医诊断左侧，表头对不上时按列位置和 ICD 形态补回。
  var pickedDiags = pickRawDiagnoses(source)
  var rawTcmDiag = rejectTimeLike(pickedDiags.rawTcmDiag)
  var rawWmDiag = rejectTimeLike(pickedDiags.rawWmDiag)
  var rawGeneralDiag = rejectTimeLike(getVal(['诊断', '主要诊断', '主要诊断名称', '临床诊断', '初步诊断', '门诊诊断', 'diag', 'diagnosis']))
  var combined = [rawGeneralDiag, rawWmDiag, rawTcmDiag]
    .map(splitCombinedHisDiagnosis)
    .find((item) => item.tcm || item.wm)
  if (combined && (combined.tcm || combined.wm)) {
    if (combined.tcm) rawTcmDiag = combined.tcm
    if (combined.wm) rawWmDiag = combined.wm
    if (combined.tcm && combined.wm) rawGeneralDiag = ''
  }

  var operation = getVal(['操作名称', '手术名称', '技术名称', '治疗项目', 'operationName'])
  if (isPlaceholderText(operation)) operation = ''
  var admissionDate = getVal(['入院日期', '住院日期', '入院时间', '住院时间', 'admissionDate'])
  var visitDate = getVal(['就诊日期', '接诊日期', '就诊时间', '开始时间', '开始日期', '记录时间', '书写时间', 'visitDate'])
  var operationDate = getVal(['操作日期', '手术日期', '治疗日期', '操作时间', 'operationDate'])
  var generalDate = getVal(['日期', 'date', '编辑日期', '记录时间', '书写时间'])
  var urgentOrFollowup = getVal(['急复', '初复诊', '初诊/复诊', '复诊'])
  var firstVisitFlag = getVal(['初诊'])
  var visitKind = getVal(['就诊类型', '病人类型', '患者类型'])
  var docOrVisitType = getVal(['主管/参观', '带教形式', '医生角色', '就诊角色', '主管参观'])
  var deptInRow = cleanDepartmentName(getVal(['所在科室', '科室', '就诊科室', '接诊科室', '入院科室', '执行科室']))
  if (looksLikeDiagnosisText(deptInRow) || looksLikeWesternDiagCell(deptInRow) || looksLikeFeeType(deptInRow) || looksLikeRecordNo(deptInRow) || looksLikeGender(deptInRow)) {
    deptInRow = ''
  }
  var remarks = getVal(['备注', 'remarks'])

  // 所有字段保留 OCR 对应单元格的原文，不把类型单字从号码列移走。
  var categoryText = getVal(['记录类别', '记录类型', '病历类型', '病种类别', '业务类别'])
  var knownCategory = ALL_CATEGORIES.find((item) => categoryText === item || categoryText.includes(item)) || ''
  var explicitCategory: PatientCategory | '' = knownCategory || (categoryText && categoryText.trim().length >= 2 && !isPlaceholderText(categoryText) ? categoryText.trim() : '')

  // 诊断列优先用明确表头；混写编号诊断拆出西医，中医用原文病名/证型，没有则按西医生成。
  var tcmDiag = cleanDiagCode(rawTcmDiag)
  var wmDiag = cleanDiagCode(rawWmDiag)
  var cleanedGeneralDiag = cleanDiagCode(rawGeneralDiag)
  var resolvedDiags = resolveMixedDiagnoses(tcmDiag, wmDiag, cleanedGeneralDiag)
  tcmDiag = resolvedDiags.tcm
  wmDiag = resolvedDiags.wm

  // 日期只清洗当前列原文，不把入院/就诊/操作日期互相填过去。
  var visitDateClean = cleanDateText(visitDate)
  var admissionDateClean = cleanDateText(admissionDate)
  var operationDateClean = cleanDateText(operationDate)
  var generalDateClean = cleanDateText(generalDate)

  // 就诊类型优先读角色列原文；表头对不上时再从非诊断单元格识别主管/参观/初复诊。
  var visitType: ClassifiedPatientRow['visitType'] = parseVisitRole(urgentOrFollowup) || parseVisitRole(docOrVisitType)
  if (!visitType && /^(是|√|Y|yes)$/i.test(String(firstVisitFlag || '').trim())) visitType = '初诊'
  if (!visitType) visitType = parseVisitRole(firstNonDiagValue(source, (value) => Boolean(parseVisitRole(value))))

  if (!visitDateClean && !admissionDateClean && !operationDateClean && !generalDateClean) {
    var fallbackDate = firstNonDiagValue(source, (value) => Boolean(cleanDateText(value).match(/\d{4}-\d{1,2}-\d{1,2}/)))
    generalDateClean = cleanDateText(fallbackDate)
  }

  var recordNo = hospitalNo || outpatientNo || medicalRecordNo || ''

  // 2. 智能分类推断
  var category: PatientCategory = '未分类'
  var inferredReason = ''
  var confidence: 'high' | 'medium' | 'low' = 'medium'

  // 分类只接受图片中明确出现的记录类别字段；没有该列时保持未分类，不拿号码、日期、科室、诊断或文件名推断。
  if (explicitCategory) {
    category = explicitCategory
    inferredReason = '图片中明确提供记录类别'
    confidence = 'high'
  } else if (/门诊病历/.test(categoryText)) {
    category = '门诊病历'
    inferredReason = '病历类型为门诊病历'
    confidence = 'high'
  } else if (/门诊病人|普通门诊/.test(visitKind)) {
    category = '门诊病种记录'
    inferredReason = '就诊类型为门诊病人'
    confidence = 'medium'
  } else {
    category = '未分类'
    inferredReason = '图片未提供明确记录类别字段，请人工选择'
    confidence = 'low'
  }

  var finalDept = deptInRow || defaultDepartment

  var outputCategory: PatientCategory = String(category) as PatientCategory

  return {
    id,
    checked: true,
    sourceImage,
    patientName,
    recordNo,
    hospitalNo,
    outpatientNo,
    medicalRecordNo,
    tcmDiag,
    wmDiag,
    operationName: operation,
    visitType,
    date: generalDateClean || visitDateClean || admissionDateClean || operationDateClean,
    admissionDate: admissionDateClean,
    visitDate: visitDateClean,
    operationDate: operationDateClean,
    generalDate: generalDateClean,
    department: finalDept,
    category: outputCategory,
    inferredReason,
    confidence,
    remarks,
    imageFile: outputCategory === '手写大病历' || outputCategory === '门诊病历' ? sourceImage : '',
    rawSourceRow: source,
  }
}

/**
 * 将 ClassifiedPatientRow 严格映射到 16 列五类合并模板格式
 * 0: 记录类别
 * 1: 所在科室
 * 2: 病人姓名
 * 3: 住院号
 * 4: 中医诊断
 * 5: 西医诊断
 * 6: 主管/参观
 * 7: 住院日期
 * 8: 就诊日期
 * 9: 初诊/复诊
 * 10: 病历号
 * 11: 操作日期
 * 12: 操作名称
 * 13: 日期
 * 14: 备注
 * 15: 图片文件
 */
export function mapClassifiedRowToTemplateRow(row: ClassifiedPatientRow): string[] {
  var category = row.category
  var department = row.department || ''
  var patientName = row.patientName || ''
  var tcmDiag = row.tcmDiag || ''
  var wmDiag = row.wmDiag || ''
  var remarks = row.remarks || ''
  var imageFile = row.imageFile || ''

  var hospitalNo = ''
  var visitRole = '' // 主管/参观
  var admissionDate = ''
  var visitDate = ''
  var visitType = '' // 初诊/复诊
  var medicalRecordNo = ''
  var operationDate = ''
  var operationName = ''
  var generalDate = ''

  hospitalNo = row.hospitalNo || ''
  visitRole = row.visitType === '主管' || row.visitType === '参观' ? row.visitType : ''
  admissionDate = row.admissionDate || ''
  visitDate = row.visitDate || row.date || ''
  visitType = row.visitType === '初诊' || row.visitType === '复诊' ? row.visitType : ''
  medicalRecordNo = row.medicalRecordNo || row.outpatientNo || ''
  operationDate = row.operationDate || ''
  operationName = row.operationName || ''
  generalDate = row.generalDate || ''
  if (category === '手写大病历' || category === '门诊病历') {
    generalDate = row.generalDate || row.date || ''
  }
  if ((category === '手写大病历' || category === '门诊病历') && !imageFile) {
    imageFile = row.sourceImage || ''
  }

  return [
    category,
    department,
    patientName,
    hospitalNo,
    tcmDiag,
    wmDiag,
    visitRole,
    admissionDate,
    visitDate,
    visitType,
    medicalRecordNo,
    operationDate,
    operationName,
    generalDate,
    remarks,
    imageFile,
  ]
}

/**
 * 汇总多条记录的分类统计
 */
export function summarizeCategories(rows: ClassifiedPatientRow[]): Record<string, number> {
  var summary: Record<string, number> = {
    住院病种记录: 0,
    门诊病种记录: 0,
    临床技术记录: 0,
    手写大病历: 0,
    门诊病历: 0,
    未分类: 0,
    total: rows.length,
    selected: 0,
  }

  rows.forEach((row) => {
    if (row.checked) summary.selected++
    var key = String(row.category || '未分类').trim() || '未分类'
    summary[key] = (summary[key] || 0) + 1
  })

  return summary
}

export function extraCategoryNames(summary: Record<string, number> = {}) {
  var reserved = new Set(['住院病种记录', '门诊病种记录', '临床技术记录', '手写大病历', '门诊病历', '未分类', 'total', 'selected', '全部'])
  return Object.keys(summary).filter((key) => !reserved.has(key) && Number(summary[key] || 0) > 0)
}

export const ALL_SHEET_NAME = '全部'
export const UNASSIGNED_DEPARTMENT_SHEET = '未指定科室'

export type DepartmentSheetTab = {
  name: string
  count: number
}

/** 行所在工作表名：有科室用科室，否则归入未指定科室 */
export function getRowSheetName(row: Pick<ClassifiedPatientRow, 'department'>) {
  var name = String(row.department || '').trim()
  return name || UNASSIGNED_DEPARTMENT_SHEET
}

/** 按首次出现顺序汇总科室工作表 */
export function collectDepartmentSheets(rows: ClassifiedPatientRow[]): DepartmentSheetTab[] {
  var counts = new Map<string, number>()
  rows.forEach((row) => {
    var name = getRowSheetName(row)
    counts.set(name, (counts.get(name) || 0) + 1)
  })
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
}
