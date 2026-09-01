const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { getMachineId } = require('../exe/electron/machineId.cjs')
const { LicenseManager } = require('../exe/electron/licenseClient.cjs')
const { app: serverApp } = require('../license-server/server')

test('1. machineId 生成测试 - 格式和稳定性', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiauto-test-machine-'))
  const mid1 = getMachineId(tmpDir)
  const mid2 = getMachineId(tmpDir)

  assert.ok(mid1.startsWith('WIN-') || mid1.startsWith('DEV-'), '机器码前缀应符合标准')
  assert.strictEqual(mid1, mid2, '相同环境多次读取机器码必须完全一致')
  assert.strictEqual(mid1.split('-').length, 5, '机器码应该由5段组成')
})

test('2. LicenseManager 完整激活与离线容错联调测试', async (t) => {
  const PORT = 3002
  const server = serverApp.listen(PORT)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiauto-test-lic-mgr-'))

  try {
    const manager = new LicenseManager(tmpDir)
    manager.setServerUrl(`http://127.0.0.1:${PORT}`)

    // 2.1 初始未激活状态
    const initStatus = await manager.checkStatus()
    assert.strictEqual(initStatus.active, false)
    assert.strictEqual(initStatus.status, 'unactivated')

    // 2.2 服务端先生成一张测试卡密 (使用测试请求)
    const genRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin' }),
    })
    const { token: adminToken } = await genRes.json()

    const createRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/licenses/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ count: 1, durationValue: 30, durationType: 'days', prefix: 'CLI' }),
    })
    const { data: created } = await createRes.json()
    const testCode = created[0].code

    // 2.3 客户端激活
    const actResult = await manager.activate(testCode)
    assert.strictEqual(actResult.success, true)
    assert.strictEqual(actResult.status, 'active')
    assert.ok(actResult.remainingText.includes('天') || actResult.remainingText.includes('小时'))

    // 2.4 客户端校验状态
    const verifiedStatus = await manager.checkStatus()
    assert.strictEqual(verifiedStatus.active, true)
    assert.strictEqual(verifiedStatus.status, 'active')

    // 2.5 客户端清除授权
    const clearResult = manager.clear()
    assert.strictEqual(clearResult.success, true)
    const afterClearStatus = await manager.checkStatus()
    assert.strictEqual(afterClearStatus.active, false)
  } finally {
    server.close()
  }
})
