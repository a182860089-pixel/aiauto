import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { ViteDevServer } from 'vite'
import ExcelJS from 'exceljs'
import { DEFAULT_OCR_MODEL, normalizeApiKeys, parseOcrContent } from '../src/ocrBrowser'
import { smartSlice } from '../backend/smartSlicing.js'
import { SiliconFlowClient } from '../backend/siliconFlowClient.js'
import { buildRowIdentity, mapOcrRowsToTemplate, mapSelectedOcrRowsToTemplate, requireManualOverrides, normalizeHeader, type OcrRow, type TemplateOverrides } from '../src/templateMapping'

type OcrJob = {
  stage: string
  downloadUrl: string
  outputPath: string
  rowCount: number
  matchedColumns: string[]
  ignoredColumns: string[]
  error: string
  done: boolean
  columns: string[]
  rows: OcrRow[]
}

var jobs = new Map<string, OcrJob>()
var TEMPLATE_PATH = path.resolve('templates/GP自动录入助手_五类合并测试样例.xlsx')
var OUTPUT_DIR = path.resolve('ocr-output')

function readJson(request: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    var chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function collectColumns(results: Array<ReturnType<typeof parseOcrContent>>) {
  var columns: string[] = []
  results.forEach((result) => (result.table?.columns || []).forEach((column) => {
    if (column && !columns.some((item) => normalizeHeader(item) === normalizeHeader(column))) columns.push(column)
  }))
  return columns
}

function isHeaderRow(row: string[], columns: string[]) {
  var matched = row.filter((cell, index) => normalizeHeader(cell) === normalizeHeader(columns[index] || '')).length
  return matched >= Math.max(2, Math.floor(columns.length / 3))
}

function mergeNativeRows(results: Array<ReturnType<typeof parseOcrContent>>) {
  var columns = collectColumns(results)
  var seen = new Set<string>()
  var rows = results.flatMap((result) => {
    var sourceColumns = result.table?.columns?.length ? result.table.columns : columns
    return (result.table?.rows || []).map((row) => {
      var source = Array.isArray(row)
        ? Object.fromEntries(sourceColumns.map((column, index) => [column, String(row[index] ?? '')]))
        : Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, String(value ?? '')]))
      return columns.map((column) => {
        var key = Object.keys(source).find((candidate) => normalizeHeader(candidate) === normalizeHeader(column))
        return key ? source[key] : ''
      })
    })
  }).filter((row) => {
    if (row.every((cell) => !String(cell).trim()) || isHeaderRow(row, columns)) return false
    var source = Object.fromEntries(columns.map((column, index) => [column, row[index] || '']))
    var key = buildRowIdentity(source, columns)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { columns, rows }
}

/** 使用新的全局限流器和健康度 Key 池，兼容现有 Vite /ocr-run 接口。 */
async function recognizeAll(slices: string[], keys: string[], model: string) {
  var client = new SiliconFlowClient({ apiKeys: keys })
  var tasks = slices.map((slice, index) => client.infer(slice, {
    index, sourceYStart: 0, sourceYEnd: 0, headerYStart: 0, headerYEnd: 0, rowStart: 0, rowEnd: 0,
  }, model).then((result) => parseOcrContent(JSON.stringify(result), index)))
  var settled = await Promise.allSettled(tasks)
  var succeeded = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : [])
  if (!succeeded.length) {
    var firstError = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined
    throw firstError?.reason instanceof Error ? firstError.reason : new Error('全部切片识别失败')
  }
  return succeeded
}

