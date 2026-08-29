const { app } = require('electron')
const { DEFAULT_MODEL, getSettingsPath, saveOcrSettings } = require('../electron/ocrSettings.cjs')

/** 保存环境变量中的密钥后立即退出，避免把密钥写入项目文件。 */
app.whenReady().then(() => {
  var apiKeys = [
    process.env.SILICONFLOW_API_KEY_1,
    process.env.SILICONFLOW_API_KEY_2,
    process.env.SILICONFLOW_API_KEYS,
    process.env.SILICONFLOW_API_KEY,
  ].filter(Boolean)
  var result = saveOcrSettings({
    apiKeys,
    model: process.env.SILICONFLOW_MODEL || DEFAULT_MODEL,
  })
  console.log(`OCR_SETTINGS_SAVED keyCount=${result.keyCount} model=${result.model} path=${getSettingsPath()}`)
  app.quit()
})