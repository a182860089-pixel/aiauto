const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const db = require('./db')

const CONFIG_FILE = path.join(__dirname, 'config.json')

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch (err) {
    console.error('加载 config.json 失败，使用默认配置:', err)
  }
  return {
    port: 3000,
    adminPassword: 'admin',
    secretKey: 'default_secret_key_please_change',
    appName: '卡密授权系统',
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {
    console.error('保存 config.json 失败:', err)
  }
}

let config = loadConfig()

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 托管静态管理界面
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')))
app.get('/', (_req, res) => {
  res.redirect('/admin')
})

// 内存中管理员会话 token
const adminTokens = new Map()

// 生成安全 Token
function generateToken(payload) {
  const hmac = crypto.createHmac('sha256', config.secretKey)
  const data = JSON.stringify(payload)
  hmac.update(data)
  const sign = hmac.digest('hex')
  return Buffer.from(JSON.stringify({ data, sign })).toString('base64url')
}

// 验证 Token
function verifyToken(tokenString) {
  try {
    const raw = Buffer.from(tokenString, 'base64url').toString('utf8')
    const { data, sign } = JSON.parse(raw)
    const hmac = crypto.createHmac('sha256', config.secretKey)
    hmac.update(data)
    if (hmac.digest('hex') !== sign) return null
    return JSON.parse(data)
  } catch {
    return null
  }
}

// 管理员鉴权中间件
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ success: false, message: '未授权或登录已过期，请重新登录' })
  }
  const session = adminTokens.get(token)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    adminTokens.delete(token)
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' })
  }
  next()
}

// 生成随机卡密字符串：XXXX-XXXX-XXXX-XXXX
function generateCardCode(prefix = '') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const segment = (len = 4) => {
    let res = ''
    for (let i = 0; i < len; i++) {
      res += chars[Math.floor(Math.random() * chars.length)]
    }
    return res
  }
  const code = `${segment()}-${segment()}-${segment()}-${segment()}`
  return prefix ? `${prefix}-${code}` : code
}

// 计算到期时间
function computeExpiryDate(durationValue, durationType, fromDate = new Date()) {
  const d = new Date(fromDate)
  const val = Number(durationValue) || 1
  if (durationType === 'hours') {
    d.setHours(d.getHours() + val)
  } else if (durationType === 'days') {
    d.setDate(d.getDate() + val)
  } else if (durationType === 'months') {
    d.setMonth(d.getMonth() + val)
  } else if (durationType === 'years') {
    d.setFullYear(d.getFullYear() + val)
  } else if (durationType === 'permanent') {
    d.setFullYear(d.getFullYear() + 99)
  } else {
    d.setDate(d.getDate() + val)
  }
  return d.toISOString()
}

// 计算剩余天数和小时数
function formatRemaining(expiresAt) {
  if (!expiresAt) return { isExpired: false, remainingText: '未激活' }
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) {
    return { isExpired: true, remainingText: '已过期', remainingDays: 0, remainingHours: 0 }
  }
  const totalHours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  let remainingText = ''
  if (days > 3650) {
    remainingText = '永久有效'
  } else if (days > 0) {
    remainingText = `${days} 天 ${hours} 小时`
  } else {
    const minutes = Math.floor((diff / (1000 * 60)) % 60)
    remainingText = `${hours} 小时 ${minutes} 分钟`
  }
  return { isExpired: false, remainingText, remainingDays: days, remainingHours: hours }
}

// -------------------------------------------------------------
// 1. 客户端接口 (Client APIs)
// -------------------------------------------------------------

// 获取服务端基本信息
app.get('/api/license/ping', (_req, res) => {
  res.json({
    success: true,
    appName: config.appName,
    serverTime: new Date().toISOString(),
  })
})

