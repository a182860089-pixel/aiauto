const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { getOcrSettings } = require('../electron/ocrSettings.cjs')
const { requestVisionOcr } = require('../electron/ocrClient.cjs')
const { writeOcrWorkbook } = require('../electron/excelExporter.cjs')

var inputPath = process.argv[2]
var outputPath = process.argv[3]

/**
 * 将图片文件转换为视觉接口可接受的 Data URL。
 * @param {string} filePath 图片路径
 * @return {string} 图片 Data URL
 */
function toDataUrl(filePath) {
  var extension = path.extname(filePath).toLowerCase()
  var mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' }
  var mimeType = mimeTypes[extension]
  if (!mimeType) throw new Error('仅支持 jpg、jpeg、png、webp、bmp 图片')
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
}

/**
 * 执行图片 OCR 并导出 Excel。
 * @return {Promise<void>} 完成后退出 Electron
 */
async function run() {
  if (!inputPath) throw new Error('用法：npm run ocr:excel -- 图片路径 [Excel输出路径]')
  if (!fs.existsSync(inputPath)) throw new Error(`图片不存在：${inputPath}`)
  var settings = getOcrSettings()
  var ocrResult = await requestVisionOcr({
    dataUrl: toDataUrl(inputPath),
    apiKeys: settings.apiKeys,
    model: settings.model,
  })
  var targetPath = outputPath || path.join(process.cwd(), 'ocr-output', `${path.basename(inputPath, path.extname(inputPath))}.xlsx`)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  var exportResult = await writeOcrWorkbook(ocrResult, targetPath)
  console.log(JSON.stringify({ ...exportResult, model: settings.model }, null, 2))
}

app.whenReady().then(() => run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => app.quit()))