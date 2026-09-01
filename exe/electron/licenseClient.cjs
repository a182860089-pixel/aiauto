const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { getMachineId } = require('./machineId.cjs')

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000'

function getStoragePath(userDataDir) {
  return path.join(userDataDir, 'license-config.json')
}

function loadLocalLicense(userDataDir) {
  const filePath = getStoragePath(userDataDir)
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
      // ignore
    }
  }
  return {
    serverUrl: DEFAULT_SERVER_URL,
    code: '',
    token: '',
    lastVerifyAt: null,
    expiresAt: null,
    status: 'unactivated', // unactivated, active, expired
    remainingText: '',
  }
}

function saveLocalLicense(userDataDir, data) {
  try {
    const filePath = getStoragePath(userDataDir)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    console.error('保存授权缓存失败:', err.message)
  }
}

function requestHttp(urlStr, method = 'GET', body = null, timeout = 6000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr)
      const isHttps = parsed.protocol === 'https:'
      const lib = isHttps ? https : http
      const postData = body ? JSON.stringify(body) : ''

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
        timeout,
      }

      const req = lib.request(options, (res) => {
        let raw = ''
        res.on('data', (chunk) => (raw += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode, raw })
          }
        })
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('连接服务器超时，请检查网络或服务器地址'))
      })

      req.on('error', (err) => {
        reject(new Error('无法连接到授权服务器: ' + err.message))
      })

      if (postData) req.write(postData)
      req.end()
    } catch (err) {
      reject(new Error('服务器地址格式不正确: ' + err.message))
    }
  })
}

class LicenseManager {
  constructor(userDataDir) {
    this.userDataDir = userDataDir
    this.machineId = getMachineId(userDataDir)
    this.config = loadLocalLicense(userDataDir)
  }

  getMachineId() {
    return this.machineId
  }

  getConfig() {
    return {
      ...this.config,
      machineId: this.machineId,
    }
  }

  setServerUrl(serverUrl) {
    let cleanUrl = (serverUrl || '').trim()
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1)
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'http://' + cleanUrl
    }
    this.config.serverUrl = cleanUrl
    saveLocalLicense(this.userDataDir, this.config)
    return this.config
  }

  async activate(code, serverUrl = null) {
    if (serverUrl) {
      this.setServerUrl(serverUrl)
    }
    const cleanCode = (code || '').trim().toUpperCase()
    if (!cleanCode) {
      throw new Error('请输入要激活的卡密')
    }

    const apiUrl = `${this.config.serverUrl}/api/license/activate`
    const res = await requestHttp(apiUrl, 'POST', {
      code: cleanCode,
      machineId: this.machineId,
      clientInfo: {
        platform: process.platform,
        arch: process.arch,
      },
    })

    if (!res.data || !res.data.success) {
      throw new Error(res.data?.message || `激活失败（状态码：${res.status}）`)
    }

    const payload = res.data.data
    this.config.code = payload.code
    this.config.token = payload.token
    this.config.expiresAt = payload.expiresAt
    this.config.activatedAt = payload.activatedAt
    this.config.status = 'active'
    this.config.remainingText = payload.remainingText
    this.config.lastVerifyAt = new Date().toISOString()

    saveLocalLicense(this.userDataDir, this.config)

    return {
      success: true,
      message: res.data.message || '激活成功',
      status: this.config.status,
      expiresAt: this.config.expiresAt,
      remainingText: this.config.remainingText,
      machineId: this.machineId,
      code: this.config.code,
    }
  }

  async checkStatus(forceRemote = false) {
    // 如果没有卡密和 token，直接返回未激活
    if (!this.config.code && !this.config.token) {
      return {
        active: false,
        status: 'unactivated',
        message: '软件未激活，请输入卡密进行激活',
        machineId: this.machineId,
        serverUrl: this.config.serverUrl,
        code: '',
      }
    }

    // 尝试联网校验
    try {
      const apiUrl = `${this.config.serverUrl}/api/license/verify`
      const res = await requestHttp(apiUrl, 'POST', {
        machineId: this.machineId,
        token: this.config.token,
        code: this.config.code,
      }, 4000)

      if (res.data && res.data.valid) {
        const payload = res.data.data
        this.config.status = 'active'
        this.config.expiresAt = payload.expiresAt
        this.config.remainingText = payload.remainingText
        this.config.lastVerifyAt = new Date().toISOString()
        if (payload.token) this.config.token = payload.token
        saveLocalLicense(this.userDataDir, this.config)

        return {
          active: true,
          status: 'active',
          message: '授权有效',
          machineId: this.machineId,
          code: this.config.code,
          expiresAt: payload.expiresAt,
          remainingText: payload.remainingText,
          remainingDays: payload.remainingDays,
          serverUrl: this.config.serverUrl,
        }
      } else {
        // 服务端返回失效或已过期
        const isExp = res.data?.isExpired
        this.config.status = isExp ? 'expired' : 'unactivated'
        this.config.remainingText = isExp ? '已过期' : ''
        saveLocalLicense(this.userDataDir, this.config)
        return {
          active: false,
          status: this.config.status,
          message: res.data?.message || '授权验证未通过',
          machineId: this.machineId,
          serverUrl: this.config.serverUrl,
          code: this.config.code,
          expiresAt: this.config.expiresAt,
          remainingText: this.config.remainingText,
        }
      }
    } catch (err) {
      // 联网异常时的离线缓存宽限机制（若前几天成功联网校验过且尚未到期，允许离线继续使用）
      if (this.config.expiresAt && new Date(this.config.expiresAt).getTime() > Date.now()) {
        const diffDays = (new Date(this.config.expiresAt).getTime() - Date.now()) / (1000 * 3600 * 24)
        return {
          active: true,
          status: 'active',
          isOffline: true,
          message: '离线模式（无法连接服务器，使用本地有效凭证）',
          machineId: this.machineId,
          code: this.config.code,
          expiresAt: this.config.expiresAt,
          remainingText: `约 ${Math.ceil(diffDays)} 天 (离线缓存)`,
          serverUrl: this.config.serverUrl,
        }
      }

      return {
        active: false,
        status: 'network_error',
        message: `无法连接授权服务器: ${err.message}`,
        machineId: this.machineId,
        serverUrl: this.config.serverUrl,
        code: this.config.code,
      }
    }
  }

  clear() {
    this.config.code = ''
    this.config.token = ''
    this.config.expiresAt = null
    this.config.status = 'unactivated'
    this.config.remainingText = ''
    saveLocalLicense(this.userDataDir, this.config)
    return { success: true, message: '已清除本地授权' }
  }
}

module.exports = {
  LicenseManager,
  DEFAULT_SERVER_URL,
}
