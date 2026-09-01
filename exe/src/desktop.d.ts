type OcrResult = {
  rawText?: string
  fields?: Record<string, string>
  table?: { columns: string[]; rows: Array<Record<string, string> | string[]> }
  [key: string]: unknown
}

interface LicenseStatus {
  active: boolean
  status: 'unactivated' | 'active' | 'expired' | 'disabled' | 'network_error'
  message: string
  machineId: string
  code?: string
  expiresAt?: string
  remainingText?: string
  remainingDays?: number
  isOffline?: boolean
  serverUrl?: string
}

interface LicenseConfig {
  serverUrl: string
  code: string
  machineId: string
  status: string
  expiresAt?: string
  remainingText?: string
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
    records?: Array<{ id: string; category?: string; fields: Record<string, string> }>
    submit?: boolean
    useFixture?: boolean
    skipModel?: boolean
    platformOrigin?: string
  }): Promise<string>
  syncPlatformDepartments(payload: {
    credentials: { loginName: string; loginPassword: string }
    useFixture?: boolean
    platformOrigin?: string
  }): Promise<{ departments: string[]; count: number; message: string }>
  clearBrowserTemplate(): Promise<string>
  onAutomationLog(callback: (payload: { message: string; time: string }) => void): () => void
  onPlatformDepartments(callback: (payload: { departments: string[] }) => void): () => void

  // 卡密与一机一码授权
  getMachineId(): Promise<string>
  getLicenseStatus(): Promise<LicenseStatus>
  getLicenseConfig(): Promise<LicenseConfig>
  setLicenseServerUrl(url: string): Promise<LicenseConfig>
  activateLicense(payload: { code: string; serverUrl?: string }): Promise<{ success: boolean; message: string; remainingText?: string; expiresAt?: string; code: string }>
  clearLicense(): Promise<{ success: boolean; message: string }>
}

interface Window {
  desktopApi?: DesktopApi
}
