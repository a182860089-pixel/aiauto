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
})