// 激活卡密 (绑定机器码)
app.post('/api/license/activate', (req, res) => {
  const { code, machineId, clientInfo = {} } = req.body || {}

  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: '请输入卡密' })
  }
  if (!machineId || !machineId.trim()) {
    return res.status(400).json({ success: false, message: '未获取到机器码，无法绑定' })
  }

  const cleanCode = code.trim().toUpperCase()
  const cleanMachineId = machineId.trim()

  const license = db.getByCode(cleanCode)
  if (!license) {
    return res.status(404).json({ success: false, message: '卡密不存在，请核对输入' })
  }

  if (license.status === 'disabled') {
    return res.status(403).json({ success: false, message: '该卡密已被禁用，请联系管理员' })
  }

  // 如果已经绑定了其他机器
  if (license.machineId && license.machineId !== cleanMachineId) {
    return res.status(403).json({
      success: false,
      message: '该卡密已绑定到其他电脑设备。如需换绑请联系管理员进行解绑。',
    })
  }

  const now = new Date()
  let expiresAt = license.expiresAt

  // 如果是首次激活，计算到期时间
  if (!license.activatedAt) {
    expiresAt = computeExpiryDate(license.durationValue, license.durationType, now)
  }

  // 检查是否已过期
  if (new Date(expiresAt).getTime() <= now.getTime()) {
    db.update(license.id, { status: 'expired' })
    return res.status(403).json({ success: false, message: '卡密已到期，请购买新卡密' })
  }

  // 更新卡密状态
  const updated = db.update(license.id, {
    machineId: cleanMachineId,
    activatedAt: license.activatedAt || now.toISOString(),
    expiresAt,
    lastVerifyAt: now.toISOString(),
    status: 'active',
    clientInfo: {
      ...license.clientInfo,
      ...clientInfo,
      lastIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    },
  })

  // 生成客户端校验 Token
  const token = generateToken({
    licenseId: updated.id,
    code: updated.code,
    machineId: cleanMachineId,
    expiresAt: updated.expiresAt,
  })

  const remaining = formatRemaining(updated.expiresAt)

  res.json({
    success: true,
    message: '激活成功！',
    data: {
      code: updated.code,
      machineId: cleanMachineId,
      activatedAt: updated.activatedAt,
      expiresAt: updated.expiresAt,
      remainingText: remaining.remainingText,
      remainingDays: remaining.remainingDays,
      status: updated.status,
      token,
    },
  })
})

// 校验授权 (客户端启动/定时检测)
app.post('/api/license/verify', (req, res) => {
  const { machineId, token, code } = req.body || {}

  if (!machineId) {
    return res.status(400).json({ success: false, valid: false, message: '缺少机器码' })
  }

  const cleanMachineId = machineId.trim()
  let license = null

  // 1. 如果有 token 先解密验证
  if (token) {
    const payload = verifyToken(token)
    if (payload && payload.machineId === cleanMachineId) {
      license = db.getById(payload.licenseId) || db.getByCode(payload.code)
    }
  }

  // 2. 如果没匹配到但提供了 code
  if (!license && code) {
    license = db.getByCode(code.trim().toUpperCase())
  }

  // 3. 如果没提供 code，查询该 machineId 绑定的有效卡密
  if (!license) {
    const list = db.getByMachineId(cleanMachineId)
    license = list.find((item) => item.status === 'active' || item.status === 'unactivated')
  }

  if (!license) {
    return res.json({
      success: false,
      valid: false,
      message: '未查询到有效授权，请激活卡密',
    })
  }

  if (license.status === 'disabled') {
    return res.json({
      success: false,
      valid: false,
      message: '该授权已被管理员禁用',
    })
  }

  if (license.machineId && license.machineId !== cleanMachineId) {
    return res.json({
      success: false,
      valid: false,
      message: '机器码不匹配',
    })
  }

  if (!license.activatedAt || !license.expiresAt) {
    return res.json({
      success: false,
      valid: false,
      message: '卡密尚未激活',
    })
  }

  const now = new Date()
  if (new Date(license.expiresAt).getTime() <= now.getTime()) {
    db.update(license.id, { status: 'expired' })
    return res.json({
      success: false,
      valid: false,
      isExpired: true,
      message: '授权已到期，请续费或激活新卡密',
      expiresAt: license.expiresAt,
    })
  }

  // 刷新最后一次验证时间
  db.update(license.id, {
    lastVerifyAt: now.toISOString(),
  })

  const remaining = formatRemaining(license.expiresAt)

  // 生成最新 Token
  const refreshedToken = generateToken({
    licenseId: license.id,
    code: license.code,
    machineId: cleanMachineId,
    expiresAt: license.expiresAt,
  })

  res.json({
    success: true,
    valid: true,
    data: {
      code: license.code,
      machineId: cleanMachineId,
      note: license.note || '',
      activatedAt: license.activatedAt,
      expiresAt: license.expiresAt,
      remainingText: remaining.remainingText,
      remainingDays: remaining.remainingDays,
      status: 'active',
      token: refreshedToken,
    },
  })
})

