const test = require('node:test')
const assert = require('node:assert/strict')

const PLACEHOLDER_NAMES = new Set(['未命名患者', '未知', '无名'])

function text(value) {
  return String(value ?? '').trim()
}

function toInpatientPlatformFields(row) {
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

function selectInpatientFillRecords(rows) {
  return rows.flatMap((row) => {
    if (!row.checked) return []
    const fields = toInpatientPlatformFields(row)
    if (!fields) return []
    return [{ id: row.id, category: '住院病种记录', fields }]
  })
}

function snapshotToFallbackRecord(fields) {
  const mapped = {
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

test('platformFields: 住院病种行转成平台填表记录并自动提交候选', () => {
  const classified = [
    { id: 'ocr-0', checked: true, category: '住院病种记录', patientName: '杨旭', hospitalNo: '376813', recordNo: '376813', tcmDiag: '咳嗽病:风热犯肺证', wmDiag: '急性支气管炎', admissionDate: '2026-06-01', date: '2026-06-01', department: '通州呼吸科二区', visitType: '主管', remarks: '' },
    { id: 'ocr-1', checked: true, category: '住院病种记录', patientName: '李四', hospitalNo: '009281', recordNo: '009281', tcmDiag: '', wmDiag: '', admissionDate: '2026-06-02', date: '2026-06-02', department: '通州呼吸科二区', visitType: '主管', remarks: '' },
  ]
  const records = selectInpatientFillRecords(classified)
  assert.equal(records.length, 2)
  assert.equal(records[0].fields.PatientName, '杨旭')
  assert.equal(records[0].fields.HospitalNo, '376813')
  assert.equal(records[0].fields.Diagnosis, '咳嗽病:风热犯肺证')
  assert.equal(records[0].fields.Department, '通州呼吸科二区')
  assert.equal(records[1].fields.PatientName, '李四')
  assert.equal(records[1].fields.HospitalNo, '009281')
})

test('platformFields: 缺姓名住院号或诊断时不进入自动提交', () => {
  const records = snapshotToFallbackRecord({
    PatientName: '未命名患者',
    HospitalNo: '123',
    Diagnosis: '肺炎',
  })
  assert.deepEqual(records, [])
})

test('platformFields: 门诊行和缺诊断行勾选后仍可填入', () => {
  const classified = [
    { id: 'ocr-2', checked: true, category: '门诊病种记录', patientName: '王建国', hospitalNo: '', recordNo: '99115370422', outpatientNo: '99115370422', tcmDiag: '眩晕:肝阳上亢证', wmDiag: '原发性高血压', admissionDate: '', date: '2026-08-02', department: '通州呼吸科二区', visitType: '初诊', remarks: '' },
  ]
  const records = selectInpatientFillRecords(classified)
  assert.equal(records.length, 1)
  assert.equal(records[0].fields.HospitalNo, '99115370422')
  assert.equal(records[0].fields.VisitRole, '初诊')
  assert.equal(records[0].fields.CreationTime, '2026-08-02')
  assert.equal(records[0].category, '住院病种记录')
})

test('platformFields: 默认按表格类别填入门诊，不改成住院', () => {
  const classified = [
    { id: 'ocr-mz', checked: true, category: '门诊病种记录', patientName: '黄良明', hospitalNo: '', recordNo: '99139647467', outpatientNo: '99139647467', tcmDiag: '瘀热阻络证', wmDiag: '肺诊断性影像异常', admissionDate: '', date: '2026-07-17', visitDate: '2026-07-17', department: '呼吸科二区', visitType: '初诊', remarks: '' },
    { id: 'ocr-zy', checked: true, category: '住院病种记录', patientName: '杨旭', hospitalNo: '376813', recordNo: '376813', tcmDiag: '咳嗽病', wmDiag: '急性支气管炎', admissionDate: '2026-06-01', date: '2026-06-01', department: '呼吸科二区', visitType: '主管', remarks: '' },
  ]
  const keepCategory = classified.filter((row) => row.checked).map((row) => ({
    id: row.id,
    category: row.category === '未分类' ? '住院病种记录' : row.category,
    fields: { PatientName: row.patientName, HospitalNo: row.outpatientNo || row.hospitalNo || row.recordNo, RecordCategory: row.category },
  }))
  assert.equal(keepCategory[0].category, '门诊病种记录')
  assert.equal(keepCategory[0].fields.HospitalNo, '99139647467')
  assert.equal(keepCategory[1].category, '住院病种记录')
})

test('platformFields: 按 Excel 类别保留门诊病种并带上科室', () => {
  const classified = [
    { id: 'xlsx-1', checked: true, category: '门诊病种记录', patientName: '王建国', hospitalNo: '', recordNo: '991153', outpatientNo: '991153', tcmDiag: '眩晕', wmDiag: '高血压', admissionDate: '', visitDate: '2026-08-02', date: '2026-08-02', department: '脑病科一区', visitType: '初诊', remarks: '', operationName: '' },
    { id: 'xlsx-2', checked: true, category: '临床技术记录', patientName: '李四', hospitalNo: '123', recordNo: '123', tcmDiag: '', wmDiag: '', operationDate: '2026-08-03', date: '2026-08-03', department: '呼吸科一区', visitType: '', remarks: '', operationName: '胸穿' },
  ]
  const outpatient = classified.filter((row) => row.checked).map((row) => ({
    id: row.id,
    category: row.category,
    fields: {
      PatientName: row.patientName,
      HospitalNo: row.outpatientNo || row.hospitalNo || row.recordNo,
      Diagnosis: row.tcmDiag,
      DiagnosisWestern: row.wmDiag,
      CreationTime: row.visitDate || row.operationDate || row.date,
      Department: row.department,
      VisitRole: row.visitType,
      Remarks: row.remarks,
      OperationName: row.operationName,
      RecordCategory: row.category,
    },
  }))
  assert.equal(outpatient[0].category, '门诊病种记录')
  assert.equal(outpatient[0].fields.Department, '脑病科一区')
  assert.equal(outpatient[0].fields.HospitalNo, '991153')
  assert.equal(outpatient[1].category, '临床技术记录')
  assert.equal(outpatient[1].fields.OperationName, '胸穿')
  assert.equal(outpatient[1].fields.Department, '呼吸科一区')
})
