var https = require('node:https')

var DEFAULT_OCR_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'
var OCR_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions'
var MAX_IMAGE_WIDTH = 2880
var MAX_IMAGE_HEIGHT = 3600
var MAX_IMAGE_EDGE = MAX_IMAGE_WIDTH
var MAX_DATA_URL_CHARS = 2200000
var OCR_TIMEOUT_MS = 180000

/**
 * 将用户输入拆成去重后的 API Key 列表。
 * @param {string|string[]} input API Key 或分隔后的密钥集合
 * @return {string[]} 可尝试的密钥列表
 */
function normalizeApiKeys(input) {
  var values = Array.isArray(input) ? input : [input]
  return [...new Set(values.flatMap((value) => String(value || '').split(/[\s,;|]+/)).map((value) => value.trim()).filter(Boolean))]
}

/**
 * 生成同时支持字段抽取和表格导出的视觉 OCR 提示词。
 * @return {string} OCR 提示词
 */
function buildOcrPrompt() {
  return [
    '请识别图片中的全部可见文字和表格，严格只返回 JSON 对象，不要 Markdown，不要解释。',
    'table.columns 必须按图片表头从左到右逐字输出，不能改名、合并或漏列；若表头因宽度被截断，保留可见表头文字。',
    'table.rows 只输出数据行，每行长度必须与 columns 完全一致，单元格按列位置对应。',
    '第一张图是完整表格，必须从左到右读出全部列，重点包括姓名、住院号/门诊号、日期/时间、主管/参观；这些左侧列禁止整列留空。',
    '重点读取右侧诊断区：西医诊断在中医诊断左边，两列必须分别读取，禁止合并、漏列或互相复制。',
    '西医诊断单元格常见格式是“(ICD编码)病名”，例如 (M47.921)颈椎病、(G47.001)失眠、(M51.202)腰椎间盘突出；编码和后面的中文病名都要读出，禁止只填编码，禁止整列留空。',
    '中医诊断在最右侧，常见格式是“(编码)病名:证型”或“(编码)病名-证型”，例如 (A03.06.04.05)颈椎病:风寒湿痹阻证。',
    '若表头被截成“西医诊”“中医诊”，仍按这两列从左到右对应西医诊断、中医诊断。',
    '诊断列即使字小、列窄、表头被截断，也必须逐行读出编码和中文病名/证型；禁止把西医诊断或中医诊断整列留空。',
    '重点读取日期：图片里的“时间/日期/就诊时间/入院时间”列要读出可见的 YYYY-MM-DD，单元格后面的省略号不影响日期。',
    '每个单元格只能填写图片中该单元格实际看见的文字。姓名、住院号、日期、主管/参观以第一张完整表格为准；只有第一张图对应单元格确实没有文字时才填空字符串。不要使用“图片未识别”、YYYY-MM-DD、YYYY-M、示例文字或占位符。',
    '挂号单/挂号流水号与门诊号是不同字段，必须按各自表头读取，禁止用挂号单替代门诊号。不要根据姓名、上一行或其他行补齐病历号。',
    'rawText 保留图片中可见文字，fields 用于无表格图片的键值字段。',
    '返回结构：{"rawText":"","fields":{"patientName":"","gender":"","age":"","admissionDate":"","diagnosis":"","chiefComplaint":"","course":"","treatment":""},"table":{"columns":["图片中的表头"],"rows":[["单元格内容"]]}}。普通页面没有表格时 table.columns 和 table.rows 返回空数组。',
  ].join('\n')
}

/**
 * 取出模型回复中的 JSON 主体。
 * @param {string} text 模型回复文本
 * @return {string} JSON 主体
 */
function extractJsonText(text) {
  var cleanedText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  var startIndex = cleanedText.indexOf('{')
  if (startIndex < 0) return '{}'
  return cleanedText.slice(startIndex)
}

/**
 * 修复视觉模型常见的非严格 JSON 输出。
 * @param {string} text 待修复的 JSON 文本
 * @return {string} 可供 JSON.parse 处理的文本
 */
