import { useEffect, useMemo, useState } from 'react'
import {
  ALL_CATEGORIES,
  summarizeCategories,
  type ClassifiedPatientRow,
  type PatientCategory,
} from './smartClassifier'
import {
  DEFAULT_OCR_MODEL,
  normalizeApiKeys,
  processBatchImages,
  type UploadedImageItem,
} from './ocrBrowser'
import { exportClassifiedRowsToExcel } from './ocrExcel'
import { describeSkippedInpatientRows, selectInpatientFillRecords } from './platformFields'
import { mergeDepartmentOptions, rememberDepartment } from './templateMapping'

var STORAGE_KEY = 'ocr-web-api-key'
var STORAGE_MODEL = 'ocr-web-model'
var STORAGE_DEPT = 'ocr-web-default-dept'

/** 读取本地文件为 Data URL */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    var reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type OcrWebAppProps = {
  embedded?: boolean
  onRowsChange?: (rows: ClassifiedPatientRow[]) => void
  onGoToPlatform?: () => void
}

export default function OcrWebApp({ embedded, onRowsChange, onGoToPlatform }: OcrWebAppProps = {}) {
  // 基础配置与持久化
  var [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '')
  var [ocrModel, setOcrModel] = useState(() => localStorage.getItem(STORAGE_MODEL) || DEFAULT_OCR_MODEL)
  var [defaultDept, setDefaultDept] = useState(() => localStorage.getItem(STORAGE_DEPT) || '通州呼吸科二区')
  var [customDepartments, setCustomDepartments] = useState<string[]>([])
  var [templateName, setTemplateName] = useState('使用标准 16 列五类合并格式')
  var [templateDataUrl, setTemplateDataUrl] = useState('')
  var [desktopKeyCount, setDesktopKeyCount] = useState(0)
  var [loginName, setLoginName] = useState('')
  var [loginPassword, setLoginPassword] = useState('')
  var [browserApiKey, setBrowserApiKey] = useState('')
  var [browserBaseUrl, setBrowserBaseUrl] = useState('https://api.aigo0.com')
  var [browserModel, setBrowserModel] = useState('gpt-5.5')
  var [autoFillAfterOcr, setAutoFillAfterOcr] = useState(false)
  var [usePlatformFixture, setUsePlatformFixture] = useState(false)
  var [automationLogs, setAutomationLogs] = useState<Array<{ message: string; time: string }>>([])
  var isDesktop = typeof window !== 'undefined' && Boolean(window.desktopApi)
  var showPlatformControls = isDesktop && !embedded

  // 设置面板折叠状态（默认有 Key 时折叠，无 Key 时展开）
  var savedKeysCount = useMemo(
    () => Math.max(normalizeApiKeys(apiKey).length, desktopKeyCount),
    [apiKey, desktopKeyCount],
  )
  var [isSettingsOpen, setIsSettingsOpen] = useState(() => normalizeApiKeys(localStorage.getItem(STORAGE_KEY) || '').length === 0)

  // 多图上传列表与识别行数据
  var [imageList, setImageList] = useState<UploadedImageItem[]>([])
  var [allRows, setAllRows] = useState<ClassifiedPatientRow[]>([])
  var [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('全部')
  var [activeImagePreview, setActiveImagePreview] = useState<string | null>(null)

  // 批量操作配置
  var [batchCategory, setBatchCategory] = useState<string>('')
  var [batchDept, setBatchDept] = useState<string>('')
  var [batchVisitType, setBatchVisitType] = useState<string>('')

  // 运行状态
  var [busy, setBusy] = useState(false)
  var [elapsed, setElapsed] = useState(0)
  var [status, setStatus] = useState('就绪：添加图片后点击开始批量识别')

  var departmentOptions = useMemo(() => mergeDepartmentOptions(customDepartments), [customDepartments])

  // 启动时尝试同步本地 Electron safeStorage / localStorage
  useEffect(() => {
    if (!window.desktopApi) return undefined
    window.desktopApi.loadOcrSettings().then((settings) => {
      if (settings.model) setOcrModel(settings.model)
      setDesktopKeyCount(settings.keyCount || 0)
      if (settings.keyCount > 0) setIsSettingsOpen(false)
    }).catch(() => {})
    return window.desktopApi.onAutomationLog((entry) => {
      setAutomationLogs((current) => [...current.slice(-39), entry])
    })
  }, [])

  useEffect(() => {
    if (!busy) return undefined
    setElapsed(0)
    var startedAt = Date.now()
    var timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    onRowsChange?.(allRows)
  }, [allRows, onRowsChange])

  // 保存并持久化配置
  var saveSettings = () => {
    var keys = normalizeApiKeys(apiKey)
    if (!keys.length) return setStatus('请先填写至少一把 API Key')
    localStorage.setItem(STORAGE_KEY, keys.join('\n'))
    localStorage.setItem(STORAGE_MODEL, ocrModel)
    localStorage.setItem(STORAGE_DEPT, defaultDept)
    setApiKey(keys.join('\n'))
    if (window.desktopApi) {
      window.desktopApi.saveOcrSettings({ apiKeys: keys.join('\n'), model: ocrModel }).catch(() => {})
    }
    setDesktopKeyCount(keys.length)
    setStatus(`已成功持久化保存 ${keys.length} 把 Key，下次启动将自动就绪`)
  }

  // 多文件变更处理
  var handleMultiFileChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    var newItems: UploadedImageItem[] = []
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      var dataUrl = await readFileAsDataUrl(file)
      newItems.push({
        id: `img-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        dataUrl,
        status: 'pending',
      })
    }
    setImageList((prev) => [...prev, ...newItems])
    setStatus(`已添加 ${newItems.length} 张图片，共 ${imageList.length + newItems.length} 张，点击「开始批量智能识别」`)
  }

  // 移除单张图片
  var removeImageItem = (id: string) => {
    var target = imageList.find((it) => it.id === id)
    setImageList((prev) => prev.filter((it) => it.id !== id))
    if (target) {
      var targetName = target.name
      setAllRows((prev) => prev.filter((r) => r.sourceImage !== targetName))
    }
  }

  // 清空所有图片
  var clearAllImages = () => {
    setImageList([])
    setAllRows([])
    setStatus('已清空所有图片与识别记录')
  }

  // 加载五类病种演示数据
  var loadDemoData = () => {
    var sampleRows: ClassifiedPatientRow[] = [
      {
        id: 'demo-1',
        category: '住院病种记录',
        department: defaultDept || '通州呼吸科二区',
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
        inferredReason: '检测到住院号 376813，自动清洗 (M47.921) 编码',
        checked: true,
        remarks: '',
        imageFile: 'his_inpatient_list.png',
        rawSourceRow: {},
      },
      {
        id: 'demo-2',
        category: '门诊病种记录',
        department: defaultDept || '通州呼吸科二区',
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
        inferredReason: '识别到门诊号与就诊记录，自动清洗 [I10.001] 编码',
        checked: true,
        remarks: '',
        imageFile: 'clinic_record_01.png',
        rawSourceRow: {},
      },
      {
        id: 'demo-3',
        category: '临床技术记录',
        department: defaultDept || '通州呼吸科二区',
        patientName: '李秀英',
        recordNo: '381920',
        hospitalNo: '381920',
        outpatientNo: '',
        medicalRecordNo: '',
        tcmDiag: '肺痿:气阴两虚',
        wmDiag: '肺结节待查',
        operationName: 'CT引导下经皮肺穿刺活检术',
        visitType: '主管',
        date: '2026-08-10',
        admissionDate: '',
        visitDate: '',
        operationDate: '2026-08-10',
        generalDate: '2026-08-10',
        sourceImage: 'puncture_skill.jpg',
        confidence: 'high',
        inferredReason: '命中临床技术关键词「穿刺」，自动提取操作名称与日期',
        checked: true,
        remarks: '',
        imageFile: 'puncture_skill.jpg',
        rawSourceRow: {},
      },
      {
        id: 'demo-4',
        category: '手写大病历',
        department: defaultDept || '通州呼吸科二区',
        patientName: '张海波',
        recordNo: '379011',
        hospitalNo: '379011',
        outpatientNo: '',
        medicalRecordNo: '',
        tcmDiag: '哮病:寒哮证',
        wmDiag: '支气管哮喘急性发作',
        operationName: '',
        visitType: '主管',
        date: '2026-08-15',
        admissionDate: '2026-08-15',
        visitDate: '',
        operationDate: '',
        generalDate: '2026-08-15',
        sourceImage: '大病历_01_张海波.jpg',
        confidence: 'high',
        inferredReason: '文件名含「大病历」，已完成中医主诉与西医鉴别诊断结构化',
        checked: true,
        remarks: '',
        imageFile: '大病历_01_张海波.jpg',
        rawSourceRow: {},
      },
      {
        id: 'demo-5',
        category: '门诊病历',
        department: defaultDept || '通州呼吸科二区',
        patientName: '陈小明',
        recordNo: 'MZ-90124',
        hospitalNo: '',
        outpatientNo: 'MZ-90124',
        medicalRecordNo: 'MZ-90124',
        tcmDiag: '感冒:风热犯肺',
        wmDiag: '急性上呼吸道感染',
        operationName: '',
        visitType: '复诊',
        date: '2026-08-20',
        admissionDate: '',
        visitDate: '2026-08-20',
        operationDate: '',
        generalDate: '2026-08-20',
        sourceImage: '门诊处方病历_02.png',
        confidence: 'medium',
        inferredReason: '识别为门诊处方与病历记录，已自动清洗多余格式',
        checked: true,
        remarks: '',
        imageFile: '门诊处方病历_02.png',
        rawSourceRow: {},
      },
    ]
    setAllRows(sampleRows)
    setStatus('已载入 5 类病种示例数据，可在右侧表格中查看、微调或导出')
  }

  // 选择模板文件
  var handleTemplateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    var file = event.target.files?.[0]
    if (!file) {
      setTemplateName('使用标准 16 列五类合并格式')
      setTemplateDataUrl('')
      return
    }
    try {
      setTemplateName(file.name)
      setTemplateDataUrl(await readFileAsDataUrl(file))
      setStatus(`已选择模板：${file.name}`)
    } catch (err) {
      setTemplateName('使用标准 16 列五类合并格式')
      setTemplateDataUrl('')
      setStatus(err instanceof Error ? err.message : '模板读取失败')
    }
  }

  // 开始并发识别
  var startBatchRecognition = async () => {
    if (busy) return
    if (imageList.length === 0) return setStatus('请先添加需要识别的图片')
    var keys = normalizeApiKeys(apiKey)
    if (keys.length === 0 && !window.desktopApi) {
      setIsSettingsOpen(true)
      return setStatus('未检测到有效 API Key，请在设置中填入并保存')
    }

    localStorage.setItem(STORAGE_KEY, keys.join('\n'))
    localStorage.setItem(STORAGE_MODEL, ocrModel)
    localStorage.setItem(STORAGE_DEPT, defaultDept)

    setBusy(true)
    setStatus(`正在并发调度识别 ${imageList.length} 张图片…`)

    try {
      var rows = await processBatchImages(
        imageList,
        keys,
        ocrModel,
        defaultDept,
        (_updated, updatedList) => {
          setImageList([...updatedList])
        },
      )
      var mergedRows: ClassifiedPatientRow[] = []
      setAllRows((prev) => {
        var existingMap = new Map(prev.map((r) => [r.id, r]))
        rows.forEach((r) => existingMap.set(r.id, r))
        mergedRows = Array.from(existingMap.values())
        return mergedRows
      })
      var fillableCount = selectInpatientFillRecords(mergedRows).length
      if (embedded) {
        setStatus(
          fillableCount
            ? `识别完成：共解析 ${rows.length} 条，其中 ${fillableCount} 条住院病种可填入。核对后导出 Excel，或到「平台自动化」填入`
            : `识别完成：共解析 ${rows.length} 条记录，已自动归纳五类病种。核对后可导出 Excel`,
        )
      } else {
        setStatus(`识别完成：共解析 ${rows.length} 条记录，已自动归纳五类病种`)
        if (window.desktopApi && autoFillAfterOcr && fillableCount) {
          setBusy(false)
          setStatus(`识别完成：共解析 ${rows.length} 条，其中 ${fillableCount} 条住院病种可填入，正在打开平台`)
          await fillBrowser(mergedRows)
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '识别处理异常')
    } finally {
      setBusy(false)
    }
  }

  // 批量勾选/取消
  var toggleSelectAll = (check: boolean) => {
    setAllRows((prev) =>
      prev.map((r) => {
        if (selectedCategoryTab === '全部' || r.category === selectedCategoryTab) {
          return { ...r, checked: check }
        }
        return r
      }),
    )
  }

  // 修改单行
  var updateRowField = (id: string, field: keyof ClassifiedPatientRow, value: any) => {
    setAllRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        return { ...r, [field]: value, isManualModified: true }
      }),
    )
  }

  // 批量应用类别
  var applyBatchCategory = () => {
    if (!batchCategory) return
    var targetCat = batchCategory as PatientCategory
    setAllRows((prev) =>
      prev.map((r) => (r.checked ? { ...r, category: targetCat, isManualModified: true } : r)),
    )
    setStatus(`已将选中记录类别变更为「${batchCategory}」`)
  }

  // 批量应用科室
  var applyBatchDept = () => {
    if (!batchDept) return
    setAllRows((prev) =>
      prev.map((r) => (r.checked ? { ...r, department: batchDept, isManualModified: true } : r)),
    )
    setCustomDepartments((cur) => rememberDepartment(cur, batchDept))
    setStatus(`已将选中记录科室变更为「${batchDept}」`)
  }

  // 批量应用初复诊 / 主管参观
  var applyBatchVisitType = () => {
    if (!batchVisitType) return
    setAllRows((prev) =>
      prev.map((r) =>
        r.checked ? { ...r, visitType: batchVisitType as any, isManualModified: true } : r,
      ),
    )
    setStatus(`已将选中记录形式变更为「${batchVisitType}」`)
  }

  // 单行删除
  var removeRow = (id: string) => {
    setAllRows((prev) => prev.filter((r) => r.id !== id))
  }

  // 导出 Excel
  var handleExportExcel = async () => {
    var checkedCount = allRows.filter((r) => r.checked).length
    if (checkedCount === 0) return setStatus('请先勾选需要导出的记录')
    setBusy(true)
    setStatus('正在生成 16 列合并标准格式 Excel…')
    try {
      var result = await exportClassifiedRowsToExcel(
        allRows,
        `五类病种合并登记表_${new Date().toISOString().slice(0, 10)}`,
        templateDataUrl || undefined,
      )
      setStatus(`导出完成：成功生成 ${result.rowCount} 条标准记录`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '导出 Excel 失败')
    } finally {
      setBusy(false)
    }
  }

  var fillBrowser = async (rows?: ClassifiedPatientRow[]) => {
    if (!window.desktopApi) return setStatus('当前不是桌面端，请使用 EXE 运行')
    var sourceRows = Array.isArray(rows) ? rows : allRows
    var nextRecords = selectInpatientFillRecords(sourceRows)
    var login = {
      loginName: loginName || (usePlatformFixture ? 'fixture' : ''),
      loginPassword: loginPassword || (usePlatformFixture ? 'fixture' : ''),
    }
    if (!login.loginName || !login.loginPassword) return setStatus('请先填写平台账号和密码')
    if (!nextRecords.length) {
      var skipped = describeSkippedInpatientRows(sourceRows)
      if (skipped.checkedCount === 0) return setStatus('请先勾选要填入的行')
      if (skipped.inpatientCount === 0) return setStatus(`已勾选 ${skipped.checkedCount} 行，但没有住院病种记录可填入`)
      return setStatus(`已勾选 ${skipped.inpatientCount} 条住院病种，但有 ${skipped.skippedIncomplete} 条缺少姓名、住院号或诊断`)
    }
    setStatus(`正在打开平台并填入 ${nextRecords.length} 条住院病种记录…`)
    try {
      var result = await window.desktopApi.fillBrowser({
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

  var clearBrowserTemplate = async () => {
    if (!window.desktopApi) return
    setStatus(await window.desktopApi.clearBrowserTemplate())
  }

  // 统计与过滤
  var summary = useMemo(() => summarizeCategories(allRows), [allRows])
  var filteredRows = useMemo(() => {
    if (selectedCategoryTab === '全部') return allRows
    return allRows.filter((r) => r.category === selectedCategoryTab)
  }, [allRows, selectedCategoryTab])

  return (
    <div className={embedded ? 'ocr-embedded' : 'app-shell ocr-suite'}>
      {embedded ? null : (
        <header className="hero-clean">
          <div className="hero-clean-left">
            <div className="hero-title-row">
              <h1>病历智能识别与五类合并工作台</h1>
              <div className="badge-row">
                <span className="badge-tag">五类病种自动归类</span>
                <span className="badge-tag">多图并发</span>
                <span className="badge-tag">16列标准模板直出</span>
              </div>
            </div>
            <p className="hero-desc">
              支持病历截图与 HIS 列表批量拖拽识别，自动剔除诊断 ICD 编码，智能归类住院/门诊/临床技术/手写大病历/门诊病历。
            </p>
          </div>
          <div className="hero-clean-right">
            <button type="button" className="subtle-btn" onClick={loadDemoData}>
              载入示例数据
            </button>
          </div>
        </header>
      )}

      <main className="ocr-main-layout">
        {/* 左侧：多图上传与配置 */}
        <section className="left-panel">
          {/* 上传卡片 */}
          <div className="card upload-control-card">
            <div className="card-header">
              <h3>批量添加图片</h3>
              <div className="card-header-actions">
                {embedded ? (
                  <button type="button" className="subtle-btn" onClick={loadDemoData}>
                    载入示例数据
                  </button>
                ) : null}
                {embedded && onGoToPlatform ? (
                  <button type="button" className="subtle-btn" onClick={onGoToPlatform}>
                    去平台自动化
                  </button>
                ) : null}
                <span className="card-sub">{imageList.length} 张</span>
              </div>
            </div>

            <div
              className="dropzone-area"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                handleMultiFileChange(e.dataTransfer.files)
              }}
            >
              <input
                id="multi-file-input"
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => handleMultiFileChange(e.target.files)}
                style={{ display: 'none' }}
              />
              <label htmlFor="multi-file-input" className="dropzone-label">
                <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <strong>点击或拖拽添加多张图片</strong>
                <small>支持 JPG、PNG、WEBP 多图同时上传</small>
              </label>
            </div>

            {/* 图片列表 */}
            {imageList.length > 0 && (
              <div className="image-chip-list">
                <div className="chip-list-header">
                  <span>图片列表</span>
                  <button type="button" className="text-btn danger" onClick={clearAllImages}>
                    清空
                  </button>
                </div>
                <div className="chip-scroll">
                  {imageList.map((img) => (
                    <div key={img.id} className={`image-chip status-${img.status}`}>
                      <div className="chip-thumb" onClick={() => setActiveImagePreview(img.dataUrl)}>
                        <img src={img.dataUrl} alt={img.name} />
                      </div>
                      <div className="chip-info">
                        <span className="chip-title" title={img.name}>
                          {img.name}
                        </span>
                        <span className="chip-status-badge">
                          {img.status === 'pending' && '待识别'}
                          {img.status === 'processing' && '识别中…'}
                          {img.status === 'done' && `已解析 ${img.recognizedRows?.length || 0} 行`}
                          {img.status === 'error' && (img.error || '失败')}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="chip-remove-btn"
                        onClick={() => removeImageItem(img.id)}
                        title="移除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 基础与并发配置（可折叠式抽屉，保持界面简洁） */}
          <div className="card settings-card">
            <div
              className="card-header clickable-header"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            >
              <div className="settings-header-left">
                <h3>并发与基础设置</h3>
                {savedKeysCount > 0 ? (
                  <span className="status-pill success">
                    ✓ 已保存 {savedKeysCount} 个密钥
                  </span>
                ) : (
                  <span className="status-pill warning">未配置密钥</span>
                )}
              </div>
              <button
                type="button"
                className="toggle-link-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsSettingsOpen(!isSettingsOpen)
                }}
              >
                {isSettingsOpen ? '收起' : '展开配置'}
              </button>
            </div>

            {isSettingsOpen ? (
              <div className="settings-body">
                <label className="field-block">
                  <div className="field-label-row">
                    <span className="field-label">硅基流动 API Key</span>
                    <span className="field-help">支持换行或逗号分隔多 Key 并发加速</span>
                  </div>
                  <textarea
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value)
                      localStorage.setItem(STORAGE_KEY, e.target.value)
                    }}
                    placeholder="每行填入一把 sk- 开头的 Key"
                    rows={3}
                  />
                </label>

                <div className="field-grid-2">
                  <label className="field-block">
                    <span className="field-label">视觉识别模型</span>
                    <input
                      value={ocrModel}
                      onChange={(e) => {
                        setOcrModel(e.target.value)
                        localStorage.setItem(STORAGE_MODEL, e.target.value)
                      }}
                    />
                  </label>
                  <label className="field-block">
                    <span className="field-label">默认归属科室</span>
                    <input
                      list="default-dept-options"
                      value={defaultDept}
                      onChange={(e) => {
                        setDefaultDept(e.target.value)
                        localStorage.setItem(STORAGE_DEPT, e.target.value)
                      }}
                    />
                    <datalist id="default-dept-options">
                      {departmentOptions.map((opt) => (
                        <option key={opt} value={opt} />
                      ))}
                    </datalist>
                  </label>
                </div>

                {showPlatformControls ? (
                  <div className="field-grid-2">
                    <label className="field-block">
                      <span className="field-label">浏览器智能体 API Key</span>
                      <input
                        value={browserApiKey}
                        onChange={(e) => setBrowserApiKey(e.target.value)}
                        placeholder="选填，夹具测试可不填"
                      />
                    </label>
                    <label className="field-block">
                      <span className="field-label">智能体接口</span>
                      <input value={browserBaseUrl} onChange={(e) => setBrowserBaseUrl(e.target.value)} />
                    </label>
                    <label className="field-block">
                      <span className="field-label">智能体模型</span>
                      <input value={browserModel} onChange={(e) => setBrowserModel(e.target.value)} />
                    </label>
                    <div className="field-block">
                      <span className="field-label">操作模板</span>
                      <button type="button" className="secondary-btn" onClick={clearBrowserTemplate}>
                        清除浏览器模板
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="settings-btn-row">
                  <button type="button" className="secondary-btn" onClick={saveSettings}>
                    保存设置
                  </button>
                  <label className="template-btn-label">
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={handleTemplateChange}
                      style={{ display: 'none' }}
                    />
                    <span className="secondary-btn">更换 Excel 模板</span>
                  </label>
                </div>
                <div className="template-tip">模板：{templateName}</div>
              </div>
            ) : (
              <div className="settings-summary-bar" onClick={() => setIsSettingsOpen(true)}>
                <span>{ocrModel} · {defaultDept || '未指定科室'}</span>
                <span className="edit-hint">点击修改</span>
              </div>
            )}
          </div>

          {/* 操作触发器 */}
          <div className="card launch-card">
            <button
              type="button"
              className="launch-main-btn"
              onClick={startBatchRecognition}
              disabled={busy || imageList.length === 0}
            >
              {busy ? `正在并发识别 (${elapsed}s)…` : `开始批量智能识别 (${imageList.length} 张)`}
            </button>
            {showPlatformControls ? (
              <div className="platform-fill-box">
                <div className="platform-login-row">
                  <input
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    placeholder={usePlatformFixture ? '账号（夹具可用 fixture）' : '平台账号'}
                  />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={usePlatformFixture ? '密码（夹具可用 fixture）' : '平台密码'}
                  />
                </div>
                <button
                  type="button"
                  className="platform-fill-btn"
                  onClick={() => fillBrowser()}
                  disabled={busy || allRows.length === 0}
                >
                  登录平台并自动填入
                </button>
                <label className="auto-fill-check">
                  <input
                    type="checkbox"
                    checked={autoFillAfterOcr}
                    onChange={(e) => setAutoFillAfterOcr(e.target.checked)}
                  />
                  识别完成后自动打开平台填写并提交
                </label>
                <label className="auto-fill-check">
                  <input
                    type="checkbox"
                    checked={usePlatformFixture}
                    onChange={(e) => setUsePlatformFixture(e.target.checked)}
                  />
                  使用本地平台夹具测试（不连正式网站）
                </label>
                {automationLogs.length > 0 ? (
                  <div className="automation-log-list">
                    {automationLogs.slice(-8).map((entry, index) => (
                      <p key={`${entry.time}-${index}`}>
                        <span>{entry.time}</span>
                        {entry.message}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="status-banner">{status}</div>
          </div>
        </section>

        {/* 右侧：五类智能归纳总表与批量管理 */}
        <section className="right-panel">
          <div className="card table-container-card">
            {/* 顶部分类选项卡与统计 */}
            <div className="category-tabs-bar">
              <div className="tabs-group">
                <button
                  type="button"
                  className={`tab-btn ${selectedCategoryTab === '全部' ? 'active' : ''}`}
                  onClick={() => setSelectedCategoryTab('全部')}
                >
                  全部记录 ({summary.total})
                </button>
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`tab-btn cat-${cat} ${selectedCategoryTab === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryTab(cat)}
                  >
                    {cat} ({summary[cat] || 0})
                  </button>
                ))}
              </div>

              <div className="export-action-box">
                {embedded && onGoToPlatform ? (
                  <button
                    type="button"
                    className="platform-fill-btn compact"
                    onClick={onGoToPlatform}
                    disabled={allRows.length === 0}
                  >
                    去平台自动化
                  </button>
                ) : showPlatformControls ? (
                  <button
                    type="button"
                    className="platform-fill-btn compact"
                    onClick={() => fillBrowser()}
                    disabled={busy || allRows.length === 0}
                  >
                    填入平台
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-btn export-btn"
                  onClick={handleExportExcel}
                  disabled={busy || allRows.length === 0}
                >
                  导出 16 列五类合并 Excel ({summary.selected} 条)
                </button>
              </div>
            </div>

            {/* 批量编辑快捷操作条 */}
            <div className="batch-toolbar">
              <div className="batch-selection-info">
                <button type="button" className="mini-btn" onClick={() => toggleSelectAll(true)}>
                  全选
                </button>
                <button type="button" className="mini-btn" onClick={() => toggleSelectAll(false)}>
                  全不选
                </button>
                <span className="selection-count-text">
                  选中 <strong>{filteredRows.filter((r) => r.checked).length}</strong> / {filteredRows.length} 行
                </span>
              </div>

              <div className="batch-actions-form">
                {/* 批量类别 */}
                <div className="batch-item">
                  <select value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}>
                    <option value="">批量修改类别…</option>
                    {ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="mini-action-btn" onClick={applyBatchCategory}>
                    应用
                  </button>
                </div>

                {/* 批量科室 */}
                <div className="batch-item">
                  <input
                    list="batch-dept-options"
                    value={batchDept}
                    onChange={(e) => setBatchDept(e.target.value)}
                    placeholder="批量指定科室…"
                  />
                  <datalist id="batch-dept-options">
                    {departmentOptions.map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                  <button type="button" className="mini-action-btn" onClick={applyBatchDept}>
                    应用
                  </button>
                </div>

                {/* 批量初复诊/主管参观 */}
                <div className="batch-item">
                  <select value={batchVisitType} onChange={(e) => setBatchVisitType(e.target.value)}>
                    <option value="">批量就诊/主管类型…</option>
                    <option value="初诊">初诊</option>
                    <option value="复诊">复诊</option>
                    <option value="主管">主管</option>
                    <option value="参观">参观</option>
                  </select>
                  <button type="button" className="mini-action-btn" onClick={applyBatchVisitType}>
                    应用
                  </button>
                </div>
              </div>
            </div>

            {/* 统一患者数据编辑表格 */}
            <div className="table-responsive-wrapper">
              {filteredRows.length === 0 ? (
                <div className="empty-state">
                  <svg className="empty-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <line x1="8" y1="9" x2="16" y2="9" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="12" y2="17" />
                  </svg>
                  <p>暂无数据记录。请在左侧添加图片并点击「开始批量智能识别」</p>
                </div>
              ) : (
                <table className="classified-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>选</th>
                      <th style={{ width: '110px' }}>记录类别</th>
                      <th style={{ width: '130px' }}>所在科室</th>
                      <th style={{ width: '90px' }}>患者姓名</th>
                      <th style={{ width: '95px' }}>病历/住院号</th>
                      <th style={{ width: '160px' }}>中医诊断</th>
                      <th style={{ width: '160px' }}>西医诊断</th>
                      <th style={{ width: '100px' }}>就诊/医生角色</th>
                      <th style={{ width: '110px' }}>关键日期</th>
                      <th style={{ width: '120px' }}>操作名称(技术)</th>
                      <th style={{ width: '150px' }}>归类依据</th>
                      <th style={{ width: '45px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.id} className={row.checked ? 'row-selected' : ''}>
                        {/* 勾选框 */}
                        <td>
                          <input
                            type="checkbox"
                            checked={row.checked}
                            onChange={(e) => updateRowField(row.id, 'checked', e.target.checked)}
                          />
                        </td>

                        {/* 记录类别 */}
                        <td>
                          <select
                            className={`category-select tag-${row.category}`}
                            value={row.category}
                            onChange={(e) => updateRowField(row.id, 'category', e.target.value as PatientCategory)}
                          >
                            {ALL_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* 所在科室 */}
                        <td>
                          <input
                            className="cell-input"
                            value={row.department}
                            onChange={(e) => updateRowField(row.id, 'department', e.target.value)}
                          />
                        </td>

                        {/* 患者姓名 */}
                        <td>
                          <input
                            className="cell-input name-input"
                            value={row.patientName}
                            onChange={(e) => updateRowField(row.id, 'patientName', e.target.value)}
                          />
                        </td>

                        {/* 病历号/住院号 */}
                        <td>
                          <input
                            className="cell-input code-input"
                            value={row.recordNo}
                            onChange={(e) => {
                              var val = e.target.value
                              setAllRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? {
                                        ...r,
                                        recordNo: val,
                                        hospitalNo: r.category === '住院病种记录' ? val : r.hospitalNo,
                                        outpatientNo: r.category === '门诊病种记录' ? val : r.outpatientNo,
                                        medicalRecordNo: r.category === '住院病种记录' || r.category === '门诊病种记录' ? r.medicalRecordNo : val,
                                      }
                                    : r,
                                ),
                              )
                            }}
                          />
                        </td>

                        {/* 中医诊断 */}
                        <td>
                          <input
                            className="cell-input diag-input tcm"
                            value={row.tcmDiag}
                            placeholder="图片未识别时保持空白"
                            onChange={(e) => updateRowField(row.id, 'tcmDiag', e.target.value)}
                          />
                        </td>

                        {/* 西医诊断 */}
                        <td>
                          <input
                            className="cell-input diag-input wm"
                            value={row.wmDiag}
                            placeholder="图片未识别时保持空白"
                            onChange={(e) => updateRowField(row.id, 'wmDiag', e.target.value)}
                          />
                        </td>

                        {/* 形式/角色 */}
                        <td>
                          <select
                            className="cell-select"
                            value={row.visitType}
                            onChange={(e) => updateRowField(row.id, 'visitType', e.target.value)}
                          >
                            <option value="">--</option>
                            <option value="初诊">初诊</option>
                            <option value="复诊">复诊</option>
                            <option value="主管">主管</option>
                            <option value="参观">参观</option>
                            <option value="确诊">确诊</option>
                          </select>
                        </td>

                        {/* 日期 */}
                        <td>
                          <input
                            className="cell-input date-input"
                            value={row.date}
                            placeholder="YYYY-MM-DD"
                            onChange={(e) => updateRowField(row.id, 'date', e.target.value)}
                          />
                        </td>

                        {/* 临床技术操作名称 */}
                        <td>
                          <input
                            className="cell-input"
                            value={row.operationName}
                            placeholder="技术操作名称"
                            onChange={(e) => updateRowField(row.id, 'operationName', e.target.value)}
                          />
                        </td>

                        {/* 智能归类理由与来源 */}
                        <td>
                          <div className="reason-badge-box" title={`来源: ${row.sourceImage}`}>
                            <span className={`confidence-dot ${row.confidence}`} />
                            <span className="reason-text">{row.inferredReason || '自动推断'}</span>
                            <span className="source-tag">{row.sourceImage.slice(0, 8)}…</span>
                          </div>
                        </td>

                        {/* 删除 */}
                        <td>
                          <button
                            type="button"
                            className="row-delete-btn"
                            onClick={() => removeRow(row.id)}
                            title="删除"
                          >
                            ×
                          </button>
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

      {/* 原图弹窗预览 */}
      {activeImagePreview && (
        <div className="preview-modal-backdrop" onClick={() => setActiveImagePreview(null)}>
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>原图预览</h4>
              <button type="button" onClick={() => setActiveImagePreview(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <img src={activeImagePreview} alt="原图" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
