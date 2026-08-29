var fs = require('node:fs')
var path = require('node:path')
var { app, safeStorage } = require('electron')

var SETTINGS_VERSION = 1
var DEFAULT_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'

/**
 * 返回 OCR 设置文件路径。
 * @return {string} 当前用户的本机设置路径
 */
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'ocr-settings.json')
}

/**
 * 读取磁盘上的加密设置。
 * @return {{ version?: number, model?: string, encryptedKeys?: string[] }} 原始设置
 */
function readStoredSettings() {
  var settingsPath = getSettingsPath()
  if (!fs.existsSync(settingsPath)) return {}
  try {
    var settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    return settings && typeof settings === 'object' ? settings : {}
  } catch {
    return {}
  }
}

/**
 * 解密一个本机保存的 API Key。
 * @param {string} encryptedKey Base64 编码的密文
 * @return {string} 解密后的密钥
 */
function decryptApiKey(encryptedKey) {
  if (!encryptedKey || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
  } catch {
    return ''
  }
}

/**
 * 返回 OCR 配置，但不向渲染进程暴露密钥内容。
 * @return {{ model: string, apiKeys: string[] }} OCR 配置
 */
function getOcrSettings() {
  var storedSettings = readStoredSettings()
  var encryptedKeys = Array.isArray(storedSettings.encryptedKeys) ? storedSettings.encryptedKeys : []
  var apiKeys = encryptedKeys.map(decryptApiKey).filter(Boolean)
  return {
    model: storedSettings.model || process.env.SILICONFLOW_MODEL || DEFAULT_MODEL,
    apiKeys: apiKeys,
  }
}

/**
 * 加密并保存 OCR 配置到当前 Windows 用户的数据目录。
 * @param {{ apiKeys?: string[], model?: string }} settings 待保存配置
 * @return {{ model: string, keyCount: number }} 不含密钥的保存结果
 */
function saveOcrSettings(settings) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持安全密钥存储，未保存 API Key')
  var rawApiKeys = Array.isArray(settings.apiKeys) ? settings.apiKeys : [settings.apiKeys]
  var apiKeys = [...new Set(rawApiKeys.map(String).flatMap((key) => key.split(/[\s,;|]+/)).map((key) => key.trim()).filter(Boolean))].slice(0, 5)
  var model = String(settings.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL
  var encryptedKeys = apiKeys.map((apiKey) => safeStorage.encryptString(apiKey).toString('base64'))
  var settingsPath = getSettingsPath()
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify({ version: SETTINGS_VERSION, model, encryptedKeys }, null, 2), 'utf8')
  return { model, keyCount: apiKeys.length }
}

module.exports = { DEFAULT_MODEL, getOcrSettings, getSettingsPath, saveOcrSettings }