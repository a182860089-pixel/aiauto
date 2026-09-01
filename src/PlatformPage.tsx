import { useEffect, useMemo, useState } from 'react'
import { parseClassifiedRowsFromExcel } from './ocrExcel'
import {
  preparePlatformPreviewRows,
  selectPlatformFillRecords,
  forceRowsAsInpatient,
} from './platformFields'
import type { ClassifiedPatientRow } from './smartClassifier'
import {
  loadStoredPlatformDepartments,
  saveStoredPlatformDepartments,
  mergeDepartmentOptions,
  matchDepartment,
} from './departments'

function createPlatformDemoRows(): ClassifiedPatientRow[] {
  var department = '脑病科一区'
  return [
    {
      id: 'demo-1',
      category: '住院病种记录',
      department,
      patientName: '杨旭',
      recordNo: '376813',
      hospitalNo: '376813',
      outpatientNo: '',
      medicalRecordNo: '',
      tcmDiag: '颈椎病:风寒湿痹阻证',
      wmDiag: '颈椎病',
      operationName: '',
      visitType: '主管',
      date: '2026-07-24',
      admissionDate: '2026-07-24',
      visitDate: '',
      operationDate: '',
      generalDate: '2026-07-24',
      sourceImage: 'his_inpatient_list.png',
      confidence: 'high',
      inferredReason: '示例：住院病种可填',
      checked: true,
      remarks: '',
      imageFile: 'his_inpatient_list.png',
      rawSourceRow: {},
    },
    {
      id: 'demo-2',
      category: '住院病种记录',
      department,
      patientName: '赵敏',
      recordNo: '381204',
      hospitalNo: '381204',
      outpatientNo: '',
      medicalRecordNo: '',
      tcmDiag: '肺胀:痰热壅肺',
      wmDiag: '慢性阻塞性肺疾病急性加重',
      operationName: '',
      visitType: '主管',
      date: '2026-08-03',
      admissionDate: '2026-08-03',
      visitDate: '',
      operationDate: '',
      generalDate: '2026-08-03',
      sourceImage: 'his_inpatient_list.png',
      confidence: 'high',
      inferredReason: '示例：住院病种可填',
      checked: true,
      remarks: '',
      imageFile: 'his_inpatient_list.png',
      rawSourceRow: {},
    },
    {
      id: 'demo-3',
      category: '门诊病种记录',
      department,
      patientName: '王建国',
      recordNo: 'MZ-882103',
      hospitalNo: '',
      outpatientNo: 'MZ-882103',
      medicalRecordNo: 'MZ-882103',
      tcmDiag: '眩晕:肝阳上亢证',
      wmDiag: '原发性高血压',
      operationName: '',
      visitType: '初诊',
      date: '2026-08-02',
      admissionDate: '',
      visitDate: '2026-08-02',
      operationDate: '',
      generalDate: '2026-08-02',
      sourceImage: 'clinic_record_01.png',
      confidence: 'high',
      inferredReason: '示例：门诊记录也可填入',
      checked: true,
      remarks: '',
      imageFile: 'clinic_record_01.png',
      rawSourceRow: {},
    },
    {
      id: 'demo-4',
      category: '住院病种记录',
      department,
      patientName: '李四',
      recordNo: '123',
      hospitalNo: '123',
      outpatientNo: '',
      medicalRecordNo: '',
      tcmDiag: '',
      wmDiag: '',
      operationName: '',
      visitType: '主管',
      date: '2026-08-12',
      admissionDate: '2026-08-12',
      visitDate: '',
      operationDate: '',
      generalDate: '2026-08-12',
      sourceImage: 'his_inpatient_list.png',
      confidence: 'low',
      inferredReason: '示例：缺诊断也可填入',
      checked: true,
      remarks: '',
      imageFile: 'his_inpatient_list.png',
      rawSourceRow: {},
    },
  ]
}

var STORAGE_LOGIN = 'platform-login-name'
var STORAGE_PASSWORD = 'platform-login-password'
var STORAGE_FIXTURE = 'platform-use-fixture'
var STORAGE_AGENT_KEY = 'platform-browser-api-key'
var STORAGE_AGENT_URL = 'platform-browser-base-url'
var STORAGE_AGENT_MODEL = 'platform-browser-model'

function loadSessionPassword() {
  try { return sessionStorage.getItem(STORAGE_PASSWORD) || '' } catch { return '' }
}

