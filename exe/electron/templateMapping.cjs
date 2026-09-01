var TEMPLATE_COLUMNS = [
  '记录类别', '所在科室', '病人姓名', '住院号', '中医诊断', '西医诊断', '主管/参观',
  '住院日期', '就诊日期', '初诊/复诊', '病历号', '操作日期', '操作名称', '日期', '备注', '图片文件',
]

var RECORD_CATEGORY_OPTIONS = ['住院病种记录', '门诊病种记录', '临床技术记录', '手写大病历', '门诊病历']
var DEFAULT_DEPARTMENT_OPTIONS = ['通州呼吸科二区', '通州心血管二区', '通州肾病内分泌四区']

var TEMPLATE_HEADER_ALIASES = {
  记录类别: ['记录类别', '记录类型'], 所在科室: ['所在科室', '科室', '就诊科室', '入院科室'],
  中医诊断: ['中医诊断', '中医诊', '中医病名', '中医诊断病名'],
  西医诊断: ['西医诊断', '西医诊', '西医病名', '西医诊断病名'], '主管/参观': ['主管/参观'], 住院日期: ['住院日期', '入院日期', 'admissionDate'],
  就诊日期: ['就诊日期', 'visitDate'], '初诊/复诊': ['初诊/复诊', '初诊复诊'], 病历号: ['病历号', 'medicalRecordNo'],
  操作日期: ['操作日期', 'operationDate'], 操作名称: ['操作名称', 'operationName'], 日期: ['日期'], 备注: ['备注', 'remarks'], 图片文件: ['图片文件', 'imageFile'],
}

function normalizeHeader(value) {
  return String(value == null ? '' : value).replace(/[\s　]/g, '').toLowerCase()
}

function toRowObject(row, columns) {
  if (Array.isArray(row)) return Object.fromEntries(columns.map((column, index) => [column, String(row[index] == null ? '' : row[index])]))
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, String(value == null ? '' : value)]))
}

function findSourceKey(header, source) {
  var candidates = TEMPLATE_HEADER_ALIASES[header] || [header]
  var normalizedCandidates = candidates.map(normalizeHeader)
  return Object.keys(source).find((key) => normalizedCandidates.includes(normalizeHeader(key)))
}

function matchesHeader(header, column) {
  var aliases = TEMPLATE_HEADER_ALIASES[header] || [header]
  return aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(column))
}

function resolveCellValue(header, source, overrides) {
  var sourceKey = findSourceKey(header, source)
  var value = sourceKey ? String(source[sourceKey] || '').trim() : ''
  return value || String((overrides || {})[header] || '').trim()
}

/**
 * 校验图片中没有的模板字段是否已人工补齐。
 * @param {Record<string, string>|undefined} overrides 人工选择的记录类别和所在科室
 * @return {string} 错误文案，通过时返回空字符串
 */
function getManualOverrideError(overrides) {
  if (!String(overrides && overrides.记录类别 || '').trim()) return '请先选择记录类别'
  if (!String(overrides && overrides.所在科室 || '').trim()) return '请先选择或输入所在科室'
  return ''
}

/**
 * 拦截未选择的记录类别或所在科室。
 * @param {Record<string, string>|undefined} overrides 人工选择值
 * @return {{记录类别: string, 所在科室: string}} 去掉首尾空格后的覆盖值
 */
function requireManualOverrides(overrides) {
  var error = getManualOverrideError(overrides)
  if (error) throw new Error(error)
  return {
    记录类别: String(overrides && overrides.记录类别 || '').trim(),
    所在科室: String(overrides && overrides.所在科室 || '').trim(),
  }
}

function rememberDepartment(current, next) {
  var value = String(next || '').trim()
  if (!value || current.includes(value) || DEFAULT_DEPARTMENT_OPTIONS.includes(value)) return current
  return current.concat(value)
}

/**
 * 只保留勾选行，并写入人工指定的记录类别和科室。
 * @param {string[]} columns OCR 表头
 * @param {Array<Record<string, unknown>|unknown[]>} rows OCR 数据行
 * @param {number[]} selectedIndexes 勾选行下标
 * @param {string[]} templateHeaders 模板表头
 * @param {Record<string, string>} overrides 人工覆盖值
 * @return {{ rows: string[][], matchedColumns: string[], ignoredColumns: string[] }} 映射结果
 */
function mapSelectedOcrRowsToTemplate(columns, rows, selectedIndexes, templateHeaders, overrides) {
  var sourceRows = rows || []
  var selectedRows = (selectedIndexes || []).filter((index) => index >= 0 && index < sourceRows.length).map((index) => sourceRows[index])
  return mapOcrRowsToTemplate(columns, selectedRows, templateHeaders, overrides)
}

function mapOcrRowsToTemplate(columns, rows, templateHeaders, overrides) {
  var normalizedColumns = (columns || []).map(String).filter(Boolean)
  var headers = templateHeaders && templateHeaders.length ? templateHeaders : TEMPLATE_COLUMNS
  var sourceOverrides = overrides || {}
  var matchedFromOcr = headers.filter((header) => normalizedColumns.some((column) => matchesHeader(header, column)))
  var matchedFromOverrides = headers.filter((header) => String(sourceOverrides[header] || '').trim())
  var matchedColumns = headers.filter((header) => matchedFromOcr.includes(header) || matchedFromOverrides.includes(header))
  var ignoredColumns = normalizedColumns.filter((column) => !matchedFromOcr.some((header) => matchesHeader(header, column)))
  var mappedRows = (rows || []).map((row) => {
    var source = toRowObject(row, normalizedColumns)
    return headers.map((header) => resolveCellValue(header, source, sourceOverrides))
  }).filter((row) => row.some((value) => value !== ''))
  return { rows: mappedRows, matchedColumns, ignoredColumns }
}

module.exports = {
  TEMPLATE_COLUMNS,
  TEMPLATE_HEADER_ALIASES,
  RECORD_CATEGORY_OPTIONS,
  DEFAULT_DEPARTMENT_OPTIONS,
  normalizeHeader,
  getManualOverrideError,
  requireManualOverrides,
  rememberDepartment,
  mapOcrRowsToTemplate,
  mapSelectedOcrRowsToTemplate,
}