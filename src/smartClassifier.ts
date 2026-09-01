import { normalizeHeader } from './templateMapping'

export type PatientCategory = '住院病种记录' | '门诊病种记录' | '临床技术记录' | '手写大病历' | '门诊病历' | '未分类'

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

function diagnosisKeySet(source: Record<string, string>) {
  return new Set([findSourceKey(source, TCM_DIAG_ALIASES), findSourceKey(source, WM_DIAG_ALIASES)].filter(Boolean))
}

function looksLikePersonName(text: string) {
  var value = String(text || '').trim().replace(/\s+/g, '')
  if (!value || isPlaceholderText(value)) return false
  if (['主管', '参观', '初诊', '复诊', '确诊', '中医', '西医', '门诊', '住院'].includes(value)) return false
  if (/[（(]\s*[A-Za-z]/.test(value)) return false
  if (/(科|区|院|病区|病)$/.test(value)) return false
  return /^[\u4e00-\u9fa5·]{2,4}$/.test(value)
}

function looksLikeRecordNo(text: string) {
  var value = String(text || '').trim().replace(/\s+/g, '')
  if (!value || isPlaceholderText(value)) return false
  if (/\d{4}[-/.]\d{1,2}/.test(value)) return false
  return /^\d{5,}$/.test(value)
}

function firstNonDiagValue(source: Record<string, string>, accept: (value: string) => boolean) {
  var skip = diagnosisKeySet(source)
  var keys = Object.keys(source)
  for (var index = 0; index < keys.length; index += 1) {
    if (skip.has(keys[index])) continue
    if (/挂号/.test(normalizeHeader(keys[index]))) continue
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
  if (/(颈椎病|腰椎|间盘突出|筋膜炎|关节炎|高血压|糖尿病|感冒|失眠|头痛|腰痛|膝关|髋关|肺炎|支气管|综合征|影像异常|功能紊乱|高脂血|糖耐量|胃肠|眩晕|肾炎)/.test(value)) return true
  return false
}

function pickRawDiagnoses(source: Record<string, string>) {
  var keys = Object.keys(source)
  var tcmKey = findSourceKey(source, TCM_DIAG_ALIASES)
  var wmKey = findSourceKey(source, WM_DIAG_ALIASES)
  var rawTcmDiag = tcmKey ? String(source[tcmKey] ?? '').trim() : ''
  var rawWmDiag = wmKey ? String(source[wmKey] ?? '').trim() : ''
  if (!rawWmDiag && tcmKey) {
    var tcmIndex = keys.indexOf(tcmKey)
    if (tcmIndex > 0) {
      var leftKey = keys[tcmIndex - 1]
      var leftVal = String(source[leftKey] ?? '').trim()
      if (leftKey !== tcmKey && looksLikeWesternDiagCell(leftVal)) rawWmDiag = leftVal
    }
  }
  if (!rawWmDiag) {
    keys.some((key) => {
      if (key === tcmKey) return false
      var value = String(source[key] ?? '').trim()
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
      var value = String(source[key] ?? '').trim()
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
  var t = text.trim()
  if (t.includes(':') || t.includes('：')) return true
  // “病”单独作为结尾不能判断为中医诊断；高血压病、冠心病等西医病名也常以“病”结尾。
  if (/(证|证型|证候|型)$/.test(t)) return true
  if (/(风寒|风热|湿热|寒湿|气虚|阴虚|阳虚|气阴两虚|痰湿|瘀血|肝郁|心火|肝火|脾虚|肾虚|血瘀|痹阻)/.test(t)) return true
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
  var match = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/)
  if (match) {
    return match[0].replace(/\//g, '-').replace(/\./g, '-')
  }
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

  var patientName = getVal(['姓名', '患者姓名', '病人姓名', '患者', '病人', 'name'], looksLikePersonName)
  if (!patientName) patientName = firstNonDiagValue(source, looksLikePersonName)

  var hospitalNo = getVal(['住院号', '住院病案号', '住院号码', '住院编号', '住院病历号', '住院患者号', '住院登记号', 'hospitalNo'], looksLikeRecordNo)
  var outpatientNo = getVal(['门诊号', '门诊号码', 'outpatientNo'], looksLikeRecordNo)
  var medicalRecordNo = getVal(['病历号', '病案号', '病案编号', '医疗记录号', 'medicalRecordNo'], looksLikeRecordNo)
  if (!hospitalNo && !outpatientNo && !medicalRecordNo) {
    var fallbackNo = firstNonDiagValue(source, looksLikeRecordNo)
    if (fallbackNo) hospitalNo = fallbackNo
  }

  // 兼容 HIS 截断表头；西医诊断在中医诊断左侧，表头对不上时按列位置和 ICD 形态补回。
  var pickedDiags = pickRawDiagnoses(source)
  var rawTcmDiag = pickedDiags.rawTcmDiag
  var rawWmDiag = pickedDiags.rawWmDiag
  var rawGeneralDiag = getVal(['诊断', '主要诊断', '临床诊断', '初步诊断', '门诊诊断', 'diag', 'diagnosis'])

  var operation = getVal(['操作名称', '手术名称', '技术名称', '治疗项目', 'operationName'])
  if (isPlaceholderText(operation)) operation = ''
  var admissionDate = getVal(['入院日期', '住院日期', '入院时间', '住院时间', 'admissionDate'])
  var visitDate = getVal(['就诊日期', '接诊日期', '就诊时间', 'visitDate'])
  var operationDate = getVal(['操作日期', '手术日期', '治疗日期', '操作时间', 'operationDate'])
  var generalDate = getVal(['日期', '时间', 'date', '编辑日期', '就诊时间', '入院时间'])
  var urgentOrFollowup = getVal(['急复', '初复诊', '初诊/复诊', '就诊类型'])
  var docOrVisitType = getVal(['主管/参观', '带教形式', '医生角色', '就诊角色', '主管参观'])
  var deptInRow = getVal(['所在科室', '科室', '就诊科室', '入院科室', '执行科室'])
  var remarks = getVal(['备注', 'remarks'])

  // 所有字段保留 OCR 对应单元格的原文，不把类型单字从号码列移走。
  var categoryText = getVal(['记录类别', '记录类型', '病种类别', '业务类别'])
  var explicitCategory: PatientCategory | '' = (['住院病种记录', '门诊病种记录', '临床技术记录', '手写大病历', '门诊病历'] as PatientCategory[]).find((item) => categoryText === item) || ''

  // 诊断列优先用明确表头；若图片只给了泛化“诊断”列，再按内容分流补回。
  var tcmDiag = cleanDiagCode(rawTcmDiag)
  var wmDiag = cleanDiagCode(rawWmDiag)
  if (!tcmDiag && !wmDiag && rawGeneralDiag) {
    var cleanedGeneralDiag = cleanDiagCode(rawGeneralDiag)
    if (isTcmDiagPattern(cleanedGeneralDiag)) tcmDiag = cleanedGeneralDiag
    else wmDiag = cleanedGeneralDiag
  } else if (rawGeneralDiag) {
    var cleanedGeneralDiag = cleanDiagCode(rawGeneralDiag)
    if (!tcmDiag && isTcmDiagPattern(cleanedGeneralDiag)) tcmDiag = cleanedGeneralDiag
    else if (!wmDiag) wmDiag = cleanedGeneralDiag
  }
  if (!tcmDiag && wmDiag && isTcmDiagPattern(wmDiag)) {
    tcmDiag = wmDiag
    wmDiag = ''
  }

  // 日期只清洗当前列原文，不把入院/就诊/操作日期互相填过去。
  var visitDateClean = cleanDateText(visitDate)
  var admissionDateClean = cleanDateText(admissionDate)
  var operationDateClean = cleanDateText(operationDate)
  var generalDateClean = cleanDateText(generalDate)

  // 就诊类型优先读角色列原文；表头对不上时再从非诊断单元格识别主管/参观/初复诊。
  var visitType: ClassifiedPatientRow['visitType'] = parseVisitRole(urgentOrFollowup) || parseVisitRole(docOrVisitType)
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
  visitDate = row.visitDate || ''
  visitType = row.visitType === '初诊' || row.visitType === '复诊' ? row.visitType : ''
  medicalRecordNo = row.medicalRecordNo || ''
  operationDate = row.operationDate || ''
  operationName = row.operationName || ''
  generalDate = row.generalDate || row.date || ''
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
export function summarizeCategories(rows: ClassifiedPatientRow[]): Record<PatientCategory | 'total' | 'selected', number> {
  var summary: Record<PatientCategory | 'total' | 'selected', number> = {
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
    if (summary[row.category] !== undefined) {
      summary[row.category]++
    } else {
      summary.未分类++
    }
  })

  return summary
}
