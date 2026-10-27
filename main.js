// claude-chan desktop companion: transparent always-on-top window + local event bridge.
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.CLAUDE_CHAN_PORT || 47321);
const WIN_W = 240;
const WIN_H = 300;
// .ico carries every size Windows asks for (tray, taskbar, alt-tab); png elsewhere
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

let win;
let tray;
let ready = false;
let wander = true;
let inTaskbar = false;
let glasses = false;
const pending = []; // events that arrive before the page has loaded

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 80,
    y: workArea.y + workArea.height - WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    icon: ICON,
    title: 'clawde chan',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Windows can report a transparent overlay as occluded; keep her animating anyway.
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.error('[renderer]', e.message);
  });
  win.webContents.on('did-finish-load', () => {
    ready = true;
    for (const [channel, payload] of pending.splice(0)) send(channel, payload);
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.on('pos', (_e, x, y) => {
  if (win && !win.isDestroyed()) win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H });
});
ipcMain.on('mouse', (_e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.handle('geometry', () => {
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  return { x: b.x, y: b.y, w: WIN_W, h: WIN_H, workArea: display.workArea };
});
ipcMain.handle('workArea', (_e, x, y) => screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea);
ipcMain.on('quit', () => app.quit());
ipcMain.on('menu', () => {
  Menu.buildFromTemplate(menuTemplate()).popup({ window: win });
});

function send(channel, payload) {
  if (!ready) return void pending.push([channel, payload]);
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function menuTemplate() {
  return [
    { label: 'Wave hello', click: () => send('command', 'hello') },
    { label: 'Dance', click: () => send('command', 'dance') },
    { label: 'Do a trick', click: () => send('command', 'trick') },
    { label: 'Take a nap', click: () => send('command', 'sleep') },
    { label: 'Give her…', submenu: [
      { label: 'Cookie 🍪', click: () => send('command', 'treat:cookie') },
      { label: 'Coffee ☕', click: () => send('command', 'treat:coffee') },
      { label: 'Boba tea 🧋', click: () => send('command', 'treat:boba') },
      { label: 'Matcha 🍵', click: () => send('command', 'treat:matcha') },
      { label: 'Milk 🥛', click: () => send('command', 'treat:milk') },
    ] },
    { label: 'Wear glasses', type: 'checkbox', checked: glasses, click: (i) => { glasses = i.checked; send('command', glasses ? 'glasses-on' : 'glasses-off'); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Let her wander', type: 'checkbox', checked: wander, click: (i) => { wander = i.checked; send('command', wander ? 'wander-on' : 'wander-off'); refreshTrayMenu(); } },
    { label: 'Show in taskbar', type: 'checkbox', checked: inTaskbar, click: (i) => { inTaskbar = i.checked; win.setSkipTaskbar(!inTaskbar); refreshTrayMenu(); } },
    { label: 'Reset Claude status', click: () => send('command', 'reset') },
    { type: 'separator' },
    { label: 'Quit clawde chan', click: () => send('command', 'leave') },
  ];
}

// Claude Code hooks POST JSON here (see hook.mjs).
function startBridge() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { send('claude', JSON.parse(body)); } catch { /* ignore malformed */ }
        res.writeHead(204).end();
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/ping') return void res.writeHead(200).end('claude-chan');
    res.writeHead(404).end();
  });
  server.on('error', (err) => console.error('[claude-chan] bridge error:', err.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`[claude-chan] listening on 127.0.0.1:${PORT}`));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('clawde chan');
  refreshTrayMenu();
  tray.on('click', () => tray.popUpContextMenu());
}

// checkbox states live here, so the tray menu is rebuilt whenever one changes
function refreshTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

if (process.platform === 'win32') app.setAppUserModelId('com.rumidaneko.neko-claude');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    startBridge();
    try { createTray(); } catch (e) { console.error('[claude-chan] tray:', e.message); }
    let last = '';
    setInterval(() => {
      const p = screen.getCursorScreenPoint();
      const key = p.x + ',' + p.y;
      if (key !== last) { last = key; send('cursor', p); }
    }, 50);
  });
  app.on('window-all-closed', () => app.quit());
}
