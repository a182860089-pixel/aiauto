import { useEffect, useMemo, useState } from 'react'
import { buildFieldMap, buildSelectedSnapshot, type ExtractedField } from './demoData'
import ManualOverrideFields from './ManualOverrideFields'
import {
  classifiedRowsFromOcrTable,
  describeSkippedInpatientRows,
  selectInpatientFillRecords,
  snapshotToFallbackRecord,
} from './platformFields'
import { getManualOverrideError, rememberDepartment } from './templateMapping'

const fieldLabels: Record<string, string> = {
  patientName: '患者姓名', gender: '性别', age: '年龄', admissionDate: '入院日期',
  diagnosis: '诊断', diagnosisWestern: '西医诊断', hospitalNo: '住院号', remarks: '备注',
  chiefComplaint: '主诉', course: '病程描述', treatment: '处理意见',
}

const fieldsFromOcr = (result: OcrResult): ExtractedField[] => {
  const fields = Object.entries(result.fields || {})
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => ({ key, label: fieldLabels[key] || key, value: String(value), required: false }))
  const columns = result.table?.columns || []
  result.table?.rows?.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row : columns.map((column) => row[column] || '')
    values.forEach((value, columnIndex) => {
      const text = String(value ?? '').trim()
      if (!text) return
      const label = `${columns[columnIndex] || `第${columnIndex + 1}列`}（第${rowIndex + 1}行）`
      fields.push({ key: `table_${rowIndex}_${columnIndex}`, label, value: text, required: false })
    })
  })
  return fields
}

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export default function App() {
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [recognizedFields, setRecognizedFields] = useState<ExtractedField[]>([])
  const [mode, setMode] = useState<'预览' | '半自动' | '自动'>('半自动')
  const [page, setPage] = useState<'ocr' | 'automation'>('ocr')
  const [configOpen, setConfigOpen] = useState(false)
  const [uploadedName, setUploadedName] = useState('未选择文件')
  const [templateName, setTemplateName] = useState('使用默认导出工作簿')
  const [templateDataUrl, setTemplateDataUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [ocrModel, setOcrModel] = useState('Qwen/Qwen3-VL-8B-Instruct')
  const [ocrSettingsStatus, setOcrSettingsStatus] = useState('密钥仅保存在本机加密设置中')
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null)
  const [browserApiKey, setBrowserApiKey] = useState('')
  const [browserBaseUrl, setBrowserBaseUrl] = useState('https://api.aigo0.com')
  const [browserModel, setBrowserModel] = useState('gpt-5.5')
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [status, setStatus] = useState('等待上传图片')
  const [automationLogs, setAutomationLogs] = useState<Array<{ message: string; time: string }>>([])
  const [recordCategory, setRecordCategory] = useState('')
  const [department, setDepartment] = useState('')
  const [customDepartments, setCustomDepartments] = useState<string[]>([])
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  const [autoFillAfterOcr, setAutoFillAfterOcr] = useState(true)
  const [usePlatformFixture, setUsePlatformFixture] = useState(false)

  useEffect(() => {
    if (!window.desktopApi) return undefined
    window.desktopApi.loadOcrSettings().then((settings) => {
      setOcrModel(settings.model)
      setOcrSettingsStatus(settings.keyCount > 0 ? `已加载 ${settings.keyCount} 个本机密钥` : '尚未保存 OCR 密钥')
    }).catch(() => setOcrSettingsStatus('无法读取本机 OCR 设置'))
    return window.desktopApi.onAutomationLog((entry) => setAutomationLogs((current) => [...current.slice(-39), entry]))
  }, [])

  const fieldMap = useMemo(() => buildFieldMap(recognizedFields), [recognizedFields])
  const selectedSnapshot = useMemo(
    () => buildSelectedSnapshot(recognizedFields, selectedFields),
    [recognizedFields, selectedFields],
  )
  const inpatientFill = useMemo(() => {
    const category = recordCategory === '住院病种记录' ? '住院病种记录' : ''
    const classified = classifiedRowsFromOcrTable(ocrResult?.table, selectedIndexes, {
      sourceImage: uploadedName,
      department,
      category,
    })
    const skipped = describeSkippedInpatientRows(classified)
    let records = selectInpatientFillRecords(classified)
    if (!records.length) {
      const browserFieldNames: Record<string, string> = {
        patientName: 'PatientName',
        hospitalNo: 'HospitalNo',
        admissionDate: 'CreationTime',
        diagnosis: 'Diagnosis',
        diagnosisWestern: 'DiagnosisWestern',
        remarks: 'Remarks',
      }
      const browserFields = Object.fromEntries(
        selectedSnapshot
          .filter((field) => browserFieldNames[field.key])
          .map((field) => [browserFieldNames[field.key], field.value]),
      )
      if (department) browserFields.Department = department
      records = snapshotToFallbackRecord(browserFields)
    }
    return { records, skipped }
  }, [ocrResult, selectedIndexes, uploadedName, department, recordCategory, selectedSnapshot])

  const toggleField = (key: string) => {
    setSelectedFields((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const resetSelection = () => setSelectedFields(new Set(recognizedFields.map((field) => field.key)))

  /**
   * 记住手输过的新科室，供下次下拉使用。
   * @param value 当前输入
   * @return 无
   */
  const rememberTypedDepartment = (value: string) => {
    setDepartment(value)
    setCustomDepartments((current) => rememberDepartment(current, value))
  }

  /**
   * 识别和导出前都拦截未选择的记录类别、所在科室。
   * @return 人工覆盖值，未选完则返回空
   */
  const requireOverrides = () => {
    const error = getManualOverrideError({ 记录类别: recordCategory, 所在科室: department })
    if (error) {
      setStatus(error)
      return null
    }
    return { 记录类别: recordCategory.trim(), 所在科室: department.trim() }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setUploadedName(file ? file.name : '未选择文件')
    setStatus(file ? '图片已选择，点击“识别图片”' : '等待上传图片')
  }

  const handleTemplateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      setTemplateName('使用默认导出工作簿')
      setTemplateDataUrl('')
      return
    }
    try {
      setTemplateName(file.name)
      setTemplateDataUrl(await readFileAsDataUrl(file))
      setStatus(`已选择模板：${file.name}`)
    } catch (error) {
      setTemplateName('使用默认导出工作簿')
      setTemplateDataUrl('')
      setStatus(error instanceof Error ? error.message : '模板读取失败')
    }
  }

  const saveOcrSettings = async () => {
    if (!window.desktopApi) return setStatus('当前不是 Electron 环境，请使用 EXE 运行')
    if (!apiKey.trim()) return setStatus('请先填写至少一个硅基流动 API Key')
    try {
      const result = await window.desktopApi.saveOcrSettings({ apiKeys: apiKey, model: ocrModel })
      setOcrSettingsStatus(`已安全保存 ${result.keyCount} 个密钥`)
      setStatus('OCR 设置已持久化到本机')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'OCR 设置保存失败')
    }
  }

  const recordsFromOcr = (result: OcrResult, indexes: number[]) => {
    const category = recordCategory === '住院病种记录' ? '住院病种记录' : ''
    const classified = classifiedRowsFromOcrTable(result.table, indexes, {
      sourceImage: uploadedName,
      department,
      category,
    })
    const selected = selectInpatientFillRecords(classified)
    if (selected.length) return selected
    const browserFieldNames: Record<string, string> = {
      patientName: 'PatientName',
      hospitalNo: 'HospitalNo',
      admissionDate: 'CreationTime',
      diagnosis: 'Diagnosis',
      diagnosisWestern: 'DiagnosisWestern',
      remarks: 'Remarks',
    }
    const nextFields = fieldsFromOcr(result)
    const browserFields = Object.fromEntries(
      nextFields
        .filter((field) => browserFieldNames[field.key])
        .map((field) => [browserFieldNames[field.key], field.value]),
    )
    if (department) browserFields.Department = department
    return snapshotToFallbackRecord(browserFields)
  }

  const fillBrowser = async (records?: ReturnType<typeof selectInpatientFillRecords>) => {
    if (!window.desktopApi) return setStatus('当前不是 Electron 环境，请使用 EXE 运行')
    const nextRecords = Array.isArray(records) ? records : inpatientFill.records
    const login = {
      loginName: loginName || (usePlatformFixture ? 'fixture' : ''),
      loginPassword: loginPassword || (usePlatformFixture ? 'fixture' : ''),
    }
    if (!login.loginName || !login.loginPassword) return setStatus('请先填写平台账号和密码')
    if (!nextRecords.length) {
      const skipped = inpatientFill.skipped
      if (skipped.checkedCount === 0) return setStatus('请先在 OCR 页勾选要填入的行')
      if (skipped.inpatientCount === 0) return setStatus(`已勾选 ${skipped.checkedCount} 行，但没有住院病种记录可填入`)
      return setStatus(`已勾选 ${skipped.inpatientCount} 条住院病种，但有 ${skipped.skippedIncomplete} 条缺少姓名、住院号或诊断`)
    }
    setPage('automation')
    setStatus(`正在打开平台并填入 ${nextRecords.length} 条住院病种记录…`)
    try {
      const result = await window.desktopApi.fillBrowser({
        credentials: login,
        apiKey: browserApiKey || apiKey,
        baseUrl: browserBaseUrl,
        model: browserModel,
        records: nextRecords,
        submit: true,
        useFixture: usePlatformFixture,
        skipModel: usePlatformFixture,
      })
      setStatus(String(result))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '浏览器自动化失败')
    }
  }

  const recognizeImage = async () => {
    const input = document.querySelector<HTMLInputElement>('#case-file')
    const file = input?.files?.[0]
    if (!file) return setStatus('请先选择病例图片')
    if (!window.desktopApi) return setStatus('当前不是 Electron 环境，请使用 EXE 运行')
    setStatus('正在调用 OCR，请稍候…')
    const dataUrl = await readFileAsDataUrl(file)
    try {
      const result = await window.desktopApi.recognizeImage({ dataUrl, apiKey, model: ocrModel })
      const nextFields = fieldsFromOcr(result)
      const nextIndexes = (result.table?.rows || []).map((_, index) => index)
      setOcrResult(result)
      setRecognizedFields(nextFields)
      setSelectedFields(new Set(nextFields.map((field) => field.key)))
      setSelectedIndexes(nextIndexes)
      const fillRecords = recordsFromOcr(result, nextIndexes)
      if (autoFillAfterOcr && fillRecords.length) {
        setStatus(`OCR 完成，已识别可填入住院病种 ${fillRecords.length} 条，正在打开平台自动填写并提交`)
        await fillBrowser(fillRecords)
        return
      }
      setStatus(result.table?.rows?.length
        ? `OCR 完成，已识别 ${result.table.rows.length} 行${fillRecords.length ? `，其中 ${fillRecords.length} 条可自动填入平台` : '，请核对后手动填入'}`
        : (nextFields.length ? `OCR 完成，已识别 ${nextFields.length} 个字段，请核对并选择` : 'OCR 完成，但没有识别到可用字段'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'OCR 失败')
    }
  }

  const exportOcrExcel = async () => {
    if (!window.desktopApi) return setStatus('当前不是 Electron 环境，请使用 EXE 运行')
    if (!ocrResult) return setStatus('请先完成图片 OCR')
    if (!selectedIndexes.length) return setStatus('请先勾选要写入 Excel 的行')
    const overrides = requireOverrides()
    if (!overrides) return
    try {
      const result = await window.desktopApi.exportOcrExcel({
        ocrResult,
        fileName: uploadedName.replace(/\.[^.]+$/, '') || 'OCR识别结果',
        templateDataUrl: templateDataUrl || undefined,
        overrides,
        selectedIndexes,
      })
      if (!result.canceled) {
        const matched = result.matchedColumns?.length || 0
        const ignored = result.ignoredColumns?.length || 0
        setStatus(`Excel 已导出：${result.outputPath}；新增 ${result.rowCount || 0} 行，匹配 ${matched} 列，忽略 ${ignored} 列`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Excel 导出失败')
    }
  }

  const clearBrowserTemplate = async () => {
    if (!window.desktopApi) return setStatus('当前不是 Electron 环境，请使用 EXE 运行')
    setStatus(await window.desktopApi.clearBrowserTemplate())
  }

  const fieldCount = selectedSnapshot.length
  const requiredCount = selectedSnapshot.filter((field) => field.required).length

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="brand-block">
          <div className="brand-mark">病</div>
          <div>
            <p className="eyebrow">病例数据工作台</p>
            <h1>病例自动传</h1>
            <p className="hero-copy">识别病例图片，核对关键字段并同步至业务平台</p>
          </div>
        </div>
        <div className="workflow-strip" aria-label="处理流程">
          <span className="active"><b>1</b> 上传图片</span>
          <i>→</i>
          <span><b>2</b> OCR 识别</span>
          <i>→</i>
          <span><b>3</b> 核对字段</span>
          <i>→</i>
          <span><b>4</b> 导出 / 填入</span>
        </div>
        <div className="hero-status">
          <span className="status-dot" />
          <div><small>当前模式</small><strong>{mode}</strong></div>
        </div>
        <button type="button" className="config-trigger" onClick={() => setConfigOpen(true)}>配置</button>
      </header>

      <nav className="page-nav" aria-label="功能页面">
        <button type="button" className={page === 'ocr' ? 'active' : ''} onClick={() => setPage('ocr')}>OCR识别与模板</button>
        <button type="button" className={page === 'automation' ? 'active' : ''} onClick={() => setPage('automation')}>平台自动化</button>
      </nav>

      {page === 'ocr' ? <main className="ocr-page">
        <section className="panel ocr-main-panel">
          <div className="panel-header"><div><h2>图片识别并写入 Excel 模板</h2><p className="section-subtitle">模板表头和已有数据保持不变，仅追加图片中能明确对应的非空字段</p></div><span className="badge">独立功能</span></div>
          <label className="upload-card">
            <input id="case-file" type="file" accept="image/*" onChange={handleFileChange} />
            <span className="upload-icon">＋</span><strong>选择病例图片</strong><small>{uploadedName}</small>
          </label>
          <label className="upload-card template-upload-card">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleTemplateChange} />
            <span className="upload-icon">表</span><strong>选择已有 Excel 模板</strong><small>{templateName}</small>
          </label>
          <p className="template-hint">模板第 1 行表头固定，原有数据行保留；图片中没有对应内容的列保持空白，未选择时使用默认工作簿。</p>
          <ManualOverrideFields
            recordCategory={recordCategory}
            department={department}
            customDepartments={customDepartments}
            onRecordCategoryChange={setRecordCategory}
            onDepartmentChange={rememberTypedDepartment}
          />
          <div className="action-row">
            <button type="button" className="primary-btn" onClick={recognizeImage}>识别图片</button>
            <button type="button" onClick={exportOcrExcel} disabled={!ocrResult}>导出模板 Excel</button>
            <button type="button" className="automation-btn" onClick={() => fillBrowser()}>登录平台并自动填入</button>
          </div>
          <div className="auto-fill-options">
            <label><input type="checkbox" checked={autoFillAfterOcr} onChange={(event) => setAutoFillAfterOcr(event.target.checked)} />识别完成后自动打开平台填写并提交</label>
            <label><input type="checkbox" checked={usePlatformFixture} onChange={(event) => setUsePlatformFixture(event.target.checked)} />使用本地平台夹具测试（不连正式网站）</label>
          </div>
          <p className="status-text">{status}</p>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>识别结果核对</h2><span className="badge">{ocrResult?.table?.rows?.length || recognizedFields.length} 行</span></div>
          <div className="field-toolbar">
            <button type="button" onClick={() => setSelectedIndexes((ocrResult?.table?.rows || []).map((_, index) => index))}>全选行</button>
            <button type="button" onClick={() => setSelectedIndexes([])}>清空勾选</button>
            <button type="button" onClick={resetSelection}>恢复默认字段</button>
            <button type="button" onClick={() => setSelectedFields(new Set())}>清空字段</button>
          </div>
          {ocrResult?.table?.rows?.length ? <div className="ocr-table-preview"><div className="table-preview-header"><strong>勾选要写入的行</strong><span>已选 {selectedIndexes.length} / {ocrResult.table.rows.length} 行</span></div><div className="table-scroll"><table><thead><tr><th>写入</th>{ocrResult.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{ocrResult.table.rows.map((row, rowIndex) => { const values = Array.isArray(row) ? row : ocrResult.table?.columns.map((column) => row[column] || '') || []; return <tr key={rowIndex} className={selectedIndexes.includes(rowIndex) ? 'row-checked' : ''}><td><input type="checkbox" checked={selectedIndexes.includes(rowIndex)} onChange={() => setSelectedIndexes((current) => current.includes(rowIndex) ? current.filter((item) => item !== rowIndex) : [...current, rowIndex].sort((left, right) => left - right))} /></td>{values.map((value, columnIndex) => <td key={`${rowIndex}-${columnIndex}`}>{String(value ?? '')}</td>)}</tr> })}</tbody></table></div></div> : <div className="field-grid">{recognizedFields.length === 0 ? <div className="field-empty"><strong>等待识别字段</strong><span>选择图片后点击“识别图片”</span></div> : recognizedFields.map((field) => <label key={field.key} className={selectedFields.has(field.key) ? 'field-card checked' : 'field-card'}><div><input checked={selectedFields.has(field.key)} onChange={() => toggleField(field.key)} type="checkbox" /><strong>{field.label}</strong></div><input value={fieldMap[field.key].value} onChange={(event) => setRecognizedFields((current) => current.map((item) => item.key === field.key ? { ...item, value: event.target.value } : item))} placeholder="识别结果" /></label>)}</div>}
          {ocrResult?.rawText ? <details className="raw-text-preview"><summary>查看 OCR 完整文字</summary><pre>{ocrResult.rawText}</pre></details> : null}
        </section>
      </main> : <main className="grid-layout">

        <section className="panel">
          <div className="panel-header">
            <h2>1. 输入与模板</h2>
            <span className="badge">上传 / 模板</span>
          </div>

          <label className="upload-card">
            <input id="case-file" type="file" accept="image/*" onChange={handleFileChange} />
            <span className="upload-icon">＋</span>
            <strong>选择病例图片</strong>
            <small>{uploadedName}</small>
          </label>

          <ManualOverrideFields
            recordCategory={recordCategory}
            department={department}
            customDepartments={customDepartments}
            onRecordCategoryChange={setRecordCategory}
            onDepartmentChange={rememberTypedDepartment}
          />

          <div className="mode-row">
            {(['预览', '半自动', '自动'] as const).map((item) => (
              <button
                key={item}
                className={item === mode ? 'mode-btn active' : 'mode-btn'}
                onClick={() => setMode(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>

          <div className="input-help">
            <strong>使用流程</strong>
            <p>首次选择病例图片并运行 OCR，识别结果会自动生成中间的字段列表。核对后勾选需要同步至平台的字段。</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>2. 字段抽取与勾选</h2>
            <span className="badge">可自定义</span>
          </div>

          <div className="stats-row">
            <div>
              <strong>{fieldCount}</strong>
              <span>已选字段</span>
            </div>
            <div>
              <strong>{requiredCount}</strong>
              <span>必填字段</span>
            </div>
            <div>
              <strong>{recognizedFields.length}</strong>
              <span>候选字段</span>
            </div>
          </div>

          <div className="field-toolbar">
            <button type="button" onClick={resetSelection}>
              恢复默认选择
            </button>
            <button type="button" onClick={() => setSelectedFields(new Set())}>
              清空选择
            </button>
          </div>

          <div className="field-grid">
            {recognizedFields.length === 0 ? (
              <div className="field-empty"><strong>等待识别字段</strong><span>选择病例图片并点击右侧“识别图片”</span></div>
            ) : null}
            {recognizedFields.map((field) => {
              const checked = selectedFields.has(field.key)
              return (
                <label key={field.key} className={checked ? 'field-card checked' : 'field-card'}>
                  <div>
                    <input
                      checked={checked}
                      onChange={() => toggleField(field.key)}
                      type="checkbox"
                    />
                    <strong>{field.label}</strong>
                    {field.required ? <span className="required-pill">必填</span> : null}
                  </div>
                  <input
                    value={fieldMap[field.key].value}
                    onChange={(event) => setRecognizedFields((current) => current.map((item) => (
                      item.key === field.key ? { ...item, value: event.target.value } : item
                    )))}
                    placeholder="识别结果"
                  />
                </label>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>3. 执行与日志</h2>
            <span className="badge">实时状态</span>
          </div>

          <div className="action-row">
            <button type="button" className="primary-btn" onClick={recognizeImage}>
              识别图片
            </button>
            <button type="button" onClick={exportOcrExcel} disabled={!ocrResult}>
              导出 Excel
            </button>
            <button type="button" className="automation-btn" onClick={() => fillBrowser()}>登录平台并自动填入</button>
          </div>
          <p className="status-text">OCR 已勾选 {selectedIndexes.length} 行，可填入住院病种 {inpatientFill.records.length} 条。识别完成后会自动打开平台填写并提交。</p>
          <p className="status-text">{status}</p>
          <div className="log-panel">
            <div className="log-header">
              <strong>自动化日志</strong>
              <div>
                <button type="button" onClick={clearBrowserTemplate}>清除模板</button>
                <button type="button" onClick={() => setAutomationLogs([])}>清空日志</button>
              </div>
            </div>
            <div className="log-list">
              {automationLogs.length === 0 ? <span className="log-empty">点击“登录平台并自动填入”后显示过程</span> : automationLogs.map((entry, index) => (
                <div className="log-entry" key={`${entry.time}-${index}`}>
                  <time>{entry.time}</time>
                  <span>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>}

      {configOpen ? <div className="config-overlay" onMouseDown={() => setConfigOpen(false)}>
        <aside className="config-drawer" onMouseDown={(event) => event.stopPropagation()}>
          <div className="drawer-header"><div><small>应用设置</small><h2>连接与账号配置</h2></div><button type="button" onClick={() => setConfigOpen(false)} aria-label="关闭">×</button></div>
          <div className="drawer-section"><h3>OCR 识别服务</h3>
            <label className="config-field"><span>硅基流动 API Key</span><textarea value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="支持多个，换行或 | 分隔" rows={3} /></label>
            <label className="config-field"><span>视觉 OCR 模型</span><input value={ocrModel} onChange={(event) => setOcrModel(event.target.value)} /></label>
            <div className="ocr-settings-row"><button type="button" onClick={saveOcrSettings}>安全保存 OCR 设置</button><span>{ocrSettingsStatus}</span></div>
          </div>
          <div className="drawer-section"><h3>浏览器智能体</h3>
            <label className="config-field"><span>API Key</span><input type="password" value={browserApiKey} onChange={(event) => setBrowserApiKey(event.target.value)} /></label>
            <label className="config-field"><span>接口地址</span><input value={browserBaseUrl} onChange={(event) => setBrowserBaseUrl(event.target.value)} /></label>
            <label className="config-field"><span>模型</span><input value={browserModel} onChange={(event) => setBrowserModel(event.target.value)} /></label>
          </div>
          <div className="drawer-section"><h3>平台登录信息</h3><p>账号和密码仅在本次运行中使用。勾选本地夹具时可用任意账号走测试页。</p>
            <label className="config-field"><span>平台账号</span><input value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" /></label>
            <label className="config-field"><span>平台密码</span><input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" /></label>
            <label className="config-check"><input type="checkbox" checked={autoFillAfterOcr} onChange={(event) => setAutoFillAfterOcr(event.target.checked)} />识别完成后自动打开平台填写并提交</label>
            <label className="config-check"><input type="checkbox" checked={usePlatformFixture} onChange={(event) => setUsePlatformFixture(event.target.checked)} />使用本地平台夹具测试</label>
          </div>
          <button type="button" className="drawer-done" onClick={() => setConfigOpen(false)}>完成</button>
        </aside>
      </div> : null}
    </div>
  )
}
