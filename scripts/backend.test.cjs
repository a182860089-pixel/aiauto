const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

let backend

test.before(async () => {
  backend = await import('../.backend-dist/index.js')
})

test('repairs truncated model JSON and normalizes row schema', () => {
  const result = backend.parseVisionJson('{"table":{"columns":["病历号","诊断"],"rows":[["A-1","肺炎"],]}')
  assert.deepEqual(result.table.columns, ['病历号', '诊断'])
  assert.deepEqual(result.table.rows, [['A-1', '肺炎']])
})

test('merges reordered slice columns and removes repeated boundary rows', () => {
  const result = backend.mergeVisionResults([
    { sliceIndex: 1, fields: {}, table: { columns: ['诊断', '病历号'], rows: [['肺炎', '001'], ['哮喘', '002']] } },
    { sliceIndex: 0, fields: {}, table: { columns: ['病历号', '诊断'], rows: [['001', '肺炎'], ['003', '高血压']] } },
  ])
  assert.deepEqual(result.columns, ['诊断', '病历号'])
  assert.equal(result.rows.length, 3)
  assert.deepEqual(result.rows[0], ['肺炎', '001'])
  assert.equal(result.records.find((row) => row.patientNo === '001').westernDiagnosis, '肺炎')
})

test('routes Chinese diagnosis and recovers visit status from number fields', () => {
  const result = backend.normalizeRecord({ 病历号: 'ZY-203 初', 诊断: '咳嗽：风热犯肺证', 日期: '2026年8月9日', 备注: '待定......' })
  assert.equal(result.patientNo, 'ZY-203')
  assert.equal(result.visitType, '初诊')
  assert.equal(result.chineseDiagnosis, '咳嗽')
  assert.equal(result.chinesePattern, '风热犯肺证')
  assert.equal(result.visitDate, '2026-08-09')
  assert.equal(result.remarks, '待定…')
})

test('strips ICD-10 variants only from diagnosis text', () => {
  assert.equal(backend.stripIcdCodes('颈椎病 (M47.921)，高血压[I10.001] I10'), '颈椎病 高血压')
})

test('smart slicing returns ordered slices with repeated header metadata', async () => {
  const sharp = (await import('sharp')).default
  const width = 320
  const height = 2200
  const pixels = Buffer.alloc(width * height, 255)
  for (let y = 90; y < height; y += 110) for (let x = 0; x < width; x += 1) pixels[y * width + x] = 20
  const png = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer()
  const original = `data:image/png;base64,${png.toString('base64')}`
  const prepared = await backend.preprocessImage(original, 2400)
  const slices = await backend.smartSlice(prepared.dataUrl, { maxBodyHeight: 500 })
  assert.ok(slices.length > 1)
  assert.equal(slices[0].headerYStart, 0)
  assert.ok(slices.every((slice) => slice.headerYEnd > 0 && slice.sourceYEnd > slice.sourceYStart))
  assert.deepEqual(slices.map((slice) => slice.index), slices.map((_, index) => index))
})

test('persists checkpoints and reuses the content-addressed result cache', async () => {
  const sharp = (await import('sharp')).default
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiauto-job-'))
  const png = await sharp({ create: { width: 120, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  let calls = 0
  const makeInput = (name) => ({
    imageName: name, dataUrl, model: 'test-model',
    infer: async ({ sliceIndex }) => { calls += 1; return { sliceIndex, fields: {}, table: { columns: ['病历号', '诊断'], rows: [[String(sliceIndex), '肺炎']] } } },
  })
  const store = new backend.JobStore(root)
  const service = new backend.OcrJobService(store)
  const first = await service.createAndRun(makeInput('one.png'))
  assert.equal(first.stage, 'COMPLETED')
  const callsAfterFirst = calls
  const second = await service.createAndRun(makeInput('two.png'))
  assert.equal(second.stage, 'COMPLETED')
  assert.equal(calls, callsAfterFirst)
  await fs.rm(root, { recursive: true, force: true })
})
