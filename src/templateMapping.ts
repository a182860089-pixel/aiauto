export type OcrRow = Record<string, unknown> | string[]

export type TemplateMappingSummary = {
  rows: string[][]
  matchedColumns: string[]
  ignoredColumns: string[]
}

export type TemplateOverrides = Record<string, string>

import {
  PLATFORM_DEPARTMENT_SEED,
  mergeDepartmentOptions as mergeDepartments,
  rememberDepartment as rememberCustomDepartment,
} from './departments'

export const RECORD_CATEGORY_OPTIONS = ['住院病种记录', '门诊病种记录', '临床技术记录', '手写大病历', '门诊病历']

export const DEFAULT_DEPARTMENT_OPTIONS = PLATFORM_DEPARTMENT_SEED

export const TEMPLATE_COLUMNS = [
  '记录类别', '所在科室', '病人姓名', '住院号', '中医诊断', '西医诊断', '主管/参观',
  '住院日期', '就诊日期', '初诊/复诊', '病历号', '操作日期', '操作名称', '日期', '备注', '图片文件',
]

/** 只收录语义明确的 OCR 表头别名，避免模糊填充。 */
export const TEMPLATE_HEADER_ALIASES: Record<string, string[]> = {
  记录类别: ['记录类别', '记录类型'],
  所在科室: ['所在科室', '科室', '就诊科室', '入院科室'],
  病人姓名: ['病人姓名', '患者姓名', '姓名', '患者', 'patientName', 'patient_name'],
  住院号: ['住院号', 'hospitalNo'],
  中医诊断: ['中医诊断', '中医诊', '中医病名', '中医诊断病名'],
  西医诊断: ['西医诊断', '西医诊', '西医病名', '西医诊断病名', '西医', '西诊'],
  '主管/参观': ['主管/参观'],
  住院日期: ['住院日期', '入院日期', 'admissionDate'],
  就诊日期: ['就诊日期', 'visitDate'],
  '初诊/复诊': ['初诊/复诊', '初诊复诊'],
  病历号: ['病历号', 'medicalRecordNo'],
  操作日期: ['操作日期', 'operationDate'],
  操作名称: ['操作名称', 'operationName'],
  日期: ['日期'],
  备注: ['备注', 'remarks'],
  图片文件: ['图片文件', 'imageFile'],
}

export function normalizeHeader(value: unknown) {
  return String(value ?? '').replace(/[\s　:_：/\\()（）\[\]【】.-]/g, '').toLowerCase()
}

function toRowObject(row: OcrRow, columns: string[]) {
  if (Array.isArray(row)) return Object.fromEntries(columns.map((column, index) => [column, String(row[index] ?? '')]))
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, String(value ?? '')]))
}

function findSourceKey(header: string, source: Record<string, string>) {
  var candidates = TEMPLATE_HEADER_ALIASES[header] || [header]
  var normalizedCandidates = candidates.map(normalizeHeader)
  return Object.keys(source).find((key) => normalizedCandidates.includes(normalizeHeader(key)))
}

function matchesHeader(header: string, column: string) {
  var aliases = TEMPLATE_HEADER_ALIASES[header] || [header]
  return aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(column))
}

function resolveCellValue(header: string, source: Record<string, string>, overrides: TemplateOverrides) {
  var sourceKey = findSourceKey(header, source)
  var value = sourceKey ? String(source[sourceKey] ?? '').trim() : ''
  return value || String(overrides[header] ?? '').trim()
}

/**
 * 校验图片中没有的模板字段是否已人工补齐。
 * @param overrides 人工选择的记录类别和所在科室
 * @return 错误文案，通过时返回空字符串
 */
export function getManualOverrideError(overrides?: TemplateOverrides) {
  if (!String(overrides?.记录类别 ?? '').trim()) return '请先选择记录类别'
  if (!String(overrides?.所在科室 ?? '').trim()) return '请先选择或输入所在科室'
  return ''
}

/**
 * 拦截未选择的记录类别或所在科室。
 * @param overrides 人工选择值
 * @return 去掉首尾空格后的覆盖值
 */
export function requireManualOverrides(overrides?: TemplateOverrides) {
  var error = getManualOverrideError(overrides)
  if (error) throw new Error(error)
  return {
    记录类别: String(overrides?.记录类别 || '').trim(),
    所在科室: String(overrides?.所在科室 || '').trim(),
  }
}

/**
 * 合并平台同步科室、默认科室和手输科室，供下拉使用。
 */
export function mergeDepartmentOptions(customDepartments: string[] = [], platformDepartments: string[] = []) {
  return mergeDepartments(customDepartments, platformDepartments)
}

/**
 * 把新科室记入手输列表，输入过程中的半成品不保存。
 */
export function rememberDepartment(current: string[], next: string) {
  return rememberCustomDepartment(current, next)
}

/**
 * 只保留勾选行，并写入人工指定的记录类别和科室。
 * @param columns OCR 表头
 * @param rows OCR 数据行
 * @param selectedIndexes 勾选行下标
 * @param templateHeaders 模板表头
 * @param overrides 人工覆盖值
 * @return 映射结果
 */
export function mapSelectedOcrRowsToTemplate(
  columns: string[],
  rows: OcrRow[],
  selectedIndexes: number[],
  templateHeaders: string[] = TEMPLATE_COLUMNS,
  overrides: TemplateOverrides = {},
) {
  var selectedRows = selectedIndexes
    .filter((index) => index >= 0 && index < rows.length)
    .map((index) => rows[index])
  return mapOcrRowsToTemplate(columns, selectedRows, templateHeaders, overrides)
}

/** 将 OCR 原始表格映射到模板固定列，不新增图片中的额外列。 */
export function mapOcrRowsToTemplate(
  columns: string[],
  rows: OcrRow[],
  templateHeaders: string[] = TEMPLATE_COLUMNS,
  overrides: TemplateOverrides = {},
): TemplateMappingSummary {
  var normalizedColumns = columns.map(String).filter(Boolean)
  var matchedFromOcr = templateHeaders.filter((header) => normalizedColumns.some((column) => matchesHeader(header, column)))
  var matchedFromOverrides = templateHeaders.filter((header) => String(overrides[header] ?? '').trim())
  var matchedColumns = templateHeaders.filter((header) => matchedFromOcr.includes(header) || matchedFromOverrides.includes(header))
  var ignoredColumns = normalizedColumns.filter((column) => !matchedFromOcr.some((header) => matchesHeader(header, column)))
  var mappedRows = rows.map((row) => {
    var source = toRowObject(row, normalizedColumns)
    return templateHeaders.map((header) => resolveCellValue(header, source, overrides))
  }).filter((row) => row.some((value) => value !== ''))
  return { rows: mappedRows, matchedColumns, ignoredColumns }
}

export function buildRowIdentity(row: Record<string, string>, columns: string[]) {
  var get = (aliases: string[]) => {
    var key = Object.keys(row).find((candidate) => aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(candidate)))
    return key ? String(row[key] || '').replace(/\s/g, '') : ''
  }
  var id = get(['身份证号'])
  if (id) return `id:${id}`
  var hospitalNo = get(['住院号'])
  if (hospitalNo) return `hospital:${hospitalNo}`
  var name = get(['姓名', '患者姓名', '病人姓名'])
  var date = get(['入院日期', '住院日期', '就诊日期', '日期', '编辑日期'])
  if (name || date) return `name-date:${name}\u0001${date}`
  return columns.map((column) => String(row[column] || '').replace(/\s/g, '')).join('\u0001')
}
