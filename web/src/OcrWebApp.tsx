import { useEffect, useState } from 'react'
import { DEFAULT_OCR_MODEL, exportRecognizedRows, normalizeApiKeys, requestVisionOcr, type OcrExportJob, type OcrPreviewJob } from './ocrBrowser'
import ManualOverrideFields from './ManualOverrideFields'
import { getManualOverrideError, rememberDepartment } from './templateMapping'

var STORAGE_KEY = 'ocr-web-api-key'
var STORAGE_MODEL = 'ocr-web-model'

/**
 * 读取本地文件为 Data URL。
 * @param file 本地文件
 * @return Data URL
 */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    var reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * 切换一行是否勾选。
 * @param current 当前勾选
 * @param index 行号
 * @return 新勾选集合
 */
function toggleSelectedIndex(current: number[], index: number) {
  return current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((left, right) => left - right)
}

export default function OcrWebApp() {
  var [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '')
  var [ocrModel, setOcrModel] = useState(() => localStorage.getItem(STORAGE_MODEL) || DEFAULT_OCR_MODEL)
  var [uploadedName, setUploadedName] = useState('未选择文件')
  var [imageDataUrl, setImageDataUrl] = useState('')
  var [templateName, setTemplateName] = useState('使用默认模板')
  var [templateDataUrl, setTemplateDataUrl] = useState('')
  var [previewJob, setPreviewJob] = useState<OcrPreviewJob | null>(null)
  var [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  var [exportJob, setExportJob] = useState<OcrExportJob | null>(null)
  var [status, setStatus] = useState('先识别图片，再勾选行并指定类别，最后写入 Excel')
  var [busy, setBusy] = useState(false)
  var [elapsed, setElapsed] = useState(0)
  var [recordCategory, setRecordCategory] = useState('')
  var [department, setDepartment] = useState('')
  var [customDepartments, setCustomDepartments] = useState<string[]>([])

  useEffect(() => {
    if (!busy) return undefined
    setElapsed(0)
    var startedAt = Date.now()
    var timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  /**
   * 选择待识别图片。
   * @param event 文件选择事件
   * @return 无
   */
  var handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    var file = event.target.files?.[0]
    if (!file) {
      setUploadedName('未选择文件')
      setImageDataUrl('')
      return
    }
    setUploadedName(file.name)
    setImageDataUrl(await readFileAsDataUrl(file))
    setPreviewJob(null)
    setSelectedIndexes([])
    setExportJob(null)
    setStatus('图片已选择，点击“识别图片”')
  }

  var handleTemplateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    var file = event.target.files?.[0]
    if (!file) {
      setTemplateName('使用默认模板')
      setTemplateDataUrl('')
      return
    }
    try {
      setTemplateName(file.name)
      setTemplateDataUrl(await readFileAsDataUrl(file))
      setExportJob(null)
      setStatus(`已选择模板：${file.name}`)
    } catch (error) {
      setTemplateName('使用默认模板')
      setTemplateDataUrl('')
      setStatus(error instanceof Error ? error.message : '模板读取失败')
    }
  }

  /**
   * 把 Key 和模型持久化到本机浏览器。
   * @return 无
   */
  var saveKeys = () => {
    var keys = normalizeApiKeys(apiKey)
    if (!keys.length) return setStatus('请先填写至少一把 API Key')
    localStorage.setItem(STORAGE_KEY, keys.join('\n'))
    localStorage.setItem(STORAGE_MODEL, ocrModel)
    setApiKey(keys.join('\n'))
    setStatus(`已保存 ${keys.length} 把 Key 到本机，刷新后仍会自动填入`)
  }

  /**
   * 记住手输过的新科室，供下次下拉使用。
   * @param value 当前输入
   * @return 无
   */
  var rememberTypedDepartment = (value: string) => {
    setDepartment(value)
    setCustomDepartments((current) => rememberDepartment(current, value))
  }

  /**
   * 只识别图片，不立即写 Excel。
   * @return 无
   */
  var recognizeImage = async () => {
    if (busy) return
    if (!imageDataUrl) return setStatus('请先选择图片')
    localStorage.setItem(STORAGE_KEY, apiKey)
    localStorage.setItem(STORAGE_MODEL, ocrModel)
    setBusy(true)
    setPreviewJob(null)
    setSelectedIndexes([])
    setExportJob(null)
    setStatus('正在按多把 Key 并发识别…')
    try {
      var result = await requestVisionOcr({ dataUrl: imageDataUrl, apiKeys: apiKey, model: ocrModel })
      setPreviewJob(result)
      setSelectedIndexes(result.rows.map((_, index) => index))
      setStatus(result.rowCount ? `已识别 ${result.rowCount} 行，请勾选并指定类别后再写入 Excel` : '识别完成，但没有可用行')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'OCR 失败')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 把勾选行按当前类别和科室写入 Excel。
   * @return 无
   */
  var exportExcel = async () => {
    if (busy) return
    if (!previewJob) return setStatus('请先识别图片')
    if (!selectedIndexes.length) return setStatus('请先勾选要写入 Excel 的行')
    var overrideError = getManualOverrideError({ 记录类别: recordCategory, 所在科室: department })
    if (overrideError) return setStatus(overrideError)
    setBusy(true)
    setStatus('正在把勾选行写入 Excel…')
    try {
      var result = await exportRecognizedRows({
        id: previewJob.id,
        fileName: uploadedName.replace(/\.[^.]+$/, '') || 'OCR识别结果',
        templateDataUrl: templateDataUrl || undefined,
        recordCategory,
        department,
        selectedIndexes,
      })
      setExportJob(result)
      setStatus(`已写入 ${result.rowCount} 行，匹配 ${result.matchedColumns?.length || 0} 列，忽略 ${result.ignoredColumns?.length || 0} 列`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Excel 导出失败')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 下载生成的 Excel。
   * @return 无
   */
  var downloadExcel = () => {
    if (!exportJob?.downloadUrl) return
    window.location.href = exportJob.downloadUrl
  }

  /**
   * 用系统默认程序打开生成的 Excel。
   * @return 无
   */
  var openExcel = async () => {
    if (!exportJob?.id) return
    var response = await fetch('/ocr-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: exportJob.id }),
    })
    setStatus(response.ok ? '已在本机打开 Excel' : '打开失败，请改用下载')
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="brand-block">
          <div className="brand-mark">识</div>
          <div>
            <p className="eyebrow">独立功能</p>
            <h1>图片识别</h1>
            <p className="hero-copy">先识别表格，再批量勾选类别后写入 Excel</p>
          </div>
        </div>
      </header>

      <main className="ocr-page ocr-page-single">
        <section className="panel ocr-main-panel">
          <div className="panel-header">
            <div>
              <h2>识别后勾选再写入</h2>
              <p className="section-subtitle">识别只出表；勾选行并指定类别、科室后，才写入模板</p>
            </div>
            <span className="badge">网页版</span>
          </div>
          <label className="upload-card">
            <input id="ocr-file" type="file" accept="image/*" onChange={handleFileChange} />
            <span className="upload-icon">＋</span>
            <strong>选择图片</strong>
            <small>{uploadedName}</small>
          </label>
          <label className="upload-card template-upload-card">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleTemplateChange} />
            <span className="upload-icon">表</span>
            <strong>选择 Excel 模板</strong>
            <small>{templateName}</small>
          </label>
          {imageDataUrl ? <img className="ocr-preview" src={imageDataUrl} alt="待识别图片预览" /> : null}
          <label className="config-field">
            <span>硅基流动 API Key，多把会并发</span>
            <textarea value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="每行一把，或用 | 分隔" rows={4} />
          </label>
          <div className="ocr-settings-row">
            <button type="button" onClick={saveKeys}>保存 Key</button>
            <span>保存在本机浏览器，下次打开自动带出</span>
          </div>
          <label className="config-field">
            <span>视觉模型</span>
            <input value={ocrModel} onChange={(event) => setOcrModel(event.target.value)} />
          </label>
          <div className="action-row">
            <button type="button" className="primary-btn" onClick={recognizeImage} disabled={busy}>
              {busy && !previewJob ? `识别中 ${elapsed}s` : '识别图片'}
            </button>
          </div>
          {previewJob ? (
            <div className="ocr-table-preview">
              <div className="table-preview-header">
                <strong>识别结果</strong>
                <span>已选 {selectedIndexes.length} / {previewJob.rows.length} 行</span>
              </div>
              <div className="field-toolbar">
                <button type="button" onClick={() => setSelectedIndexes(previewJob?.rows.map((_, index) => index) || [])}>全选</button>
                <button type="button" onClick={() => setSelectedIndexes([])}>清空勾选</button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>写入</th>
                      {previewJob.columns.map((column) => <th key={column}>{column}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewJob.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={selectedIndexes.includes(rowIndex) ? 'row-checked' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIndexes.includes(rowIndex)}
                            onChange={() => setSelectedIndexes((current) => toggleSelectedIndex(current, rowIndex))}
                          />
                        </td>
                        {row.map((value, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}>{String(value ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <ManualOverrideFields
            recordCategory={recordCategory}
            department={department}
            customDepartments={customDepartments}
            onRecordCategoryChange={setRecordCategory}
            onDepartmentChange={rememberTypedDepartment}
          />
          <div className="action-row">
            <button type="button" className="primary-btn" onClick={exportExcel} disabled={busy || !previewJob}>
              {busy && previewJob ? `写入中 ${elapsed}s` : '写入勾选行到 Excel'}
            </button>
            <button type="button" onClick={downloadExcel} disabled={!exportJob || busy}>下载 Excel</button>
            <button type="button" onClick={openExcel} disabled={!exportJob || busy}>打开 Excel</button>
          </div>
          <p className="status-text">{status}</p>
        </section>
      </main>
    </div>
  )
}