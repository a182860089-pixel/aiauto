const test = require('node:test')
const assert = require('node:assert/strict')

const PLACEHOLDER_NAMES = new Set(['未命名患者', '未知', '无名'])

function text(value) {
  return String(value ?? '').trim()
}

function toInpatientPlatformFields(row) {
  if (row.category !== '住院病种记录') return null
  const patientName = text(row.patientName)
  const hospitalNo = text(row.hospitalNo || row.recordNo)
  const diagnosis = text(row.tcmDiag)
  const diagnosisWestern = text(row.wmDiag)
  if (!patientName || PLACEHOLDER_NAMES.has(patientName) || !hospitalNo || (!diagnosis && !diagnosisWestern)) return null
  return {
    PatientName: patientName,
    HospitalNo: hospitalNo,
    Diagnosis: diagnosis,
    DiagnosisWestern: diagnosisWestern,
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
  assert.equal(records.length, 1)
  assert.equal(records[0].fields.PatientName, '杨旭')
  assert.equal(records[0].fields.HospitalNo, '376813')
  assert.equal(records[0].fields.Diagnosis, '咳嗽病:风热犯肺证')
  assert.equal(records[0].fields.Department, '通州呼吸科二区')
})

test('platformFields: 缺姓名住院号或诊断时不进入自动提交', () => {
  const records = snapshotToFallbackRecord({
    PatientName: '未命名患者',
    HospitalNo: '123',
    Diagnosis: '肺炎',
  })
  assert.deepEqual(records, [])
})
