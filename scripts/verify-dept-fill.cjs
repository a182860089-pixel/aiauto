const { app, BrowserWindow } = require('electron')
const { startPlatformFixtureServer } = require('../electron/platformFixture.cjs')
const { buildFillCreateFormScript } = require('../electron/browserAutomation.cjs')

app.whenReady().then(async () => {
  const { origin, server } = await startPlatformFixtureServer()
  const window = new BrowserWindow({ show: true, width: 900, height: 720, webPreferences: { nodeIntegration: false } })
  await window.loadURL(`${origin}/HospitalizationRecord/Create.html`)
  const result = await window.webContents.executeJavaScript(buildFillCreateFormScript({
    PatientName: '刘立杰',
    HospitalNo: '376813',
    Diagnosis: '胸痹',
    DiagnosisWestern: '冠心病',
    CreationTime: '2026-07-18',
    Department: '通州心血管二区',
  }), true)
  const selected = await window.webContents.executeJavaScript(`({
    select: document.getElementById('Department').options[document.getElementById('Department').selectedIndex].text,
    title: document.getElementById('dept-title').value
  })`, true)
  console.log(JSON.stringify({ result, selected }, null, 2))
  if (selected.select !== '通州心血管二区' || selected.title !== '通州心血管二区') {
    throw new Error(`科室未点选成功：${JSON.stringify(selected)}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 1500))
  server.close()
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
