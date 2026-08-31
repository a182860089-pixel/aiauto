const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getBuiltinNextAction,
  getFillRecords,
  getNextMissingFieldAction,
  areTargetFieldsFilled,
  withoutSubmitActions,
  shouldSubmit,
  dedupeFillRecords,
  isExistingRecord,
} = require('../electron/browserAutomation.cjs')

const fields = {
  PatientName: '杨旭',
  HospitalNo: '376813',
  Diagnosis: '咳嗽病',
  DiagnosisWestern: '急性支气管炎',
  CreationTime: '2026-06-01',
}

test('browserAutomation: OCR 记录进入填表队列', () => {
  const records = getFillRecords({
    records: [{ id: 'ocr-0', fields }],
  })
  assert.equal(records.length, 1)
  assert.equal(records[0].fields.PatientName, '杨旭')
})

test('browserAutomation: 首页识别住院病种入口并打开新增', () => {
  const home = {
    url: 'http://127.0.0.1/index.html',
    main: { text: '住院病种记录', controls: [{ text: '住院病种记录', value: '' }] },
    frames: [],
  }
  const indexPage = {
    url: 'http://127.0.0.1/HospitalizationRecord/Index.html',
    main: { text: '住院病种记录 添加', controls: [{ text: '添加', value: '' }] },
    frames: [],
  }
  assert.equal(getBuiltinNextAction(home, fields).target, '住院病种记录')
  assert.equal(getBuiltinNextAction(indexPage, fields).target, '添加')
  const indexSearch = {
    url: 'https://gp.itcm.cn/',
    main: { text: '', controls: [] },
    frames: [{
      src: 'https://gp.itcm.cn/HospitalizationRecord/Index',
      controls: [
        { tag: 'INPUT', name: 'PatientName', placeholder: '请输入', value: '' },
        { text: '添加', value: '' },
      ],
    }],
  }
  assert.equal(getBuiltinNextAction(indexSearch, fields).target, '添加')
})

test('browserAutomation: 新增表单按中文标签填写并在填完后由程序提交', () => {
  const emptyForm = {
    url: 'http://127.0.0.1/HospitalizationRecord/Index.html',
    main: { text: '住院病种记录', controls: [{ text: '添加', value: '' }] },
    frames: [{
      src: '/HospitalizationRecord/Create.html',
      controls: [
        { text: '病人姓名', placeholder: '病人姓名', value: '' },
        { text: '住院号', placeholder: '住院号', value: '' },
        { text: '确定', value: '' },
      ],
    }],
  }
  const filledForm = {
    ...emptyForm,
    frames: [{
      src: '/HospitalizationRecord/Create.html',
      controls: [
        { text: '病人姓名', value: '杨旭' },
        { text: '住院号', value: '376813' },
        { text: '中医诊断', value: '咳嗽病' },
        { text: '西医诊断', value: '急性支气管炎' },
        { text: '住院日期', value: '2026-06-01' },
        { text: '确定', value: '' },
      ],
    }],
  }
  const next = getNextMissingFieldAction(emptyForm, fields)
  assert.equal(next.target, '病人姓名')
  assert.equal(next.value, '杨旭')
  assert.equal(areTargetFieldsFilled(filledForm, fields), true)
  assert.equal(getBuiltinNextAction(filledForm, fields).action, 'done')
  assert.deepEqual(withoutSubmitActions([{ action: 'click', target: '确定' }, { action: 'click', target: '添加' }]), [{ action: 'click', target: '添加' }])
  assert.equal(shouldSubmit({}), true)
})

test('browserAutomation: 新增表单短暂不可读时禁止再点添加', () => {
  const afterHospitalNoFill = {
    url: 'http://127.0.0.1/HospitalizationRecord/Index.html',
    main: { text: '住院病种记录 添加', controls: [{ text: '添加', value: '' }] },
    frames: [{
      src: '/HospitalizationRecord/Create.html',
      accessible: false,
      text: '',
      controls: [],
    }],
  }
  const next = getBuiltinNextAction(afterHospitalNoFill, fields)
  assert.equal(next.action, 'wait')
  assert.notEqual(next.target, '添加')
  const latched = getBuiltinNextAction({
    url: 'http://127.0.0.1/HospitalizationRecord/Index.html',
    main: { text: '住院病种记录 添加', controls: [{ text: '添加', value: '' }, { tag: 'INPUT', name: 'PatientName', placeholder: '请输入', value: '' }] },
    frames: [],
  }, fields, { createOpened: true })
  assert.equal(latched.action, 'wait')
  assert.notEqual(latched.target, '添加')
})

