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

/**
 * 清理诊断文本中的 ICD 编码或证型编号
 * 例如: "(M47.921)颈椎病" -> "颈椎病"
 * 例如: "(A03.06.04.05)颈椎病:风寒湿痹阻证" -> "颈椎病:风寒湿痹阻证"
 * 例如: "I10.001 高血压" -> "高血压"
 */
export function cleanDiagCode(text: string): string {
  if (!text) return ''
  var trimmed = String(text).trim()
  // 0. 去除末尾截断的省略号
  trimmed = trimmed.replace(/\.{2,}$|…+$/g, '').trim()
  // 1. 去掉括号开头的编码 (M47.921)
  trimmed = trimmed.replace(/^\([A-Za-z0-9.+*_\-:]+\)\s*/, '')
  // 2. 去掉以中括号开头的编码 [M47.921]
  trimmed = trimmed.replace(/^\[[A-Za-z0-9.+*_\-:]+\]\s*/, '')
  // 3. 去掉纯字母加数字编码开头的如 "I10.001 " 或 "A03.01 "
  trimmed = trimmed.replace(/^[A-Za-z]\d{2,3}(?:\.\d+)?\s+/, '')
  return trimmed.trim()
}

/**
 * 判断文本是否明显属于中医诊断（含证型特征）
 */
