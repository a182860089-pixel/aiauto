const { app } = require('./server')
const http = require('http')

const PORT = 3001 // 测试专用端口，避免冲突

function makeRequest(path, method = 'GET', body = null, token = '') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : ''
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode, raw })
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(data)
    req.end()
  })
}

async function runTests() {
  console.log('--- 开始测试 License Server API (Port: ' + PORT + ') ---')
  const server = app.listen(PORT)

  try {
    // 1. 登录
    const loginRes = await makeRequest('/api/admin/login', 'POST', { password: 'admin' })
    if (!loginRes.json.success) throw new Error('登录失败: ' + JSON.stringify(loginRes.json))
    const adminToken = loginRes.json.token
    console.log('✅ 1. 管理员登录成功, token 获取正常')

    // 2. 批量生成 2 张卡密 (30天)
    const genRes = await makeRequest(
      '/api/admin/licenses/generate',
      'POST',
      {
        count: 2,
        durationValue: 30,
        durationType: 'days',
        prefix: 'TEST',
        note: '单元测试生成',
      },
      adminToken,
    )
    if (!genRes.json.success || genRes.json.data.length !== 2) throw new Error('生成卡密失败')
    const [cardA, cardB] = genRes.json.data
    console.log(`✅ 2. 成功生成卡密: ${cardA.code}, ${cardB.code}`)

    // 3. 客户端激活卡密 A
    const testMachine1 = 'MACHINE_WIN11_TEST_001'
    const actRes = await makeRequest('/api/license/activate', 'POST', {
      code: cardA.code,
      machineId: testMachine1,
      clientInfo: { hostname: 'TestPC-01' },
    })
    if (!actRes.json.success || !actRes.json.data.token) throw new Error('激活卡密失败: ' + JSON.stringify(actRes.json))
    console.log('✅ 3. 卡密 A 首次激活成功, 绑定机器码: ' + testMachine1)

    // 4. 卡密 A 被另一台机器激活应被拦截 (一机一码校验)
    const testMachine2 = 'MACHINE_WIN11_TEST_002'
    const actConflictRes = await makeRequest('/api/license/activate', 'POST', {
      code: cardA.code,
      machineId: testMachine2,
    })
    if (actConflictRes.status !== 403) throw new Error('一机一码拦截失败，应该返回403')
    console.log('✅ 4. 一机一码拦截正常（防止他人多机共用卡密）')

    // 5. 校验授权 verify
    const verifyRes = await makeRequest('/api/license/verify', 'POST', {
      machineId: testMachine1,
      token: actRes.json.data.token,
    })
    if (!verifyRes.json.valid || verifyRes.json.data.status !== 'active') throw new Error('授权校验失败')
    console.log(`✅ 5. 授权验证成功: 剩余时间 [${verifyRes.json.data.remainingText}]`)

    // 6. 管理员解绑机器码
    const unbindRes = await makeRequest(
      `/api/admin/licenses/${cardA.id}`,
      'PUT',
      { unbindMachine: true },
      adminToken,
    )
    if (!unbindRes.json.success) throw new Error('解绑失败')
    console.log('✅ 6. 管理员在后台解绑机器码成功')

    // 7. 解绑后新机器可以重新绑定
    const reActRes = await makeRequest('/api/license/activate', 'POST', {
      code: cardA.code,
      machineId: testMachine2,
    })
    if (!reActRes.json.success) throw new Error('解绑后重新绑定失败')
    console.log('✅ 7. 解绑后在新机器 ' + testMachine2 + ' 上重新激活绑定成功')

    // 8. 修改卡密增加 7 天
    const editRes = await makeRequest(
      `/api/admin/licenses/${cardA.id}`,
      'PUT',
      { addDays: 7, note: '老用户赠送7天' },
      adminToken,
    )
    if (!editRes.json.success) throw new Error('修改增加天数失败')
    console.log('✅ 8. 后台增减有效期与修改备注成功')

    // 9. 清理测试卡密
    await makeRequest('/api/admin/licenses/batch-delete', 'POST', { ids: [cardA.id, cardB.id] }, adminToken)
    console.log('✅ 9. 测试卡密批量清理成功')

    console.log('\n🎉 所有服务端卡密系统自动化测试全部顺利通过！\n')
  } finally {
    server.close()
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('❌ 测试未通过:', err)
    process.exit(1)
  })
}

module.exports = { runTests }
