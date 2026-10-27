const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chan', {
  setPos: (x, y) => ipcRenderer.send('pos', x, y),
  ignoreMouse: (ignore) => ipcRenderer.send('mouse', ignore),
  geometry: () => ipcRenderer.invoke('geometry'),
  workAreaAt: (x, y) => ipcRenderer.invoke('workArea', x, y),
  openMenu: () => ipcRenderer.send('menu'),
  quit: () => ipcRenderer.send('quit'),
  away: () => ipcRenderer.send('away'),
  achieve: (event, variant) => ipcRenderer.invoke('achieve', event, variant),
  onClaude: (fn) => ipcRenderer.on('claude', (_e, ev) => fn(ev)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd) => fn(cmd)),
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, p) => fn(p)),
  windows: () => ipcRenderer.invoke('windows'),
  peer: () => ipcRenderer.invoke('peer'),
});