export function isTcmDiagPattern(text: string): boolean {
  if (!text) return false
  var t = text.trim()
  if (t.includes(':') || t.includes('：')) return true
  if (/[证型病]$/.test(t)) return true
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
  defaultDepartment: string = '通州呼吸科二区',
  index: number = 0,
): ClassifiedPatientRow {
  var id = `row-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`

  // 1. 抽取基础字段
  var getVal = (aliases: string[]): string => {
    var key = Object.keys(source).find((k) => aliases.some((a) => normalizeHeader(a) === normalizeHeader(k)))
    return key ? String(source[key] ?? '').trim() : ''
  }

  var patientName = getVal(['姓名', '患者姓名', '病人姓名', '患者', '病人', 'name'])
  var hospitalNo = getVal(['住院号', '住院病案号', '住院号码', 'hospitalNo'])
  var outpatientNo = getVal(['门诊号', '挂号单', '挂号单号', '就诊号', 'outpatientNo'])
  var medicalRecordNo = getVal(['病历号', '病案号', 'medicalRecordNo'])
  
  var rawTcmDiag = getVal(['中医诊断', '中医病名', '中医证型', 'tcmDiag'])
  var rawWmDiag = getVal(['西医诊断', '西医病名', 'wmDiag'])
  var rawGeneralDiag = getVal(['诊断', '主要诊断', '临床诊断', '初步诊断', '门诊诊断', 'diag', 'diagnosis'])

  var operation = getVal(['操作名称', '手术名称', '技术名称', '治疗项目', 'operationName'])
  var admissionDate = getVal(['入院日期', '住院日期', 'admissionDate'])
  var visitDate = getVal(['就诊日期', '接诊日期', '挂号日期', '时间', 'visitDate'])
  var operationDate = getVal(['操作日期', '手术日期', '治疗日期', 'operationDate'])
  var generalDate = getVal(['日期', 'date', '编辑日期'])
  var urgentOrFollowup = getVal(['急复', '初复诊', '初诊/复诊', '就诊类型', '类型', '类别', '号类'])
  var docOrVisitType = getVal(['主管/参观', '带教形式', '医生角色'])
  var deptInRow = getVal(['所在科室', '科室', '就诊科室', '入院科室', '执行科室', '号别', '挂号类别'])
  var remarks = getVal(['备注', 'remarks'])

  // 纠偏 1：防止把“初”、“复”、“急”误识别为病历号/住院号/门诊号
  var checkTypeMisplacement = (val: string) => /^[初复急门住]+(诊)?$/.test(val)
  if (checkTypeMisplacement(medicalRecordNo)) {
    if (!urgentOrFollowup) urgentOrFollowup = medicalRecordNo
    medicalRecordNo = ''
  }
  if (checkTypeMisplacement(outpatientNo)) {
    if (!urgentOrFollowup) urgentOrFollowup = outpatientNo
    outpatientNo = ''
  }
  if (checkTypeMisplacement(hospitalNo)) {
    if (!urgentOrFollowup) urgentOrFollowup = hospitalNo
    hospitalNo = ''
  }

  // 纠偏 2：中西医诊断智能分流
  var tcmDiag = parseTcmDiag(rawTcmDiag)
  var wmDiag = cleanDiagCode(rawWmDiag)

  if (rawGeneralDiag) {
    var cleanedGen = cleanDiagCode(rawGeneralDiag)
    if (isTcmDiagPattern(cleanedGen)) {
      if (!tcmDiag) tcmDiag = cleanedGen
    } else {
      if (!wmDiag) wmDiag = cleanedGen
    }
  }

  // 如果西医诊断里填的是中医证型，自动转移到中医诊断
  if (wmDiag && isTcmDiagPattern(wmDiag) && !tcmDiag) {
    tcmDiag = wmDiag
    wmDiag = ''
  }

  // 时间字段互补与清洗
  var rawTime = visitDate || admissionDate || operationDate || generalDate || ''
  var normalizedDate = cleanDateText(rawTime)
  if (visitDate) visitDate = cleanDateText(visitDate)
  if (admissionDate) admissionDate = cleanDateText(admissionDate)
  if (operationDate) operationDate = cleanDateText(operationDate)
  if (generalDate) generalDate = cleanDateText(generalDate)

  // 就诊类型判断 (初诊/复诊 / 主管/参观)
  var visitType: ClassifiedPatientRow['visitType'] = ''
  if (docOrVisitType.includes('参观')) {
    visitType = '参观'
  } else if (docOrVisitType.includes('主管') || hospitalNo) {
    visitType = '主管'
  }

  if (urgentOrFollowup.includes('复') || urgentOrFollowup.includes('复诊')) {
    visitType = '复诊'
  } else if (urgentOrFollowup.includes('初') || urgentOrFollowup.includes('初诊')) {
    visitType = '初诊'
  }

  // 记录号清洗
  medicalRecordNo = medicalRecordNo.replace(/\.{2,}$|…+$/g, '').trim()
  hospitalNo = hospitalNo.replace(/\.{2,}$|…+$/g, '').trim()
  outpatientNo = outpatientNo.replace(/\.{2,}$|…+$/g, '').trim()

  // 记录号整合
  var recordNo = hospitalNo || outpatientNo || medicalRecordNo || ''

  // 2. 智能分类推断
  var category: PatientCategory = '未分类'
  var inferredReason = ''
  var confidence: 'high' | 'medium' | 'low' = 'medium'

  // 检查是否命中临床技术
  var matchedSkill = CLINICAL_SKILL_KEYWORDS.find(
    (kw) =>
      operation.includes(kw) ||
      tcmDiag.includes(kw) ||
      wmDiag.includes(kw) ||
      deptInRow.includes(kw) ||
      sourceImage.includes(kw)
  )

  if (matchedSkill && !hospitalNo) {
    // 临床技术记录
    category = '临床技术记录'
    if (!operation) {
      operation = matchedSkill.includes('针灸')
        ? '针灸治疗 / 穴位针刺技术'
        : matchedSkill.includes('推拿') || matchedSkill.includes('软伤')
        ? '推拿手法治疗'
        : `${matchedSkill}操作`
    }
    inferredReason = `命中操作/专科关键词「${matchedSkill}」`
    confidence = 'high'
    if (!operationDate && normalizedDate) operationDate = normalizedDate
  } else if (hospitalNo || admissionDate || sourceImage.includes('住院') || sourceImage.includes('出院')) {
    category = '住院病种记录'
    inferredReason = hospitalNo ? `含住院号 ${hospitalNo}` : '识别自住院界面/包含入院特征'
    confidence = 'high'
    if (!visitType) visitType = '主管'
    if (!admissionDate && normalizedDate) admissionDate = normalizedDate
  } else if (outpatientNo || visitDate || urgentOrFollowup || sourceImage.includes('门诊')) {
    category = '门诊病种记录'
    inferredReason = outpatientNo ? `含门诊号 ${outpatientNo}` : '识别自门诊接诊列表'
    confidence = 'high'
    if (!visitType) visitType = '初诊'
    if (!visitDate && normalizedDate) visitDate = normalizedDate
  } else if (sourceImage.includes('大病历') || sourceImage.includes('手写')) {
    category = '手写大病历'
    inferredReason = '文件名含「大病历」'
    confidence = 'high'
    if (!generalDate && normalizedDate) generalDate = normalizedDate
  } else if (sourceImage.includes('病历') || sourceImage.includes('处方')) {
    category = '门诊病历'
    inferredReason = '文件名含「病历」附件'
    confidence = 'medium'
    if (!generalDate && normalizedDate) generalDate = normalizedDate
  } else {
    // 兜底策略
    category = '门诊病种记录'
    inferredReason = '根据通用字段特征默认归入门诊病种'
    confidence = 'low'
  }

  // 科室推断
  var finalDept = defaultDepartment
  if (deptInRow) {
    if (deptInRow.includes('针灸')) finalDept = '通州针灸科'
    else if (deptInRow.includes('软伤') || deptInRow.includes('推拿')) finalDept = '通州软伤推拿科'
    else if (deptInRow.includes('心血管') || deptInRow.includes('心内')) finalDept = '通州心血管二区'
    else if (deptInRow.includes('肾') || deptInRow.includes('内分泌')) finalDept = '通州肾病内分泌四区'
    else if (deptInRow.includes('呼吸')) finalDept = '通州呼吸科二区'
    else finalDept = deptInRow
  }

  return {
    id,
    checked: true,
    sourceImage,
    patientName: patientName || '未命名患者',
    recordNo,
    hospitalNo,
    outpatientNo,
    medicalRecordNo: medicalRecordNo || recordNo,
    tcmDiag,
    wmDiag,
    operationName: operation,
    visitType,
    date: normalizedDate,
    admissionDate: admissionDate || normalizedDate,
    visitDate: visitDate || normalizedDate,
    operationDate: operationDate || normalizedDate,
    generalDate: generalDate || normalizedDate,
    department: finalDept,
    category,
    inferredReason,
    confidence,
    remarks,
    imageFile: category === '手写大病历' || category === '门诊病历' ? sourceImage : '',
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

  if (category === '住院病种记录') {
    hospitalNo = row.hospitalNo || row.recordNo || ''
    visitRole = row.visitType || '主管'
    admissionDate = row.admissionDate || row.date || ''
  } else if (category === '门诊病种记录') {
    visitDate = row.visitDate || row.date || ''
    visitType = row.visitType || '初诊'
    medicalRecordNo = row.outpatientNo || row.medicalRecordNo || row.recordNo || ''
  } else if (category === '临床技术记录') {
    hospitalNo = row.hospitalNo || ''
    medicalRecordNo = row.medicalRecordNo || row.outpatientNo || row.recordNo || ''
    operationDate = row.operationDate || row.date || ''
    operationName = row.operationName || ''
  } else if (category === '手写大病历') {
    hospitalNo = row.hospitalNo || row.recordNo || ''
    medicalRecordNo = row.medicalRecordNo || row.recordNo || ''
    generalDate = row.generalDate || row.date || ''
    if (!imageFile) imageFile = row.sourceImage || ''
  } else if (category === '门诊病历') {
    medicalRecordNo = row.medicalRecordNo || row.outpatientNo || row.recordNo || ''
    generalDate = row.generalDate || row.date || ''
    if (!imageFile) imageFile = row.sourceImage || ''
  } else {
    // 未分类/兜底
    hospitalNo = row.hospitalNo || ''
    medicalRecordNo = row.medicalRecordNo || row.outpatientNo || row.recordNo || ''
    generalDate = row.date || ''
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