function saveSessionPassword(value: string) {
  try { sessionStorage.setItem(STORAGE_PASSWORD, value) } catch {}
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    var reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type PlatformPageProps = {
  ocrRows: ClassifiedPatientRow[]
}

export default function PlatformPage({ ocrRows }: PlatformPageProps) {
  var [loginName, setLoginName] = useState(() => localStorage.getItem(STORAGE_LOGIN) || '')
  var [loginPassword, setLoginPassword] = useState(() => loadSessionPassword())
  var [usePlatformFixture, setUsePlatformFixture] = useState(() => localStorage.getItem(STORAGE_FIXTURE) === '1')
  var [browserApiKey, setBrowserApiKey] = useState(() => localStorage.getItem(STORAGE_AGENT_KEY) || '')
  var [browserBaseUrl, setBrowserBaseUrl] = useState(() => localStorage.getItem(STORAGE_AGENT_URL) || 'https://api.aigo0.com')
  var [browserModel, setBrowserModel] = useState(() => localStorage.getItem(STORAGE_AGENT_MODEL) || 'gpt-5.5')
  var [autoSubmit, setAutoSubmit] = useState(true)
  var [fillScope, setFillScope] = useState<'inpatient' | 'excel'>('excel')
  var [dataSource, setDataSource] = useState<'ocr' | 'excel'>('ocr')
  var [excelName, setExcelName] = useState('')
  var [excelRows, setExcelRows] = useState<ClassifiedPatientRow[]>([])
  var [workingRows, setWorkingRows] = useState<ClassifiedPatientRow[]>(() => preparePlatformPreviewRows(createPlatformDemoRows()))
  var [previewTab, setPreviewTab] = useState<'全部' | '将填入'>('全部')
  var [busy, setBusy] = useState(false)
  var [status, setStatus] = useState('已载入示例预览，可改选 Excel 或使用识别页结果')
  var [automationLogs, setAutomationLogs] = useState<Array<{ message: string; time: string }>>([])
  var [agentOpen, setAgentOpen] = useState(false)
  var [platformDepartments, setPlatformDepartments] = useState<string[]>(() => loadStoredPlatformDepartments())
  var departmentOptions = useMemo(
    () => mergeDepartmentOptions([], platformDepartments),
    [platformDepartments],
  )

  var applyPlatformDepartments = (departments: string[]) => {
    var next = saveStoredPlatformDepartments(departments)
    setPlatformDepartments(next)
    if (!next.length) return next
    setWorkingRows((current) => current.map((row) => {
      var matched = matchDepartment(row.department, next)
      return matched && matched !== row.department ? { ...row, department: matched } : row
    }))
    return next
  }

  useEffect(() => {
    if (!window.desktopApi) return undefined
    var offLog = window.desktopApi.onAutomationLog((entry) => {
      setAutomationLogs((current) => [...current.slice(-39), entry])
    })
    var offDepts = window.desktopApi.onPlatformDepartments?.((payload) => {
      var next = applyPlatformDepartments(payload.departments || [])
      setStatus(`已同步平台科室 ${next.length} 个，可在下拉中选择`)
    })
    return () => {
      offLog?.()
      offDepts?.()
    }
  }, [])

  useEffect(() => {
    if (dataSource !== 'ocr') return
    if (!ocrRows.length) return
    setWorkingRows(preparePlatformPreviewRows(ocrRows))
    setStatus(`已使用当前识别结果，共 ${ocrRows.length} 行`)
  }, [dataSource, ocrRows])

  var fillableRows = workingRows
  var visibleRows = previewTab === '将填入' ? workingRows.filter((row) => row.checked) : workingRows
  var selectedFillable = selectPlatformFillRecords(workingRows, { forceInpatient: fillScope === 'inpatient' })
  var fillCategorySummary = useMemo(() => {
    var counts: Record<string, number> = {}
    selectedFillable.forEach((record) => {
      var category = record.category || '未分类'
      counts[category] = (counts[category] || 0) + 1
    })
    return Object.entries(counts).map(([category, count]) => `${category} ${count} 条`).join('、')
  }, [selectedFillable])

  var saveLogin = () => {
    localStorage.setItem(STORAGE_LOGIN, loginName)
    saveSessionPassword(loginPassword)
    localStorage.setItem(STORAGE_FIXTURE, usePlatformFixture ? '1' : '0')
    localStorage.setItem(STORAGE_AGENT_KEY, browserApiKey)
    localStorage.setItem(STORAGE_AGENT_URL, browserBaseUrl)
    localStorage.setItem(STORAGE_AGENT_MODEL, browserModel)
    setStatus('已保存账号、夹具开关和智能体配置（密码仅保存在本次会话）')
  }

  var handleExcelChange = async (files: FileList | null) => {
    var file = files?.[0]
    if (!file) return
    setBusy(true)
    setStatus(`正在读取 ${file.name}…`)
    try {
      var dataUrl = await readFileAsDataUrl(file)
      var rows = preparePlatformPreviewRows(await parseClassifiedRowsFromExcel(dataUrl, file.name))
      setExcelName(file.name)
      setExcelRows(rows)
      setDataSource('excel')
      setWorkingRows(rows)
      setPreviewTab('全部')
      setStatus(`已载入 ${file.name}：共 ${rows.length} 行`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Excel 读取失败')
    } finally {
      setBusy(false)
    }
  }

  var switchSource = (next: 'ocr' | 'excel') => {
    setDataSource(next)
    setPreviewTab('全部')
    if (next === 'ocr') {
      setWorkingRows(preparePlatformPreviewRows(ocrRows))
      setStatus(ocrRows.length ? `已切换为当前识别结果，共 ${ocrRows.length} 行` : '识别页还没有记录，请先识别或改选 Excel')
      return
    }
    setWorkingRows(preparePlatformPreviewRows(excelRows))
    setStatus(excelName ? `已切换为 ${excelName}` : '请选择已导出的 Excel 文件')
  }

  var toggleRow = (id: string, checked: boolean) => {
    setWorkingRows((current) => current.map((row) => (row.id === id ? { ...row, checked } : row)))
  }

  var toggleVisible = (checked: boolean) => {
    var ids = new Set(visibleRows.map((row) => row.id))
    setWorkingRows((current) => current.map((row) => (ids.has(row.id) ? { ...row, checked } : row)))
  }

  var changeRowCategory = (row: ClassifiedPatientRow, category: ClassifiedPatientRow['category']) => {
    setWorkingRows((current) => current.map((currentRow) => (
      currentRow.id === row.id ? { ...currentRow, category, isManualModified: true } : currentRow
    )))
  }

  var changeRowDepartment = (row: ClassifiedPatientRow, department: string) => {
    setWorkingRows((current) => current.map((currentRow) => (
      currentRow.id === row.id ? { ...currentRow, department } : currentRow
    )))
  }

  var enableInpatientFill = () => {
    if (!workingRows.length) return setStatus('请先使用当前识别结果，或选择已导出的 Excel')
    var nextRows = forceRowsAsInpatient(workingRows)
    setWorkingRows(nextRows)
    setPreviewTab('全部')
    setStatus(`已按住院病种重新校正 ${nextRows.length} 行，全部可填入；请核对后点击“登录平台并开始填入”`)
  }

  var syncPlatformDepartments = async () => {
    if (!window.desktopApi?.syncPlatformDepartments) return setStatus('当前不是桌面端，请使用 EXE 运行')
    var login = {
      loginName: loginName || (usePlatformFixture ? 'fixture' : ''),
      loginPassword: loginPassword || (usePlatformFixture ? 'fixture' : ''),
    }
    if (!login.loginName || !login.loginPassword) return setStatus('请先填写平台账号和密码，再同步科室')
    setBusy(true)
    setStatus('正在登录平台并读取「所在科室」下拉…')
    try {
      var result = await window.desktopApi.syncPlatformDepartments({
        credentials: login,
        useFixture: usePlatformFixture,
      })
      var next = applyPlatformDepartments(result.departments || [])
      setStatus(result.message || `已同步平台科室 ${next.length} 个`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同步科室失败')
    } finally {
      setBusy(false)
    }
  }

  var fillBrowser = async () => {
    if (!window.desktopApi) return setStatus('当前不是桌面端，请使用 EXE 运行')
    var login = {
      loginName: loginName || (usePlatformFixture ? 'fixture' : ''),
      loginPassword: loginPassword || (usePlatformFixture ? 'fixture' : ''),
    }
    if (!login.loginName || !login.loginPassword) return setStatus('请先填写平台账号和密码')
    if (!selectedFillable.length) {
      if (!workingRows.length) return setStatus('请先使用当前识别结果，或选择已导出的 Excel')
      return setStatus('请先勾选要填入的行')
    }
    setBusy(true)
    setStatus(`正在打开平台并填入 ${selectedFillable.length} 条：${fillCategorySummary || '未勾选'}…`)
    try {
      var result = await window.desktopApi.fillBrowser({
        credentials: login,
        apiKey: browserApiKey,
        baseUrl: browserBaseUrl,
        model: browserModel,
        records: selectedFillable,
        submit: autoSubmit,
        useFixture: usePlatformFixture,
        skipModel: usePlatformFixture,
      })
      setStatus(String(result))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '浏览器自动化失败')
    } finally {
      setBusy(false)
    }
  }

  var clearTemplate = async () => {
    if (!window.desktopApi) return
    setStatus(await window.desktopApi.clearBrowserTemplate())
  }

  return (
    <main className="ocr-main-layout platform-page">
      <section className="left-panel">
        <div className="card">
          <div className="card-header">
            <h3>平台账号</h3>
            <span className="card-sub">{usePlatformFixture ? '夹具模式' : '正式平台'}</span>
          </div>
          <label className="field-block">
            <span className="field-label">账号</span>
            <input
              value={loginName}
              onChange={(event) => {
                setLoginName(event.target.value)
                localStorage.setItem(STORAGE_LOGIN, event.target.value)
              }}
              placeholder={usePlatformFixture ? '夹具可用 fixture' : '平台账号'}
              autoComplete="username"
            />
          </label>
          <label className="field-block">
            <span className="field-label">密码</span>
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.target.value)
                saveSessionPassword(event.target.value)
              }}
              placeholder={usePlatformFixture ? '夹具可用 fixture' : '平台密码'}
              autoComplete="current-password"
            />
          </label>
          <label className="auto-fill-check">
            <input
              type="checkbox"
              checked={usePlatformFixture}
              onChange={(event) => setUsePlatformFixture(event.target.checked)}
            />
            使用本地夹具测试（不连正式网站）
          </label>
          <button type="button" className="secondary-btn" onClick={saveLogin}>
            保存登录信息到本机
          </button>
          <button type="button" className="toggle-link-btn" onClick={() => setAgentOpen(!agentOpen)}>
            {agentOpen ? '收起智能体配置' : '展开智能体配置'}
          </button>
          {agentOpen ? (
            <div className="settings-body">
              <label className="field-block">
                <span className="field-label">浏览器智能体 API Key</span>
                <input value={browserApiKey} onChange={(event) => setBrowserApiKey(event.target.value)} placeholder="夹具测试可不填" />
              </label>
              <label className="field-block">
                <span className="field-label">智能体接口</span>
                <input value={browserBaseUrl} onChange={(event) => setBrowserBaseUrl(event.target.value)} />
              </label>
              <label className="field-block">
                <span className="field-label">智能体模型</span>
                <input value={browserModel} onChange={(event) => setBrowserModel(event.target.value)} />
              </label>
              <button type="button" className="secondary-btn" onClick={clearTemplate}>
                清除浏览器模板
              </button>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-header">
            <h3>填入范围</h3>
            <span className="card-sub">按类别进入对应菜单并填科室</span>
          </div>
          <label className={`scope-option ${fillScope === 'excel' ? 'active' : ''}`}>
            <input type="radio" name="fill-scope" checked={fillScope === 'excel'} onChange={() => setFillScope('excel')} />
            <span>
              <strong>按表格中的记录类别</strong>
              <small>表格是门诊就进门诊菜单，是住院就进住院菜单，按行填科室</small>
            </span>
          </label>
          <label className={`scope-option ${fillScope === 'inpatient' ? 'active' : ''}`}>
            <input type="radio" name="fill-scope" checked={fillScope === 'inpatient'} onChange={() => setFillScope('inpatient')} />
            <span>
              <strong>全部改成住院病种</strong>
              <small>忽略表格类别，勾选行都进住院病种菜单</small>
            </span>
          </label>
          <button type="button" className="secondary-btn" onClick={syncPlatformDepartments} disabled={busy} style={{ marginTop: 12 }}>
            {busy ? '正在同步科室…' : `从平台同步全部科室（当前 ${departmentOptions.length}）`}
          </button>
        </div>

        <div className="card launch-card">
          <div className="card-header">
            <h3>执行</h3>
            <span className="card-sub">打开平台并逐条填入</span>
          </div>
          <button type="button" className="platform-fill-btn" onClick={fillBrowser} disabled={busy}>
            {busy ? '正在执行…' : (fillCategorySummary ? `登录平台并填入（${fillCategorySummary}）` : '登录平台并开始填入')}
          </button>
          <label className="auto-fill-check">
            <input type="checkbox" checked={autoSubmit} onChange={(event) => setAutoSubmit(event.target.checked)} />
            填完后自动点确定
          </label>
          <div className="status-banner">{status}</div>
          {automationLogs.length > 0 ? (
            <div className="automation-log-list">
              {automationLogs.slice(-10).map((entry, index) => (
                <p key={`${entry.time}-${index}`}>
                  <span>{entry.time}</span>
                  {entry.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="right-panel">
        <div className="card table-container-card">
          <div className="category-tabs-bar">
            <div className="source-switch">
              <label className={dataSource === 'ocr' ? 'source-option active' : 'source-option'}>
                <input type="radio" checked={dataSource === 'ocr'} onChange={() => switchSource('ocr')} />
                当前识别结果
              </label>
              <label className={dataSource === 'excel' ? 'source-option active' : 'source-option'}>
                <input type="radio" checked={dataSource === 'excel'} onChange={() => switchSource('excel')} />
                选择 Excel
              </label>
              <label className="template-btn-label">
                <input type="file" accept=".xlsx" onChange={(event) => handleExcelChange(event.target.files)} style={{ display: 'none' }} />
                <span className="secondary-btn">选择已导出的 Excel</span>
              </label>
            </div>
            <div className="card-sub">
              {dataSource === 'excel' && excelName ? excelName : dataSource === 'ocr' ? '来自识别工作台或示例预览' : '未选择文件'}
              {' · '}共 {workingRows.length} 行 · 可填 {fillableRows.length}
              {' · '}
              {fillScope === 'inpatient' ? '将忽略表格类别，全部按住院病种填入' : '按表格记录类别分别进入对应菜单'}
            </div>
          </div>

          <div className="batch-toolbar">
            <div className="tabs-group">
              <button type="button" className={`tab-btn ${previewTab === '全部' ? 'active' : ''}`} onClick={() => setPreviewTab('全部')}>
                全部 ({workingRows.length})
              </button>
              <button type="button" className={`tab-btn ${previewTab === '将填入' ? 'active' : ''}`} onClick={() => setPreviewTab('将填入')}>
                将填入 ({selectedFillable.length})
              </button>
            </div>
            <div className="batch-selection-info">
              <button type="button" className="mini-btn" onClick={() => toggleVisible(true)}>全选</button>
              <button type="button" className="mini-btn" onClick={() => toggleVisible(false)}>全不选</button>
              <button type="button" className="mini-btn primary" onClick={enableInpatientFill}>
                按住院病种启用填入
              </button>
              <span className="selection-count-text">
                已勾选可填 <strong>{selectedFillable.length}</strong> / {fillableRows.length}
              </span>
            </div>
          </div>

          <div className="table-responsive-wrapper">
            {visibleRows.length === 0 ? (
              <div className="empty-state">
                <p>请先在识别页导出 Excel，或勾选「当前识别结果」。</p>
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={() => {
                    var rows = preparePlatformPreviewRows(createPlatformDemoRows())
                    setDataSource('ocr')
                    setWorkingRows(rows)
                    setPreviewTab('全部')
                    setStatus('已载入示例预览')
                  }}
                >
                  载入示例预览
                </button>
              </div>
            ) : (
              <table className="classified-data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>选</th>
                    <th style={{ width: '115px' }}>记录类别</th>
                    <th style={{ width: '90px' }}>姓名</th>
                    <th style={{ width: '95px' }}>住院号</th>
                    <th>中医诊断</th>
                    <th>西医诊断</th>
                    <th style={{ width: '140px' }}>所在科室</th>
                    <th style={{ width: '100px' }}>日期</th>
                    <th style={{ width: '110px' }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                      <tr key={row.id} className={row.checked ? 'row-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(event) => toggleRow(row.id, event.target.checked)}
                          />
                        </td>
                        <td>
                          <select
                            className="cell-select"
                            value={row.category}
                            onChange={(event) => changeRowCategory(row, event.target.value as ClassifiedPatientRow['category'])}
                          >
                            <option value="住院病种记录">住院病种记录</option>
                            <option value="门诊病种记录">门诊病种记录</option>
                            <option value="临床技术记录">临床技术记录</option>
                            <option value="手写大病历">手写大病历</option>
                            <option value="门诊病历">门诊病历</option>
                          </select>
                        </td>
                        <td>{row.patientName}</td>
                        <td>{row.hospitalNo}</td>
                        <td>{row.tcmDiag}</td>
                        <td>{row.wmDiag}</td>
                        <td>
                          <select
                            className="cell-select"
                            value={row.department}
                            onChange={(event) => changeRowDepartment(row, event.target.value)}
                          >
                            <option value="">请选择科室</option>
                            {row.department && !departmentOptions.includes(row.department) ? (
                              <option value={row.department}>{row.department}</option>
                            ) : null}
                            {departmentOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{row.admissionDate || row.date}</td>
                        <td>
                          <span className="status-pill success">可填</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
