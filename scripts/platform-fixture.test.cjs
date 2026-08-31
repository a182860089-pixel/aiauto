const test = require('node:test')
const assert = require('node:assert/strict')
const { startPlatformFixtureServer } = require('../electron/platformFixture.cjs')
const { getBuiltinNextAction, getNextMissingFieldAction, areTargetFieldsFilled } = require('../electron/browserAutomation.cjs')

const fields = {
  PatientName: '杨旭',
  HospitalNo: '376813',
  Diagnosis: '咳嗽病',
  DiagnosisWestern: '急性支气管炎',
  CreationTime: '2026-06-01',
}

test('platform fixture: 本地登录页、住院病种入口和新增表单可被识别并提交', async () => {
  const { server, origin, loginUrl } = await startPlatformFixtureServer()
  try {
    const loginHtml = await (await fetch(loginUrl)).text()
    assert.match(loginHtml, /id="LAY-user-login-username"/)
    assert.match(loginHtml, /id="LAY-user-login-password"/)

    const homeHtml = await (await fetch(`${origin}/`)).text()
    assert.match(homeHtml, /住院病种记录/)
    const homeAction = getBuiltinNextAction({
      url: `${origin}/`,
      main: { text: homeHtml.replace(/<[^>]+>/g, ' '), controls: [{ text: '住院病种记录', value: '' }] },
      frames: [],
    }, fields)
    assert.equal(homeAction.target, '住院病种记录')

    const indexHtml = await (await fetch(`${origin}/HospitalizationRecord/Index.html`)).text()
    assert.match(indexHtml, />添加</)
    const addAction = getBuiltinNextAction({
      url: `${origin}/HospitalizationRecord/Index.html`,
      main: { text: '住院病种记录 添加', controls: [{ text: '添加', value: '' }] },
      frames: [],
    }, fields)
    assert.equal(addAction.target, '添加')

    const createHtml = await (await fetch(`${origin}/HospitalizationRecord/Create.html`)).text()
    assert.match(createHtml, /placeholder="病人姓名"/)
    assert.match(createHtml, />确定</)
    const emptyForm = {
      url: `${origin}/HospitalizationRecord/Index.html`,
      main: { text: '住院病种记录', controls: [{ text: '添加', value: '' }] },
      frames: [{
        src: `${origin}/HospitalizationRecord/Create.html`,
        text: createHtml.replace(/<[^>]+>/g, ' '),
        controls: [
          { text: '病人姓名', placeholder: '病人姓名', value: '' },
          { text: '住院号', placeholder: '住院号', value: '' },
          { text: '确定', value: '' },
        ],
      }],
    }
    assert.equal(getNextMissingFieldAction(emptyForm, fields).target, '病人姓名')

    const filledForm = {
      ...emptyForm,
      frames: [{
        src: `${origin}/HospitalizationRecord/Create.html`,
        controls: [
          { text: '病人姓名', value: fields.PatientName },
          { text: '住院号', value: fields.HospitalNo },
          { text: '中医诊断', value: fields.Diagnosis },
          { text: '西医诊断', value: fields.DiagnosisWestern },
          { text: '住院日期', value: fields.CreationTime },
          { text: '确定', value: '' },
        ],
      }],
    }
    assert.equal(areTargetFieldsFilled(filledForm, fields), true)
    assert.equal(getBuiltinNextAction(filledForm, fields).action, 'done')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
