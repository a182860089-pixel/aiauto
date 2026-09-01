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

export type PlatformFillRecord = {
  id: string
  category: '住院病种记录'
  fields: PlatformRecordFields
}

const PLACEHOLDER_NAMES = new Set(['未命名患者', '未知', '无名'])

function text(value: unknown) {
  return String(value ?? '').trim()
}

/**
 * 将住院病种行转换成平台新增表单字段。
 */
export function toInpatientPlatformFields(row: ClassifiedPatientRow): PlatformRecordFields | null {
  const patientName = text(row.patientName)
  const hospitalNo = text(row.hospitalNo || row.recordNo || row.outpatientNo)
  return {
    PatientName: patientName,
    HospitalNo: hospitalNo,
    Diagnosis: text(row.tcmDiag),
    DiagnosisWestern: text(row.wmDiag),
    CreationTime: text(row.admissionDate || row.date),
    Department: text(row.department),
    VisitRole: text(row.visitType) || '主管',
    Remarks: text(row.remarks),
  }
}

/**
 * 只接受已勾选行，供登录后逐条添加并确定。全部可录入，不因类别或缺字段跳过。
 */
export function selectInpatientFillRecords(rows: ClassifiedPatientRow[]): PlatformFillRecord[] {
  return rows.flatMap((row) => {
    if (!row.checked) return []
    const fields = toInpatientPlatformFields(row)
    if (!fields) return []
    return [{ id: row.id, category: '住院病种记录' as const, fields }]
  })
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
