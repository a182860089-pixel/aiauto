const test = require('node:test')
const assert = require('node:assert/strict')
const {
  matchDepartment,
  scoreDepartment,
  uniqueDepartments,
  PLATFORM_DEPARTMENT_SEED,
} = require('../electron/departments.cjs')

test('departments: 离线种子带通州字样且覆盖常见病区', () => {
  assert.ok(PLATFORM_DEPARTMENT_SEED.every((name) => /^通州/.test(name)))
  assert.ok(PLATFORM_DEPARTMENT_SEED.length >= 30)
  assert.ok(PLATFORM_DEPARTMENT_SEED.includes('通州针灸科二区'))
  assert.ok(PLATFORM_DEPARTMENT_SEED.includes('通州心血管二区'))
  assert.ok(PLATFORM_DEPARTMENT_SEED.includes('通州肾病内分泌科四区'))
  assert.ok(PLATFORM_DEPARTMENT_SEED.includes('通州呼吸科二区'))
})

test('departments: 去掉通州前缀后精确匹配平台科室', () => {
  assert.equal(matchDepartment('通州呼吸科二区', ['呼吸科一区', '呼吸科二区']), '呼吸科二区')
  assert.equal(matchDepartment('通州呼吸科二区', PLATFORM_DEPARTMENT_SEED), '通州呼吸科二区')
  assert.equal(matchDepartment('呼吸科二区', PLATFORM_DEPARTMENT_SEED), '通州呼吸科二区')
  assert.equal(scoreDepartment('通州呼吸科二区', '呼吸科二区'), 100)
  assert.equal(scoreDepartment('通州呼吸科二区', '通州呼吸科二区'), 110)
})

test('departments: 同专科按病区精确匹配，不串到其他病区', () => {
  assert.equal(matchDepartment('通州呼吸科二区', ['呼吸科一区', '脑病科一区']), '')
  assert.equal(matchDepartment('通州肾病内分泌四区', PLATFORM_DEPARTMENT_SEED), '通州肾病内分泌科四区')
  assert.equal(matchDepartment('通州心血管二区', PLATFORM_DEPARTMENT_SEED), '通州心血管二区')
  assert.equal(matchDepartment('通州针灸科二区', PLATFORM_DEPARTMENT_SEED), '通州针灸科二区')
})

test('departments: 同时存在通州和本院区时优先网站原文', () => {
  assert.equal(
    matchDepartment('通州呼吸科二区', ['呼吸科二区', '通州呼吸科二区', '通州呼吸科一区']),
    '通州呼吸科二区',
  )
})

test('departments: 对不上的专科不误匹配', () => {
  assert.equal(matchDepartment('通州皮肤科一区', ['呼吸科一区', '脑病科一区']), '')
  assert.equal(uniqueDepartments(['脑病科一区', '脑病科一区', '请选择', '']).join(','), '脑病科一区')
})

test('departments: 下拉回显通州平台科室名', () => {
  const { mergeDepartmentOptions } = require('../electron/departments.cjs')
  const options = mergeDepartmentOptions(['通州呼吸科二区', '通州心血管二区', '通州肾病内分泌四区'], [])
  assert.equal(options.includes('通州呼吸科二区'), true)
  assert.equal(options.includes('通州心血管二区'), true)
  assert.equal(options.includes('通州肾病内分泌科四区'), true)
  assert.equal(options.includes('通州针灸科二区'), true)
  assert.ok(options.length > 20)
  assert.equal(options[0], '通州脑病科一区')
})

test('departments: 已同步完整名单覆盖离线种子', () => {
  const { mergeDepartmentOptions } = require('../electron/departments.cjs')
  const synced = PLATFORM_DEPARTMENT_SEED.concat(['通州急诊科'])
  const options = mergeDepartmentOptions([], synced)
  assert.equal(options.includes('通州急诊科'), true)
  assert.equal(options.length, synced.length)
})

test('departments: 同步数量少于种子时保留离线名单', () => {
  const { mergeDepartmentOptions } = require('../electron/departments.cjs')
  const options = mergeDepartmentOptions([], ['通州呼吸科二区', '通州针灸科二区'])
  assert.equal(options.includes('通州呼吸科二区'), true)
  assert.equal(options.includes('通州针灸科二区'), true)
  assert.equal(options.includes('通州脑病科一区'), true)
  assert.ok(options.length > 20)
})

test('departments: 旧缓存无通州字样时下拉补回平台原文', () => {
  const { mergeDepartmentOptions, toPlatformDepartmentName } = require('../electron/departments.cjs')
  const oldCache = PLATFORM_DEPARTMENT_SEED.map((name) => name.replace(/^通州/, ''))
  assert.equal(oldCache.includes('呼吸科二区'), true)
  const options = mergeDepartmentOptions(['呼吸科二区', '心血管二区'], oldCache)
  assert.ok(options.every((name) => /^通州/.test(name)))
  assert.equal(options.includes('通州呼吸科二区'), true)
  assert.equal(options.includes('通州心血管二区'), true)
  assert.equal(options.includes('呼吸科二区'), false)
  assert.equal(toPlatformDepartmentName('呼吸科二区'), '通州呼吸科二区')
  assert.equal(toPlatformDepartmentName('通州急诊科'), '通州急诊科')
})
