import { useState } from 'react'
import OcrWebApp from './OcrWebApp'
import PlatformPage from './PlatformPage'
import type { ClassifiedPatientRow } from './smartClassifier'

export default function DesktopApp() {
  var [page, setPage] = useState<'ocr' | 'platform'>('platform')
  var [ocrRows, setOcrRows] = useState<ClassifiedPatientRow[]>([])

  return (
    <div className="app-shell desktop-shell">
      <header className="desktop-topbar">
        <div className="desktop-brand">
          <strong>病例自动传</strong>
          <p>
            {page === 'ocr'
              ? '识别病历图片，核对五类记录并导出 Excel'
              : '登录规培平台，选择已核对的 Excel 或当前识别结果，自动填入住院病种记录'}
          </p>
        </div>
        <nav className="desktop-page-nav" aria-label="功能页面">
          <button type="button" className={page === 'ocr' ? 'active' : ''} onClick={() => setPage('ocr')}>
            识别工作台
          </button>
          <button type="button" className={page === 'platform' ? 'active' : ''} onClick={() => setPage('platform')}>
            平台自动化
          </button>
        </nav>
      </header>

      <div hidden={page !== 'ocr'}>
        <OcrWebApp embedded onRowsChange={setOcrRows} onGoToPlatform={() => setPage('platform')} />
      </div>
      <div hidden={page !== 'platform'}>
        <PlatformPage ocrRows={ocrRows} />
      </div>
    </div>
  )
}
