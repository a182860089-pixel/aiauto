var DEFAULT_OCR_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'
var OCR_ENDPOINT = 'https://api.siliconflow.cn/v1/chat/completions'

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
  return '请识别图片中的全部可见文字和表格，严格只返回 JSON 对象，不要 Markdown。必须完整输出，不要只返回前几行；保留原图中的文字、日期、数字、身份证号和每一个表格单元格，不要补全或猜测。返回结构：{"rawText":"图片中从上到下的全部可见文字","fields":{"patientName":"","gender":"","age":"","admissionDate":"","diagnosis":"","chiefComplaint":"","course":"","treatment":""},"table":{"columns":["列名1"],"rows":[{"列名1":"单元格内容"}]}}。rawText 必须包含表格文字；表格按从左到右、从上到下逐行输出，rows 必须包含全部可见数据行，不能省略；无法确认的单元格返回空字符串。普通页面没有表格时 table.columns 和 table.rows 返回空数组。'
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
        var isClosingQuote = !nextCharacter || ',:}]'.includes(nextCharacter)
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
  return repairedText.replace(/,\s*([}\]])/g, '$1')
}

/**
 * 将模型响应内容解析为结构化 OCR 数据。
 * @param {unknown} content 模型返回的 content
 * @return {Record<string, unknown>} 结构化识别结果
 */
function parseOcrContent(content) {
  var text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
    : String(content || '')
  var jsonText = extractJsonText(text)
  var parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    parsed = JSON.parse(repairJsonText(jsonText))
  }
  var fields = parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : {}
  var table = parsed.table && typeof parsed.table === 'object' ? parsed.table : {}
  return {
    ...parsed,
    rawText: String(parsed.rawText || ''),
    ...fields,
    fields,
    table: {
      columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
      rows: Array.isArray(table.rows) ? table.rows : [],
    },
  }
}

/**
 * 调用硅基流动视觉模型，并在多个密钥之间自动故障转移。
 * @param {{ dataUrl: string, apiKeys: string|string[], model?: string }} options OCR 请求参数
 * @return {Promise<Record<string, unknown>>} 结构化 OCR 结果
 */
async function requestVisionOcr(options) {
  var apiKeys = normalizeApiKeys(options.apiKeys)
  if (apiKeys.length === 0) throw new Error('未配置硅基流动 API Key')
  var lastError = 'OCR 请求失败'
  for (var index = 0; index < apiKeys.length; index += 1) {
    var response = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeys[index]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || DEFAULT_OCR_MODEL,
        temperature: 0,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildOcrPrompt() },
            { type: 'image_url', image_url: { url: options.dataUrl } },
          ],
        }],
      }),
    })
    if (!response.ok) {
      lastError = `OCR 请求失败：${response.status} ${await response.text()}`
      continue
    }
    var result = await response.json()
    return parseOcrContent(result.choices?.[0]?.message?.content)
  }
  throw new Error(lastError)
}

module.exports = { DEFAULT_OCR_MODEL, normalizeApiKeys, parseOcrContent, requestVisionOcr }