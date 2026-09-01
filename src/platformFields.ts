import { inferPatientRow, type ClassifiedPatientRow, type PatientCategory } from './smartClassifier'

export type PlatformRecordFields = {
  PatientName: string
  HospitalNo: string
  Diagnosis: string
  DiagnosisWestern: string
  CreationTime: string
  Department: string
  VisitRole: string
  Remarks: string
}

export type PlatformFillCategory = PatientCategory | '住院病种记录'

export type PlatformFillRecord = {
  id: string
  category: PlatformFillCategory
  fields: PlatformRecordFields & {
    RecordCategory?: string
    OperationName?: string
  }
}

const PLACEHOLDER_NAMES = new Set(['未命名患者', '未知', '无名'])

function text(value: unknown) {
  return String(value ?? '').trim()
}

function resolveFillCategory(row: ClassifiedPatientRow, forceInpatient = false): Exclude<PatientCategory, '未分类'> {
  if (forceInpatient) return '住院病种记录'
  if (row.category && row.category !== '未分类') return row.category
  return '住院病种记录'
}

function dateForCategory(row: ClassifiedPatientRow, category: string) {
  if (category === '住院病种记录') return text(row.admissionDate || row.date || row.generalDate)
  if (category === '门诊病种记录') return text(row.visitDate || row.date || row.generalDate)
  if (category === '临床技术记录') return text(row.operationDate || row.date || row.generalDate)
  return text(row.date || row.generalDate || row.admissionDate || row.visitDate)
}

function visitRoleForCategory(row: ClassifiedPatientRow, category: string) {
  if (category === '住院病种记录') return row.visitType === '参观' ? '参观' : '主管'
  if (category === '门诊病种记录') return row.visitType === '复诊' ? '复诊' : '初诊'
  return text(row.visitType)
}

function hospitalNoForCategory(row: ClassifiedPatientRow, category: string) {
  if (category === '门诊病种记录' || category === '门诊病历') {
    return text(row.outpatientNo || row.medicalRecordNo || row.recordNo || row.hospitalNo)
  }
  return text(row.hospitalNo || row.recordNo || row.outpatientNo || row.medicalRecordNo)
}

/**
 * 将一行转换成平台新增表单字段，按记录类别选择日期、号码和角色。
 */
export function toPlatformFields(row: ClassifiedPatientRow, forceInpatient = false): PlatformFillRecord['fields'] {
  const category = resolveFillCategory(row, forceInpatient)
  return {
    PatientName: text(row.patientName),
    HospitalNo: hospitalNoForCategory(row, category),
    Diagnosis: text(row.tcmDiag),
    DiagnosisWestern: text(row.wmDiag),
    CreationTime: dateForCategory(row, category),
    Department: text(row.department),
    VisitRole: visitRoleForCategory(row, category),
    Remarks: text(row.remarks),
    OperationName: text(row.operationName),
    RecordCategory: category,
  }
}

/**
 * 将住院病种行转换成平台新增表单字段。
 */
export function toInpatientPlatformFields(row: ClassifiedPatientRow): PlatformRecordFields | null {
  return toPlatformFields(row, true)
}

export type SelectFillOptions = {
  forceInpatient?: boolean
}

/**
 * 只接受已勾选行。默认保留 Excel/识别页的记录类别；forceInpatient 时全部按住院病种填。
 */
export function selectPlatformFillRecords(rows: ClassifiedPatientRow[], options: SelectFillOptions = {}): PlatformFillRecord[] {
  return rows.flatMap((row) => {
    if (!row.checked) return []
    const category = resolveFillCategory(row, options.forceInpatient)
    const fields = toPlatformFields(row, options.forceInpatient)
    if (!fields) return []
    return [{ id: row.id, category, fields }]
  })
}

/**
 * 只接受已勾选行，供登录后逐条添加并确定。全部按住院病种填入。
 */
export function selectInpatientFillRecords(rows: ClassifiedPatientRow[]): PlatformFillRecord[] {
  return selectPlatformFillRecords(rows, { forceInpatient: true })
}

export function describeSkippedInpatientRows(rows: ClassifiedPatientRow[]) {
  const checked = rows.filter((row) => row.checked)
  const inpatient = checked.filter((row) => row.category === '住院病种记录')
  const fillable = selectInpatientFillRecords(rows)
  return {
    checkedCount: checked.length,
    inpatientCount: inpatient.length,
    fillableCount: fillable.length,
    skippedOtherCategory: checked.length - inpatient.length,
    skippedIncomplete: inpatient.length - fillable.length,
  }
}

export type PlatformSkipReason = '' | '非住院' | '缺字段'

/**
 * 判断一行能否填入。全部可录入，不再跳过。
 */
export function getPlatformSkipReason(_row: ClassifiedPatientRow): PlatformSkipReason {
  return ''
}

/**
 * 平台预览用：全部默认勾选，均可填入。
 */
export function preparePlatformPreviewRows(rows: ClassifiedPatientRow[]): ClassifiedPatientRow[] {
  return rows.map((row) => ({
    ...row,
    checked: true,
  }))
}

/**
 * 只有图片对应的住院号列有值时才生成住院号；记录类别由人工指定，但号码和诊断仍保持原列来源。
 */
export function forceRowsAsInpatient(rows: ClassifiedPatientRow[]): ClassifiedPatientRow[] {
  return rows.map((row) => ({
    ...row,
    category: '住院病种记录' as const,
    hospitalNo: text(row.hospitalNo || row.recordNo),
    checked: true,
    isManualModified: true,
  }))
}

export type OcrTableSource = {
  columns?: string[]
  rows?: Array<Record<string, unknown> | string[]>
}

/**
 * 把 OCR/Excel 勾选行转成分类记录，供住院病种填表使用。
 */
export function classifiedRowsFromOcrTable(
  table: OcrTableSource | undefined,
  selectedIndexes: number[],
  options: { sourceImage?: string; department?: string; category?: PatientCategory | '' } = {},
): ClassifiedPatientRow[] {
  const columns = table?.columns || []
  const rows = table?.rows || []
  return selectedIndexes.flatMap((index) => {
    const row = rows[index]
    if (row == null) return []
    const source = Array.isArray(row)
      ? Object.fromEntries(columns.map((column, columnIndex) => [column, String(row[columnIndex] ?? '')]))
      : Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))
    const classified = inferPatientRow(source, options.sourceImage || '', options.department || '', index)
    classified.id = `ocr-${index}`
    classified.checked = true
    if (options.department) classified.department = options.department
    if (options.category) classified.category = options.category
    return [classified]
  })
}

/**
 * 没有表格行时，把旧版勾选字段凑成一条住院病种记录。
 */
export function snapshotToFallbackRecord(fields: Record<string, string>): PlatformFillRecord[] {
  const mapped: PlatformRecordFields = {
    PatientName: text(fields.PatientName),
    HospitalNo: text(fields.HospitalNo),
    Diagnosis: text(fields.Diagnosis),
    DiagnosisWestern: text(fields.DiagnosisWestern),
    CreationTime: text(fields.CreationTime),
    Department: text(fields.Department),
    VisitRole: text(fields.VisitRole) || '主管',
    Remarks: text(fields.Remarks),
  }
  if (!mapped.PatientName || PLACEHOLDER_NAMES.has(mapped.PatientName) || !mapped.HospitalNo || (!mapped.Diagnosis && !mapped.DiagnosisWestern)) {
    return []
  }
  return [{ id: 'snapshot-0', category: '住院病种记录', fields: mapped }]
}
