const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Janela
  close:    () => ipcRenderer.send('win-close'),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),

  // Config
  getConfig: ()      => ipcRenderer.invoke('get-config'),
  setConfig: (cfg)   => ipcRenderer.invoke('set-config', cfg),

  // Diálogos
  pickFile:   (filters) => ipcRenderer.invoke('pick-file', filters),
  pickFiles:  (filters) => ipcRenderer.invoke('pick-files', filters),
  pickFolder: ()        => ipcRenderer.invoke('pick-folder'),

  // Processamento
  gerarBase:    (opts)     => ipcRenderer.invoke('gerar-base', opts),
  executarMesa: (csvPath)  => ipcRenderer.invoke('executar-mesa', csvPath),
  openOutput:   (filePath) => ipcRenderer.invoke('open-output', filePath),
  listarMesa:   ()         => ipcRenderer.invoke('listar-mesa'),
  limparMesa:   (payload)  => ipcRenderer.invoke('limpar-mesa', payload),
  previewTratadosFora: ()  => ipcRenderer.invoke('preview-tratados-fora'),
  runExtracao:  (payload)  => ipcRenderer.invoke('run-extraction', payload),

  // Genesys
  testGenesys: () => ipcRenderer.invoke('test-genesys'),

  // Automação
  startAuto: (mins) => ipcRenderer.invoke('start-auto', mins),
  stopAuto:  ()     => ipcRenderer.invoke('stop-auto'),

  // Eventos do main → UI
  onProgress:      (cb) => ipcRenderer.on('progress',       (_, d) => cb(d)),
  onAutoTrigger:   (cb) => ipcRenderer.on('auto-trigger',   ()     => cb()),
  onGenesysStatus: (cb) => ipcRenderer.on('genesys-status', (_, d) => cb(d)),
  onExtracaoLog:   (cb) => ipcRenderer.on('extraction-log', (_, d) => cb(d)),
  onCleanupProgress: (cb) => ipcRenderer.on('cleanup-progress', (_, d) => cb(d)),
});