function repairJsonText(text) {
  var characters = [...text]
  var repairedText = ''
  var inString = false
  var escaped = false
  var stack = []
  var rootClosed = false
  characters.forEach((character, index) => {
    if (rootClosed) return
    if (inString) {
      if (escaped) {
        repairedText += /^["\\/bfnrtu]$/.test(character) ? character : `\\${character}`
        escaped = false
        return
      }
      if (character === '\\') {
        repairedText += character
        escaped = true
        return
      }
      if (character === '"') {
        var nextCharacter = characters.slice(index + 1).find((characterAfterQuote) => !/\s/.test(characterAfterQuote))
        var isClosingQuote = !nextCharacter || ',:}]"[{'.includes(nextCharacter) || (nextCharacter >= '0' && nextCharacter <= '9')
        if (isClosingQuote) inString = false
        else repairedText += '\\"'
        if (isClosingQuote) repairedText += character
        return
      }
      var controlCharacterMap = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
      repairedText += controlCharacterMap[character] || character
      return
    }
    if (character === '"') {
      inString = true
      repairedText += character
      return
    }
    if ('{['.includes(character)) stack.push(character)
    if (character === '}' || character === ']') {
      var expectedOpening = character === '}' ? '{' : '['
      if (stack[stack.length - 1] === expectedOpening) {
        stack.pop()
        repairedText += character
        if (stack.length === 0) rootClosed = true
        return
      }
    }
    repairedText += character
  })
  if (escaped) repairedText += '\\'
  if (inString) repairedText += '"'
  stack.reverse().forEach((opening) => { repairedText += opening === '{' ? '}' : ']' })
  return insertMissingJsonCommas(repairedText).replace(/,\s*([}\]])/g, '$1')
}

function peekNonSpace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index += 1
  return text[index]
}

function startsJsonValue(character) {
  return Boolean(character && '"{[-0123456789tfn'.includes(character))
}

function insertMissingJsonCommas(text) {
  var output = ''
  var inString = false
  var escaped = false
  for (var index = 0; index < text.length; index += 1) {
    var character = text[index]
    output += character
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      if (!inString && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if ((character === ']' || character === '}') && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
    if (/[0-9]/.test(character) && text[index + 1] && /\s/.test(text[index + 1]) && startsJsonValue(peekNonSpace(text, index + 1))) output += ','
  }
  return output
}

/**
 * 将模型响应内容解析为结构化 OCR 数据。
 * @param {unknown} content 模型返回的 content
 * @return {Record<string, unknown>} 结构化识别结果
 */
function cleanOcrCell(value) {
  var text = String(value == null ? '' : value).trim()
  var normalized = text.replace(/\s+/g, '')
  if (/^(?:如|例如|表头|列名|单元格内容)\s*[0-9一二三四五六七八九十]*\s*[:：]?/u.test(text)) return ''
  if (['图片未识别', '图片未识别时保持空白', '未识别', '识别失败', '待识别', '暂无', '无'].includes(normalized)) return ''
  if (/^[YMD\-/_.]{3,}$/i.test(normalized)) return ''
  if (/^Y{2,4}(?:[-/.]?M{1,2}(?:[-/.]?D{1,2})?)?$/i.test(normalized)) return ''
  if (/^\d{4}[-/.]M{1,2}(?:[-/.]D{1,2})?$/i.test(normalized)) return ''
  return text
}

function parseOcrContent(content) {
  var text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
    : String(content || '')
  var jsonText = extractJsonText(text)
  var parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    try {
      parsed = JSON.parse(repairJsonText(jsonText))
    } catch {
      parsed = { rawText: text, fields: {}, table: { columns: [], rows: [] } }
    }
  }
  var fields = parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {}
  var table = parsed.table && typeof parsed.table === 'object' ? parsed.table : {}
  return {
    ...parsed,
    rawText: String(parsed.rawText || ''),
    ...fields,
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, cleanOcrCell(value)])),
    table: {
      columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
      rows: Array.isArray(table.rows) ? table.rows.map((row) => Array.isArray(row)
        ? row.map(cleanOcrCell)
        : Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, cleanOcrCell(value)]))) : [],
    },
  }
}

/**
 * 把 Node/Electron 网络错误整理成可读原因。
 * @param {unknown} error 原始错误
 * @return {string} 错误摘要
 */
