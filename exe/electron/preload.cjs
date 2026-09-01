const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  recognizeImage: (payload) => ipcRenderer.invoke('ocr:recognize', payload),
  saveOcrSettings: (payload) => ipcRenderer.invoke('ocr:save-settings', payload),
  loadOcrSettings: () => ipcRenderer.invoke('ocr:load-settings'),
  exportOcrExcel: (payload) => ipcRenderer.invoke('ocr:export-excel', payload),
  fillBrowser: (payload) => ipcRenderer.invoke('browser:fill', payload),
  clearBrowserTemplate: () => ipcRenderer.invoke('browser:clear-template'),
  onAutomationLog: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('automation:log', listener)
    return () => ipcRenderer.removeListener('automation:log', listener)
  },

  // 卡密与一机一码授权
  getMachineId: () => ipcRenderer.invoke('license:get-machine-id'),
  getLicenseStatus: () => ipcRenderer.invoke('license:get-status'),
  getLicenseConfig: () => ipcRenderer.invoke('license:get-config'),
  setLicenseServerUrl: (url) => ipcRenderer.invoke('license:set-server-url', url),
  activateLicense: (payload) => ipcRenderer.invoke('license:activate', payload),
  clearLicense: () => ipcRenderer.invoke('license:clear'),
})
