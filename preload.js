const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Overlay → Main
  onSetScreenshot: (cb) => ipcRenderer.on('set-screenshot', (_, data) => cb(data)),
  selectionComplete: (region) => ipcRenderer.send('selection-complete', region),
  selectionCancel: () => ipcRenderer.send('selection-cancel'),

  // Editor → Main
  onLoadImage: (cb) => ipcRenderer.on('load-image', (_, data, w, h) => cb(data, w, h)),
  saveImage:   (base64) => ipcRenderer.invoke('save-image', base64),
  copyImage:   (base64) => ipcRenderer.send('copy-image', base64),
  closeEditor: ()       => ipcRenderer.send('close-editor'),
  getOriginalForExpand: ()     => ipcRenderer.invoke('get-original-for-expand'),
  applyExpand:          (data) => ipcRenderer.invoke('apply-expand', data),
})