// -------------------------------------------------------------
// 2. 管理员接口 (Admin APIs)
// -------------------------------------------------------------

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {}
  if (!password || password !== config.adminPassword) {
    return res.status(401).json({ success: false, message: '密码错误' })
  }
  const token = 'adm_' + crypto.randomBytes(24).toString('hex')
  adminTokens.set(token, { createdAt: Date.now() })
  res.json({
    success: true,
    message: '登录成功',
    token,
    appName: config.appName,
  })
})

// 修改管理员密码
app.post('/api/admin/change-password', adminAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!newPassword || newPassword.length < 5) {
    return res.status(400).json({ success: false, message: '新密码长度不能少于5位' })
  }
  if (oldPassword !== config.adminPassword) {
    return res.status(400).json({ success: false, message: '原密码不正确' })
  }
  config.adminPassword = newPassword
  saveConfig(config)
  res.json({ success: true, message: '密码修改成功，下次请使用新密码登录' })
})

// 看板统计数据
app.get('/api/admin/stats', adminAuth, (_req, res) => {
  const all = db.getAll()
  const now = Date.now()
  let unactivated = 0
  let active = 0
  let expired = 0
  let disabled = 0

  all.forEach((item) => {
    if (item.status === 'disabled') {
      disabled++
    } else if (!item.activatedAt) {
      unactivated++
    } else if (new Date(item.expiresAt).getTime() <= now) {
      expired++
    } else {
      active++
    }
  })

  res.json({
    success: true,
    data: {
      total: all.length,
      unactivated,
      active,
      expired,
      disabled,
    },
  })
})

// 卡密列表（支持搜索、状态过滤、分页）
app.get('/api/admin/licenses', adminAuth, (req, res) => {
  const { keyword = '', status = '', page = 1, pageSize = 20 } = req.query
  let list = db.getAll()
  const now = Date.now()

  // 搜索关键字（匹配卡密、机器码、备注）
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase()
    list = list.filter((item) => {
      return (
        (item.code && item.code.toLowerCase().includes(kw)) ||
        (item.machineId && item.machineId.toLowerCase().includes(kw)) ||
        (item.note && item.note.toLowerCase().includes(kw))
      )
    })
  }

  // 状态筛选
  if (status) {
    if (status === 'unactivated') {
      list = list.filter((item) => item.status !== 'disabled' && !item.activatedAt)
    } else if (status === 'active') {
      list = list.filter(
        (item) => item.status !== 'disabled' && item.activatedAt && new Date(item.expiresAt).getTime() > now,
      )
    } else if (status === 'expired') {
      list = list.filter(
        (item) => item.status === 'expired' || (item.activatedAt && new Date(item.expiresAt).getTime() <= now),
      )
    } else if (status === 'disabled') {
      list = list.filter((item) => item.status === 'disabled')
    }
  }

  // 格式化输出字段
  const formattedList = list.map((item) => {
    let currentStatus = item.status
    if (item.status !== 'disabled') {
      if (!item.activatedAt) {
        currentStatus = 'unactivated'
      } else if (new Date(item.expiresAt).getTime() <= now) {
        currentStatus = 'expired'
      } else {
        currentStatus = 'active'
      }
    }
    const remaining = formatRemaining(item.expiresAt)
    return {
      ...item,
      computedStatus: currentStatus,
      remainingText: remaining.remainingText,
      isExpired: remaining.isExpired,
    }
  })

  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const limit = Math.max(1, parseInt(pageSize, 10) || 20)
  const total = formattedList.length
  const startIndex = (pageNum - 1) * limit
  const rows = formattedList.slice(startIndex, startIndex + limit)

  res.json({
    success: true,
    data: {
      total,
      page: pageNum,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
      rows,
    },
  })
})

