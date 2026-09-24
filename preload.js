const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddyApi', {
  onLayout: (cb) => ipcRenderer.on('layout', (_, l) => cb(l)),
  onRemind: (cb) => ipcRenderer.on('remind', () => cb()),
  setClickable: (on) => ipcRenderer.send('clickable', on),
  done: () => ipcRenderer.send('done'),
});