function formatNetworkError(error) {
  var err = error && typeof error === 'object' ? error : {}
  var cause = err.cause && typeof err.cause === 'object' ? err.cause : {}
  var parts = [err.message, err.code, cause.code, cause.message].map((value) => String(value || '').trim()).filter(Boolean)
  return [...new Set(parts)].join(' / ') || 'OCR 请求失败'
}

/**
 * 压缩病历图时优先保住表格宽度，避免右侧中西医诊断列被压糊。
 * @param {string} dataUrl 原始 Data URL
 * @param {{ maxEdge?: number, maxWidth?: number, maxHeight?: number, maxChars?: number }} [limits] 压缩上限
 * @return {string} 压缩后的 Data URL
 */
function shrinkDataUrl(dataUrl, limits) {
  var source = String(dataUrl || '')
  if (!source) return source
  var maxWidth = Math.max(1280, Number(limits && limits.maxWidth) || Number(limits && limits.maxEdge) || MAX_IMAGE_WIDTH)
  var maxHeight = Math.max(1280, Number(limits && limits.maxHeight) || MAX_IMAGE_HEIGHT)
  var maxChars = Math.max(200000, Number(limits && limits.maxChars) || MAX_DATA_URL_CHARS)
  try {
    var { nativeImage } = require('electron')
    var image = nativeImage.createFromDataURL(source)
    if (!image || image.isEmpty()) return source
    var current = image
    var quality = 86
    var best = source
    for (var round = 0; round < 6; round += 1) {
      var size = current.getSize()
      var width = size.width || 0
      var height = size.height || 0
      if (!width || !height) break
      var scale = 1
      if (width > maxWidth) scale = Math.min(scale, maxWidth / width)
      if (height > maxHeight) {
        var heightScale = maxHeight / height
        if (width * heightScale >= 2000 || width < 2000) scale = Math.min(scale, heightScale)
      }
      if (scale < 0.999) {
        current = current.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'best',
        })
      }
      var jpeg = current.toJPEG(quality)
      if (!jpeg || !jpeg.length) break
      var candidate = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      if (candidate.length < best.length) best = candidate
      if (best.length <= maxChars) return best
      quality = Math.max(62, quality - 8)
      if (round >= 3) maxWidth = Math.max(2000, Math.round(maxWidth * 0.9))
    }
    return best
  } catch {
    return source
  }
}

/**
 * 裁出表格右侧，专门放大西医诊断 / 中医诊断列。
 * @param {string} dataUrl 已压缩的全图表
 * @param {number} [ratio] 右侧宽度占比
 * @return {string} 右侧切片 Data URL
 */
function cropRightDataUrl(dataUrl, ratio) {
  try {
    var { nativeImage } = require('electron')
    var image = nativeImage.createFromDataURL(dataUrl)
    if (!image || image.isEmpty()) return ''
    var size = image.getSize()
    if ((size.width || 0) < 400) return ''
    var width = Math.max(240, Math.round(size.width * (ratio || 0.48)))
    var x = Math.max(0, size.width - width)
    var cropped = image.crop({ x: x, y: 0, width: width, height: size.height })
    if (!cropped || cropped.isEmpty()) return ''
    var jpeg = cropped.toJPEG(88)
    if (!jpeg || !jpeg.length) return ''
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return ''
  }
}

/**
 * 用 HTTP/1.1 + IPv4 提交 JSON。
 * @param {string} url 接口地址
 * @param {Record<string, string>} headers 请求头
 * @param {string} body JSON 文本
 * @param {number} timeoutMs 超时毫秒
 * @return {Promise<{ok: boolean, status: number, text: () => Promise<string>, json: () => Promise<any>}>}
 */
function postJsonHttps(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    var parsed = new URL(url)
    var payload = Buffer.from(body)
    var req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      family: 4,
      timeout: timeoutMs,
      headers: {
        ...headers,
        'Content-Length': payload.length,
      },
    }, (res) => {
      var chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        var text = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: Number(res.statusCode) >= 200 && Number(res.statusCode) < 300,
          status: Number(res.statusCode) || 0,
          text: () => Promise.resolve(text),
          json: () => Promise.resolve(JSON.parse(text)),
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error(`OCR 请求超时（${Math.round(timeoutMs / 1000)} 秒）`))
    })
    req.write(payload)
    req.end()
  })
}

