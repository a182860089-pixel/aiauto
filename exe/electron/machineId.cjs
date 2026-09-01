const crypto = require('crypto')
const os = require('os')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

let cachedMachineId = null

/**
 * 获取 Windows 硬件特征指纹，若命令失败则平滑降级。
 */
function getSystemHardwareFingerprint() {
  const parts = []

  if (process.platform === 'win32') {
    // 1. 读取 Windows MachineGuid 注册表
    try {
      const guid = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      const match = guid.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
      if (match && match[1]) {
        parts.push(match[1].trim())
      }
    } catch {
      // ignore
    }

    // 2. 读取主板 UUID / BIOS 序列号
    try {
      const bios = execSync('wmic csproduct get uuid', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const clean = bios.replace('UUID', '').trim()
      if (clean && clean.length > 5 && !clean.includes('00000000')) {
        parts.push(clean)
      }
    } catch {
      // ignore
    }

    // 3. 读取 C 盘序列号
    try {
      const vol = execSync('vol C:', {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const match = vol.match(/([A-Fa-f0-9]{4}-[A-Fa-f0-9]{4})/i)
      if (match && match[1]) {
        parts.push(match[1])
      }
    } catch {
      // ignore
    }
  }

  // 4. 网卡 MAC 地址
  try {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          parts.push(net.mac)
          break
        }
      }
    }
  } catch {
    // ignore
  }

  // 5. 基础系统标识回退
  parts.push(os.hostname())
  parts.push(os.userInfo().username || '')
  parts.push(os.arch())
  parts.push(os.cpus()[0]?.model || '')

  return parts.filter(Boolean).join('||')
}

/**
 * 生成并缓存格式化的一机一码：WIN-XXXX-XXXX-XXXX-XXXX
 */
function getMachineId(userDataDir = null) {
  if (cachedMachineId) return cachedMachineId

  // 如果传了用户数据目录，优先读取持久化文件，确保绝对稳定
  let cacheFile = null
  if (userDataDir) {
    cacheFile = path.join(userDataDir, '.device_fingerprint.json')
    if (fs.existsSync(cacheFile)) {
      try {
        const json = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        if (json.machineId && typeof json.machineId === 'string') {
          cachedMachineId = json.machineId
          return cachedMachineId
        }
      } catch {
        // ignore
      }
    }
  }

  const rawFingerprint = getSystemHardwareFingerprint()
  const hash = crypto.createHash('sha256').update(rawFingerprint).digest('hex').toUpperCase()

  const p1 = hash.slice(0, 4)
  const p2 = hash.slice(4, 8)
  const p3 = hash.slice(8, 12)
  const p4 = hash.slice(12, 16)

  const prefix = process.platform === 'win32' ? 'WIN' : 'DEV'
  cachedMachineId = `${prefix}-${p1}-${p2}-${p3}-${p4}`

  if (cacheFile) {
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ machineId: cachedMachineId }, null, 2), 'utf8')
    } catch {
      // ignore
    }
  }

  return cachedMachineId
}

module.exports = {
  getMachineId,
  getSystemHardwareFingerprint,
}
