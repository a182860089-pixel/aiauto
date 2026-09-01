/** 规培平台「所在科室」离线名单（东直门通州院区，与网站下拉原文一致）。登录同步后以下拉完整列表为准。 */
export const PLATFORM_DEPARTMENT_SEED = [
  '脑病科一区',
  '脑病科二区',
  '脑病科三区',
  '脑病科五区',
  '脑病康复科',
  '心血管一区',
  '心血管二区',
  '心脏康复科',
  '肾病内分泌科一区',
  '肾病内分泌科二区',
  '肾病内分泌科三区',
  '肾病内分泌科四区',
  '脾胃病科一区',
  '脾胃病科二区',
  '呼吸科一区',
  '呼吸科二区',
  '针灸科二区',
  '康复科2',
  '推拿疼痛科二区',
  '皮肤科二区',
  'ICU二区',
  'NICU',
  '儿科二区',
  '耳鼻咽喉头颈外科',
  '风湿病科',
  '妇科二区',
  '骨伤科六区',
  '甲状腺病科',
  '男科二区',
  '普外科三区',
  '神经外科',
  '胸外科',
  '血液科',
  '肿瘤科',
  '眼科二区',
  '周围血管科二区',
  '老年医学科',
].map((name) => (/^通州/.test(name) ? name : `通州${name}`))

export const STORAGE_PLATFORM_DEPARTMENTS = 'ocr-web-platform-depts-v3'

export function compactDepartmentName(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').replace(/^通州/, '').trim()
}

export function departmentZone(value: unknown) {
  var compact = compactDepartmentName(value)
  var matched = compact.match(/([一二三四五六七八九十\d]+)区$/)
  return matched ? matched[1] : ''
}

export function departmentStem(value: unknown) {
  return compactDepartmentName(value)
    .replace(/[一二三四五六七八九十\d]+区$/, '')
    .replace(/科$/, '')
}

function withoutOptionalKe(value: string) {
  return value.replace(/科(?=[一二三四五六七八九十\d]*区$)/, '')
}

export function scoreDepartment(wanted: string, option: string) {
  var rawA = String(wanted ?? '').replace(/\s+/g, '').trim()
  var rawB = String(option ?? '').replace(/\s+/g, '').trim()
  if (!rawA || !rawB || rawB === '请选择') return 0
  if (rawA === rawB) return 110
  var a = compactDepartmentName(wanted)
  var b = compactDepartmentName(option)
  if (!a || !b || b === '请选择') return 0
  if (a === b) return 100
  var aNorm = withoutOptionalKe(a)
  var bNorm = withoutOptionalKe(b)
  if (aNorm === bNorm) return 95
  if (b.includes(a) || a.includes(b) || bNorm.includes(aNorm) || aNorm.includes(bNorm)) {
    var zoneA = departmentZone(a)
    var zoneB = departmentZone(b)
    if (zoneA && zoneB && zoneA !== zoneB) return 40
    return 80
  }
  var stemA = departmentStem(a)
  var stemB = departmentStem(b)
  var zoneA = departmentZone(a)
  var zoneB = departmentZone(b)
  if (stemA && stemA === stemB) {
    if (zoneA && zoneB && zoneA === zoneB) return 90
    if (zoneA && zoneB && zoneA !== zoneB) return 40
    return 60
  }
  if (stemA && stemB && (stemB.includes(stemA) || stemA.includes(stemB))) {
    if (zoneA && zoneB && zoneA === zoneB) return 70
    if (zoneA && zoneB && zoneA !== zoneB) return 35
    return 45
  }
  return 0
}

export function matchDepartment(wanted: string, options: string[] = []) {
  var best = { option: '', score: 0 }
  options.forEach((option) => {
    var score = scoreDepartment(wanted, option)
    if (score > best.score) best = { option, score }
  })
  return best.score >= 45 ? best.option : ''
}

export function platformDepartmentOptions(options: string[] = []) {
  return uniqueDepartments(options)
}

export function uniqueDepartments(values: Array<string | undefined | null> = []) {
  var seen = new Set<string>()
  var result: string[] = []
  values.forEach((item) => {
    var value = String(item || '').trim()
    if (!value || value === '请选择' || seen.has(value)) return
    seen.add(value)
    result.push(value)
  })
  return result
}

function uniqueDisplayDepartments(values: Array<string | undefined | null> = []) {
  var byKey = new Map<string, string>()
  values.forEach((item) => {
    var value = String(item || '').trim()
    if (!value || value === '请选择') return
    var key = compactDepartmentName(value) || value
    var prev = byKey.get(key)
    if (!prev || (/^通州/.test(value) && !/^通州/.test(prev))) byKey.set(key, value)
  })
  return Array.from(byKey.values())
}

/** 界面下拉用网站原文：旧缓存「呼吸科二区」写成「通州呼吸科二区」。匹配网页控件时不要走这里。 */
export function toPlatformDepartmentName(value: unknown, options: string[] = PLATFORM_DEPARTMENT_SEED) {
  var raw = String(value ?? '').replace(/\s+/g, '').trim()
  if (!raw || raw === '请选择') return ''
  var pool = uniqueDepartments(options.length ? options : PLATFORM_DEPARTMENT_SEED)
  var matched = matchDepartment(raw, pool)
  var next = matched || raw
  return /^通州/.test(next) ? next : `通州${next}`
}

export function mergeDepartmentOptions(customDepartments: string[] = [], platformDepartments: string[] = []) {
  var synced = uniqueDepartments(platformDepartments.map((item) => toPlatformDepartmentName(item)))
  var seed = uniqueDepartments(PLATFORM_DEPARTMENT_SEED)
  var pool = synced.length >= seed.length ? synced : uniqueDepartments([...synced, ...seed])
  var remapped = customDepartments.map((item) => toPlatformDepartmentName(item, pool))
  return uniqueDisplayDepartments([...pool, ...remapped])
}

export function rememberDepartment(current: string[], next: string) {
  var pool = uniqueDepartments([...current, ...PLATFORM_DEPARTMENT_SEED])
  var value = toPlatformDepartmentName(next, pool)
  if (!value || current.includes(value)) return current
  return [...current, value]
}

export function loadStoredPlatformDepartments() {
  try {
    var raw = localStorage.getItem(STORAGE_PLATFORM_DEPARTMENTS)
      || localStorage.getItem('ocr-web-platform-depts-v2')
      || localStorage.getItem('ocr-web-platform-depts')
    var parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? uniqueDepartments(parsed.map((item) => toPlatformDepartmentName(item))) : []
  } catch {
    return []
  }
}

export function saveStoredPlatformDepartments(departments: string[]) {
  var next = uniqueDepartments(departments.map((item) => toPlatformDepartmentName(item)))
  localStorage.setItem(STORAGE_PLATFORM_DEPARTMENTS, JSON.stringify(next))
  return next
}