/**
 * 提交 JSON：先走 Node HTTPS，失败时回退到 Chromium net.fetch。
 * @param {string} url 接口地址
 * @param {Record<string, string>} headers 请求头
 * @param {string} body JSON 文本
 * @param {number} timeoutMs 超时毫秒
 * @return {Promise<{ok: boolean, status: number, text: () => Promise<string>, json: () => Promise<any>}>}
 */
async function postJson(url, headers, body, timeoutMs) {
  try {
    return await postJsonHttps(url, headers, body, timeoutMs)
  } catch (httpsError) {
    try {
      var { net } = require('electron')
      var controller = new AbortController()
      var timer = setTimeout(() => controller.abort(), timeoutMs)
      var response = await net.fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      clearTimeout(timer)
      var text = await response.text()
      return {
        ok: response.ok,
        status: response.status,
        text: () => Promise.resolve(text),
        json: () => Promise.resolve(JSON.parse(text)),
      }
    } catch {
      throw httpsError
    }
  }
}

function buildOcrBody(model, dataUrl, rightDataUrl) {
  var content = [
    { type: 'text', text: buildOcrPrompt() },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]
  if (rightDataUrl) {
    content.push({ type: 'text', text: '第二张图是同一张表格的右侧放大，专门读取西医诊断和中医诊断。每一行都要把这两列填回 table.rows，编码和中文病名/证型都要保留，禁止整列留空。' })
    content.push({ type: 'image_url', image_url: { url: rightDataUrl } })
    content.push({ type: 'text', text: '请把第一张图的姓名、住院号、日期、主管/参观与第二张图的中西医诊断合并进同一张表；禁止因第二张图裁切而清空左侧列。' })
  }
  return JSON.stringify({
    model: model || DEFAULT_OCR_MODEL,
    temperature: 0,
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: content,
    }],
  })
}

/**
 * 调用硅基流动视觉模型，并在多个密钥之间自动故障转移。
 * @param {{ dataUrl: string, apiKeys: string|string[], model?: string }} options OCR 请求参数
 * @return {Promise<Record<string, unknown>>} 结构化 OCR 结果
 */
async function requestVisionOcr(options) {
  var apiKeys = normalizeApiKeys(options.apiKeys)
  if (apiKeys.length === 0) throw new Error('未配置硅基流动 API Key')
  var maxWidth = MAX_IMAGE_WIDTH
  var maxChars = MAX_DATA_URL_CHARS
  var dataUrl = shrinkDataUrl(options.dataUrl, { maxWidth: maxWidth, maxChars: maxChars })
  var rightDataUrl = cropRightDataUrl(dataUrl, 0.48)
  var lastError = 'OCR 请求失败'
  for (var index = 0; index < apiKeys.length; index += 1) {
    for (var attempt = 1; attempt <= 3; attempt += 1) {
      var body = buildOcrBody(options.model, dataUrl, rightDataUrl)
      try {
        var response = await postJson(OCR_ENDPOINT, {
          Authorization: `Bearer ${apiKeys[index]}`,
          'Content-Type': 'application/json',
        }, body, OCR_TIMEOUT_MS)
        if (!response.ok) {
          var errorText = await response.text()
          lastError = `OCR 请求失败：${response.status} ${errorText}`
          var tooLarge = response.status === 400 && /Bad Request|too large|entity too large|request entity/i.test(errorText)
          if ((tooLarge || [429, 502, 503, 504].includes(response.status)) && attempt < 3) {
            if (tooLarge) {
              maxWidth = Math.max(2000, Math.round(maxWidth * 0.8))
              maxChars = Math.max(700000, Math.round(maxChars * 0.7))
              dataUrl = shrinkDataUrl(options.dataUrl, { maxWidth: maxWidth, maxChars: maxChars })
              rightDataUrl = cropRightDataUrl(dataUrl, 0.48)
            }
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt))
            continue
          }
          break
        }
        var result = await response.json()
        return parseOcrContent(result.choices?.[0]?.message?.content)
      } catch (error) {
        lastError = `OCR 网络请求失败：${formatNetworkError(error)}`
        if (attempt === 3) break
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
      }
    }
  }
  throw new Error(lastError)
}

module.exports = { DEFAULT_OCR_MODEL, normalizeApiKeys, parseOcrContent, requestVisionOcr, buildOcrPrompt }