// 批量生成卡密
app.post('/api/admin/licenses/generate', adminAuth, (req, res) => {
  const {
    count = 1,
    durationValue = 30,
    durationType = 'days', // 'hours', 'days', 'months', 'years', 'permanent'
    prefix = '',
    note = '',
  } = req.body || {}

  const generateCount = Math.min(500, Math.max(1, parseInt(count, 10) || 1))
  const createdList = []

  for (let i = 0; i < generateCount; i++) {
    const code = generateCardCode(prefix.trim().toUpperCase())
    const item = {
      id: 'lic_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'),
      code,
      durationValue: parseInt(durationValue, 10) || 30,
      durationType,
      status: 'unactivated', // unactivated, active, expired, disabled
      machineId: null,
      note: note.trim(),
      createdAt: new Date().toISOString(),
      activatedAt: null,
      expiresAt: null,
      lastVerifyAt: null,
      clientInfo: null,
    }
    db.add(item)
    createdList.push(item)
  }

  res.json({
    success: true,
    message: `成功生成 ${createdList.length} 张卡密`,
    data: createdList,
  })
})

// 修改卡密 (支持增减时间、直接修改过期时间、解绑机器码、启用/禁用、修改备注)
app.put('/api/admin/licenses/:id', adminAuth, (req, res) => {
  const { id } = req.params
  const license = db.getById(id)
  if (!license) {
    return res.status(404).json({ success: false, message: '卡密不存在' })
  }

  const {
    note,
    status,
    machineId,
    unbindMachine, // boolean
    addDays, // number 增减天数
    expiresAt, // string 直接指定到期时间
    durationValue,
    durationType,
  } = req.body || {}

  const updateFields = {}

  if (typeof note === 'string') updateFields.note = note.trim()
  if (typeof status === 'string') updateFields.status = status

  // 解绑机器码
  if (unbindMachine === true) {
    updateFields.machineId = null
    updateFields.clientInfo = null
  } else if (typeof machineId === 'string') {
    updateFields.machineId = machineId.trim() || null
  }

  if (durationValue) updateFields.durationValue = parseInt(durationValue, 10)
  if (durationType) updateFields.durationType = durationType

  // 延长/调整天数
  if (typeof addDays === 'number' && addDays !== 0) {
    const baseDate = license.expiresAt ? new Date(license.expiresAt) : new Date()
    baseDate.setDate(baseDate.getDate() + addDays)
    updateFields.expiresAt = baseDate.toISOString()
    if (license.status === 'expired' && baseDate.getTime() > Date.now()) {
      updateFields.status = 'active'
    }
  }

  // 直接设定过期时间
  if (typeof expiresAt === 'string' && expiresAt) {
    updateFields.expiresAt = new Date(expiresAt).toISOString()
    if (new Date(expiresAt).getTime() > Date.now() && license.status === 'expired') {
      updateFields.status = 'active'
    }
  }

  const updated = db.update(id, updateFields)
  res.json({ success: true, message: '更新成功', data: updated })
})

// 删除单个卡密
app.delete('/api/admin/licenses/:id', adminAuth, (req, res) => {
  const { id } = req.params
  const ok = db.delete(id)
  if (!ok) {
    return res.status(404).json({ success: false, message: '卡密不存在或已删除' })
  }
  res.json({ success: true, message: '删除成功' })
})

// 批量删除卡密
app.post('/api/admin/licenses/batch-delete', adminAuth, (req, res) => {
  const { ids = [] } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: '请提供要删除的卡密ID数组' })
  }
  const deletedCount = db.deleteMany(ids)
  res.json({ success: true, message: `成功删除 ${deletedCount} 张卡密` })
})

// 启动服务
const PORT = process.env.PORT || config.port || 3000
let serverInstance = null
if (process.env.NODE_ENV !== 'test' && !module.parent) {
  serverInstance = app.listen(PORT, () => {
    console.log(`====================================================`)
    console.log(`  ${config.appName} 服务已启动`)
    console.log(`  服务端口: http://localhost:${PORT}`)
    console.log(`  管理后台: http://localhost:${PORT}/admin`)
    console.log(`  默认管理密码: ${config.adminPassword}`)
    console.log(`====================================================`)
  })
}

module.exports = { app, config, serverInstance }
