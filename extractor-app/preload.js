const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('extractorApi', {
  getState: () => ipcRenderer.invoke('extractor:get-state'),
  saveConfig: config => ipcRenderer.invoke('extractor:save-config', config),
  chooseFolder: currentPath => ipcRenderer.invoke('extractor:choose-folder', currentPath),
  openFolder: folderPath => ipcRenderer.invoke('extractor:open-folder', folderPath),
  run: ids => ipcRenderer.invoke('extractor:run', ids),
  cancel: id => ipcRenderer.invoke('extractor:cancel', id),
  quit: () => ipcRenderer.invoke('extractor:quit'),
  onState: callback => ipcRenderer.on('extractor:state', (_, state) => callback(state)),
  onLog: callback => ipcRenderer.on('extractor:log', (_, entry) => callback(entry)),
});
