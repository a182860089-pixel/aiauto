type OcrResult = {
  rawText?: string
  fields?: Record<string, string>
  table?: { columns: string[]; rows: Array<Record<string, string> | string[]> }
  [key: string]: unknown
}

interface DesktopApi {
  recognizeImage(payload: { dataUrl: string; apiKey: string; model: string }): Promise<OcrResult>
  saveOcrSettings(payload: { apiKeys: string; model: string }): Promise<{ model: string; keyCount: number; settingsPath: string }>
  loadOcrSettings(): Promise<{ model: string; keyCount: number; settingsPath: string }>
  exportOcrExcel(payload: { ocrResult: OcrResult; fileName: string; templateDataUrl?: string; overrides?: Record<string, string>; selectedIndexes?: number[] }): Promise<{ canceled: boolean; outputPath?: string; rowCount?: number; columnCount?: number; matchedColumns?: string[]; ignoredColumns?: string[]; usedTemplate?: boolean }>
  fillBrowser(payload: {
    credentials: { loginName: string; loginPassword: string }
    apiKey: string
    baseUrl: string
    model: string
    fields?: Record<string, string>
    records?: Array<{ id: string; fields: Record<string, string> }>
    submit?: boolean
    useFixture?: boolean
    skipModel?: boolean
    platformOrigin?: string
  }): Promise<string>
  clearBrowserTemplate(): Promise<string>
  onAutomationLog(callback: (payload: { message: string; time: string }) => void): () => void
}

interface Window {
  desktopApi?: DesktopApi
}
