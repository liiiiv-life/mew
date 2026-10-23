const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desktopHost', {
  capture: () => ipcRenderer.invoke('desktop:capture'),
  ready: () => ipcRenderer.send('desktop:ready'),
  onSignal: (callback) => ipcRenderer.on('desktop:signal', (_event, value) => callback(value)),
  signal: (value) => ipcRenderer.send('desktop:signal', value),
  input: (value, reliable) => ipcRenderer.send('desktop:input', value, reliable),
  frame: (packet) => ipcRenderer.send('desktop:frame', packet),
})