test('browserAutomation: 正式平台 Detail/Add 和 HospitalizationCode 视为新增表单', () => {
  const live = {
    url: 'https://gp.itcm.cn/',
    main: { text: '住院病种记录', controls: [{ text: '住院病种记录', value: '' }] },
    frames: [
      {
        src: 'https://gp.itcm.cn/HospitalizationRecord/Index',
        controls: [
          { tag: 'INPUT', name: 'PatientName', placeholder: '请输入', value: '' },
          { text: '添加', value: '' },
        ],
      },
      {
        src: 'https://gp.itcm.cn/HospitalizationRecord/Create\nhttps://gp.itcm.cn/HospitalizationRecord/Detail/0?type=Add',
        controls: [
          { tag: 'INPUT', name: 'PatientName', id: 'PatientName', placeholder: '请输入', value: '杨旭' },
          { tag: 'INPUT', name: 'HospitalizationCode', id: 'HospitalizationCode', placeholder: '请输入', value: '376813' },
          { tag: 'INPUT', name: 'Diagnosis', placeholder: '请输入', value: '' },
        ],
      },
    ],
  }
  const next = getNextMissingFieldAction(live, fields)
  assert.equal(next.target, '中医诊断')
  assert.equal(getBuiltinNextAction(live, fields).action, 'fill')
  assert.notEqual(getBuiltinNextAction(live, fields).target, '添加')
  const redirected = {
    url: 'https://gp.itcm.cn/',
    main: { controls: [] },
    frames: [
      { src: 'https://gp.itcm.cn/HospitalizationRecord/Index', controls: [{ text: '添加', value: '' }] },
      { src: 'https://gp.itcm.cn/HospitalizationRecord/Detail/0?type=Add', controls: [] },
    ],
  }
  assert.equal(getBuiltinNextAction(redirected, fields).action, 'wait')
  assert.notEqual(getBuiltinNextAction(redirected, fields).target, '添加')
})

test('browserAutomation: 嵌套 iframe 中的新增表单继续填剩余字段而不是返回列表', () => {
  const nested = {
    url: 'http://127.0.0.1/',
    main: { text: '住院病种记录', controls: [{ text: '住院病种记录', value: '' }] },
    frames: [
      { src: '/HospitalizationRecord/Index.html', controls: [{ text: '添加', value: '' }] },
      {
        src: '/HospitalizationRecord/Create.html',
        controls: [
          { tag: 'INPUT', text: '病人姓名', placeholder: '病人姓名', name: 'PatientName', value: '杨旭' },
          { tag: 'INPUT', text: '住院号', placeholder: '住院号', name: 'HospitalNo', value: '376813' },
          { tag: 'INPUT', text: '中医诊断', placeholder: '中医诊断', name: 'Diagnosis', value: '' },
        ],
      },
    ],
  }
  const next = getNextMissingFieldAction(nested, fields)
  assert.equal(next.target, '中医诊断')
  assert.equal(getBuiltinNextAction(nested, fields).action, 'fill')
  assert.equal(getBuiltinNextAction(nested, fields).target, '中医诊断')
})

test('browserAutomation: 同一批相同住院号只保留一条', () => {
  const records = getFillRecords({
    records: [
      { id: 'ocr-0', fields },
      { id: 'ocr-1', fields: { ...fields } },
      { id: 'ocr-2', fields: { ...fields, PatientName: '赵敏', HospitalNo: '381204' } },
    ],
  })
  const unique = dedupeFillRecords(records)
  assert.equal(unique.records.length, 2)
  assert.equal(unique.skipped.length, 1)
  assert.equal(unique.records[0].fields.HospitalNo, '376813')
  assert.equal(unique.records[1].fields.HospitalNo, '381204')
})

test('browserAutomation: 列表已有相同住院号则视为重复', () => {
  const listed = {
    rows: [
      { PatientName: '赵敏', HospitalNo: '381204', CreationTime: '2026-08-03', cells: ['2026-08-03', '康复科2', '赵敏', '381204'] },
      { PatientName: '杨旭', HospitalNo: '376813', CreationTime: '2026-07-24', cells: ['2026-07-24', '康复科2', '杨旭', '376813'] },
    ],
    text: '2026-08-03 康复科2 赵敏 381204 张桂福',
  }
  assert.equal(isExistingRecord(listed, fields), true)
  assert.equal(isExistingRecord(listed, { PatientName: '赵敏', HospitalNo: '381204' }), true)
  assert.equal(isExistingRecord(listed, { PatientName: '李四', HospitalNo: '009281' }), false)
  assert.equal(isExistingRecord(listed, { PatientName: '测试', HospitalNo: '123' }), false)
})

test('browserAutomation: 进入列表后先核对重复，不立刻点添加', () => {
  const indexPage = {
    url: 'https://gp.itcm.cn/HospitalizationRecord/Index',
    main: { text: '住院病种记录 添加', controls: [{ text: '添加', value: '' }] },
    frames: [{
      src: 'https://gp.itcm.cn/HospitalizationRecord/Index',
      controls: [{ text: '添加', value: '' }],
    }],
  }
  assert.equal(getBuiltinNextAction(indexPage, fields, { stopAtIndex: true }).action, 'done')
  assert.notEqual(getBuiltinNextAction(indexPage, fields, { stopAtIndex: true }).target, '添加')
  assert.equal(getBuiltinNextAction(indexPage, fields).target, '添加')
})
