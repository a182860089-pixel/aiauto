const fs = require('fs')
const path = require('path')

const DB_FILE = path.join(__dirname, 'data', 'licenses.json')
const BACKUP_FILE = path.join(__dirname, 'data', 'licenses.backup.json')

function ensureDir() {
  const dir = path.dirname(DB_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

class LicenseStore {
  constructor() {
    ensureDir()
    this.licenses = this.load()
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8')
        return JSON.parse(raw)
      }
    } catch (err) {
      console.error('[DB] 读取数据失败，尝试读取备份:', err.message)
      if (fs.existsSync(BACKUP_FILE)) {
        try {
          const raw = fs.readFileSync(BACKUP_FILE, 'utf8')
          return JSON.parse(raw)
        } catch {
          // ignore
        }
      }
    }
    return []
  }

  save() {
    try {
      ensureDir()
      const data = JSON.stringify(this.licenses, null, 2)
      // 先写临时文件，再重命名，保证原子性防损坏
      const tmpFile = `${DB_FILE}.tmp`
      fs.writeFileSync(tmpFile, data, 'utf8')
      if (fs.existsSync(DB_FILE)) {
        fs.copyFileSync(DB_FILE, BACKUP_FILE)
      }
      fs.renameSync(tmpFile, DB_FILE)
    } catch (err) {
      console.error('[DB] 保存数据失败:', err)
    }
  }

  getAll() {
    return this.licenses
  }

  getById(id) {
    return this.licenses.find((item) => item.id === id)
  }

  getByCode(code) {
    if (!code) return null
    return this.licenses.find((item) => item.code.trim().toUpperCase() === code.trim().toUpperCase())
  }

  getByMachineId(machineId) {
    if (!machineId) return []
    return this.licenses.filter((item) => item.machineId === machineId)
  }

  add(license) {
    this.licenses.unshift(license)
    this.save()
    return license
  }

  update(id, updater) {
    const index = this.licenses.findIndex((item) => item.id === id)
    if (index === -1) return null
    const current = this.licenses[index]
    const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
    updated.updatedAt = new Date().toISOString()
    this.licenses[index] = updated
    this.save()
    return updated
  }

  delete(id) {
    const index = this.licenses.findIndex((item) => item.id === id)
    if (index === -1) return false
    this.licenses.splice(index, 1)
    this.save()
    return true
  }

  deleteMany(ids) {
    const idSet = new Set(ids)
    const beforeCount = this.licenses.length
    this.licenses = this.licenses.filter((item) => !idSet.has(item.id))
    this.save()
    return beforeCount - this.licenses.length
  }
}

module.exports = new LicenseStore()