function buildOutputName(fileName: string) {
  var baseName = String(fileName || 'OCR识别结果').replace(/[\\/:*?"<>|]/g, '_').replace(/\.xlsx$/i, '')
  return `${baseName}-${Date.now()}.xlsx`
}

async function loadTemplateWorkbook(templateDataUrl?: string) {
  var workbook = new ExcelJS.Workbook()
  if (templateDataUrl) {
    var base64 = String(templateDataUrl).split(',').pop() || ''
    await workbook.xlsx.load(Buffer.from(base64, 'base64'))
    return workbook
  }
  await workbook.xlsx.readFile(TEMPLATE_PATH)
  return workbook
}

async function writeTemplateExcel(columns: string[], rows: OcrRow[], fileName: string, templateDataUrl?: string, overrides: TemplateOverrides = {}, selectedIndexes?: number[]) {
  if (!rows.length) throw new Error('没有识别到可写入 Excel 的表格行')
  var workbook = await loadTemplateWorkbook(templateDataUrl)
  var worksheet = workbook.worksheets[0]
  var templateHeaders = worksheet.getRow(1).values.slice(1).map((value) => String(value ?? '').trim())
  var mapped = selectedIndexes ? mapSelectedOcrRowsToTemplate(columns, rows, selectedIndexes, templateHeaders, overrides) : mapOcrRowsToTemplate(columns, rows, templateHeaders, overrides)
  if (!mapped.rows.length) throw new Error('图片中没有识别到可对应模板的非空字段')
  var lastRow = worksheet.actualRowCount
  Array.from({ length: Math.max(0, lastRow - 1) }, (_, index) => lastRow - index).filter((rowNumber) => rowNumber > 1).forEach((rowNumber) => worksheet.spliceRows(rowNumber, 1))
  var styleSource = worksheet.getRow(1)
  mapped.rows.forEach((row) => {
    var target = worksheet.addRow(row)
    target.height = styleSource.height
    target.eachCell((cell, columnNumber) => {
      var sourceCell = styleSource.getCell(columnNumber)
      cell.style = { ...sourceCell.style }
      cell.alignment = { vertical: 'top', wrapText: true }
    })
  })
  await mkdir(OUTPUT_DIR, { recursive: true })
  var safeName = buildOutputName(fileName)
  var outputPath = path.join(OUTPUT_DIR, safeName)
  await workbook.xlsx.writeFile(outputPath)
  return { outputPath, fileName: safeName, rowCount: mapped.rows.length, matchedColumns: mapped.matchedColumns, ignoredColumns: mapped.ignoredColumns }
}

async function runJob(job: OcrJob, slices: string[], keys: string[], model: string) {
  job.stage = `正在并发识别 ${slices.length} 个切片`
  var results = await recognizeAll(slices, keys, model)
  var output = mergeNativeRows(results)
  job.columns = output.columns
  job.rows = output.rows
  job.rowCount = output.rows.length
  job.stage = `已识别 ${output.rows.length} 行，请勾选后写入 Excel`
  job.done = true
}

function openExcel(outputPath: string) {
  return new Promise<void>((resolve, reject) => execFile('cmd', ['/c', 'start', '', outputPath], (error) => error ? reject(error) : resolve()))
}

export function attachOcrDevServer(server: ViteDevServer) {
  server.middlewares.use(async (request, response, next) => {
    try {
      if (request.url === '/ocr-run' && request.method === 'POST') {
        var body = await readJson(request)
        var keys = normalizeApiKeys(String(body.apiKeys || ''))
        if (!keys.length) throw new Error('请先填写硅基流动 API Key')
        var original = String(body.dataUrl || '')
        var slices = original ? (await smartSlice(original)).map((slice) => slice.dataUrl) : Array.isArray(body.slices) ? body.slices.map(String) : []
        if (!slices.length) throw new Error('没有收到待识别图片')
        var id = `job-${Date.now()}`
        var job: OcrJob = { stage: '已接收', downloadUrl: '', outputPath: '', rowCount: 0, matchedColumns: [], ignoredColumns: [], error: '', done: false, columns: [], rows: [] }
        jobs.set(id, job)
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id }))
        runJob(job, slices, keys, String(body.model || DEFAULT_OCR_MODEL)).catch((error) => { job.error = error instanceof Error ? error.message : 'OCR 失败'; job.stage = job.error; job.done = true })
        return
      }
      if (request.url?.startsWith('/ocr-status') && request.method === 'GET') {
        var id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id') || ''
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(jobs.get(id) || { error: '任务不存在', done: true }))
        return
      }
      if (request.url?.startsWith('/ocr-download') && request.method === 'GET') {
        var fileName = new URL(request.url, 'http://127.0.0.1').searchParams.get('file') || ''
        var filePath = path.resolve(OUTPUT_DIR, path.basename(fileName))
        if (!filePath.startsWith(OUTPUT_DIR) || !fileName) throw new Error('文件不存在')
        response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`)
        createReadStream(filePath).pipe(response)
        return
      }
      if (request.url === '/ocr-export' && request.method === 'POST') {
        var exportBody = await readJson(request)
        var exportJob = jobs.get(String(exportBody.id || ''))
        if (!exportJob || !exportJob.rows.length) throw new Error('请先完成图片识别')
        var overrides = requireManualOverrides({ 记录类别: String(exportBody.recordCategory || ''), 所在科室: String(exportBody.department || '') })
        var selectedIndexes = Array.isArray(exportBody.selectedIndexes) ? exportBody.selectedIndexes.map(Number).filter((index) => Number.isInteger(index)) : exportJob.rows.map((_, index) => index)
        if (!selectedIndexes.length) throw new Error('请先勾选要写入 Excel 的行')
        var exported = await writeTemplateExcel(exportJob.columns, exportJob.rows, String(exportBody.fileName || 'OCR识别结果'), String(exportBody.templateDataUrl || '') || undefined, overrides, selectedIndexes)
        exportJob.outputPath = exported.outputPath
        exportJob.downloadUrl = `/ocr-download?file=${encodeURIComponent(exported.fileName)}`
        exportJob.rowCount = exported.rowCount
        exportJob.matchedColumns = exported.matchedColumns
        exportJob.ignoredColumns = exported.ignoredColumns
        exportJob.stage = `已写入 ${exported.rowCount} 行`
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ id: String(exportBody.id || ''), downloadUrl: exportJob.downloadUrl, outputPath: exportJob.outputPath, rowCount: exportJob.rowCount, matchedColumns: exportJob.matchedColumns, ignoredColumns: exportJob.ignoredColumns }))
        return
      }
      if (request.url === '/ocr-open' && request.method === 'POST') {
        var openBody = await readJson(request)
        var job = jobs.get(String(openBody.id || ''))
        if (!job?.outputPath) throw new Error('还没有可打开的 Excel')
        await openExcel(job.outputPath)
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ ok: true }))
        return
      }
    } catch (error) {
      response.statusCode = 400
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : '识别服务异常' }))
      return
    }
    next()
  })
}
