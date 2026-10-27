// claude-chan desktop companion: transparent always-on-top window + local event bridge.
// A second Claude session gets her little sister in a second window; events are routed by session.
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CLAUDE_CHAN_PORT || 47321);
const WIN_W = 240;
const WIN_H = 300;
// .ico carries every size Windows asks for (tray, taskbar, alt-tab); png elsewhere
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

let main = null; // { win, ready, pending, sister }
let sister = null;
let tray;
let wander = true;
let inTaskbar = false;
let glasses = false;
let sounds = false;
// menu toggles survive restarts
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (typeof p.glasses === 'boolean') glasses = p.glasses;
    if (typeof p.wander === 'boolean') wander = p.wander;
    if (typeof p.inTaskbar === 'boolean') inTaskbar = p.inTaskbar;
    if (typeof p.sounds === 'boolean') sounds = p.sounds;
  } catch { /* first run */ }
}
function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ glasses, wander, inTaskbar, sounds })); } catch { /* not fatal */ }
}
let windows = []; // other apps' windows, front to back (DIP), for perching on title bars

// a small PowerShell helper lists the open windows (Windows only; CLAUDE_CHAN_PERCH=0 to turn off)
function startWindowScan() {
  if (process.platform !== 'win32' || process.env.CLAUDE_CHAN_PERCH === '0') return;
  const script = fs.readFileSync(path.join(__dirname, 'scripts', 'windows.ps1'), 'utf8')
    .replace(/param\(\[int\]\$SelfPid = 0\)/, () => '$SelfPid = ' + process.pid);
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      try {
        windows = JSON.parse(line).map(([id, l, t, r, b, max, fg, min]) => {
          if (min) return { id, x: 0, y: 0, w: 0, h: 0, max: false, fg: false, min: true };
          const d = screen.screenToDipRect(null, { x: l, y: t, width: r - l, height: b - t });
          return { id, x: d.x, y: d.y, w: d.width, h: d.height, max: !!max, fg: !!fg };
        });
      } catch { /* partial line */ }
    }
  });
  ps.on('error', () => {});
  app.on('will-quit', () => ps.kill());
}

function createChar(isSister) {
  const { workArea } = screen.getPrimaryDisplay();
  const c = { ready: false, pending: [], sister: isSister };
  c.win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: isSister ? workArea.x + 80 : workArea.x + workArea.width - WIN_W - 80,
    y: workArea.y + workArea.height - WIN_H,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: isSister || !inTaskbar,
    alwaysOnTop: true,
    focusable: true,
    icon: ICON,
    title: isSister ? 'clawde chan (sister)' : 'clawde chan',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Windows can report a transparent overlay as occluded; keep her animating anyway.
      backgroundThrottling: false,
    },
  });
  c.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.error('[renderer]', e.message);
  });
  c.win.webContents.on('did-finish-load', () => {
    c.ready = true;
    for (const [channel, payload] of c.pending.splice(0)) sendTo(c, channel, payload);
    if (glasses && !isSister) sendTo(c, 'command', 'glasses-on-quiet');
    if (!wander) sendTo(c, 'command', 'wander-off');
    if (sounds) sendTo(c, 'command', 'sound-on');
  });
  c.win.on('closed', () => { if (c === sister) dropSister(); });
  c.win.setAlwaysOnTop(true, 'screen-saver');
  c.win.setIgnoreMouseEvents(true, { forward: true });
  c.win.loadFile(path.join(__dirname, 'renderer', 'index.html'), isSister ? { query: { sister: '1' } } : undefined);
  return c;
}

const charOf = (e) => (sister && e.sender === sister.win.webContents ? sister : main);
const alive = (c) => c && !c.win.isDestroyed();

ipcMain.on('pos', (e, x, y) => {
  const c = charOf(e);
  if (alive(c)) c.win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H });
});
ipcMain.on('mouse', (e, ignore) => {
  const c = charOf(e);
  if (alive(c)) c.win.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.handle('geometry', (e) => {
  const b = charOf(e).win.getBounds();
  const display = screen.getDisplayMatching(b);
  return { x: b.x, y: b.y, w: WIN_W, h: WIN_H, workArea: display.workArea };
});
ipcMain.handle('workArea', (_e, x, y) => screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea);
// her sister's spot (or hers, for the sister), so they can wave at each other
ipcMain.handle('peer', (e) => {
  const other = charOf(e) === main ? sister : main;
  if (!alive(other)) return null;
  const b = other.win.getBounds();
  return { x: b.x, y: b.y };
});
// the sister walking out through her door only closes her window
ipcMain.on('quit', (e) => {
  const c = charOf(e);
  if (c === sister) { c.win.close(); return; }
  app.quit();
});
ipcMain.handle('windows', () => windows);
ipcMain.on('menu', (e) => {
  const c = charOf(e);
  Menu.buildFromTemplate(c === sister ? sisterMenu() : menuTemplate()).popup({ window: c.win });
});

function sendTo(c, channel, payload) {
  if (!c) return;
  if (!c.ready) return void c.pending.push([channel, payload]);
  if (alive(c)) c.win.webContents.send(channel, payload);
}
const send = (channel, payload) => sendTo(main, channel, payload);
const sendAll = (channel, payload) => { sendTo(main, channel, payload); sendTo(sister, channel, payload); };

// ---------- which character a Claude session belongs to ----------
const owner = new Map(); // session id -> 'main' | 'sister'
function dropSister() {
  sister = null;
  for (const [id, who] of owner) if (who === 'sister') owner.set(id, 'main');
}
function routeClaude(ev) {
  const id = ev.session || 'default';
  let who = owner.get(id);
  if (!who) {
    const mainBusy = [...owner.values()].includes('main');
    // a second session opening while her first is still going: her little sister comes along for it
    who = ev.event === 'SessionStart' && mainBusy && !alive(sister) ? 'sister' : 'main';
    if (who === 'sister') sister = createChar(true);
    owner.set(id, who);
  }
  if (ev.event === 'SessionEnd') {
    owner.delete(id);
    // her own last session ended but her sister's is still going: she takes it over and her sister heads home
    if (who === 'main' && alive(sister) && ![...owner.values()].includes('main')) {
      for (const [sid, w] of owner) {
        if (w !== 'sister') continue;
        owner.set(sid, 'main');
        send('claude', { event: 'Adopt', session: sid });
      }
      sendTo(sister, 'command', 'leave');
    }
  }
  sendTo(who === 'sister' && alive(sister) ? sister : main, 'claude', ev);
}

function menuTemplate() {
  return [
    { label: 'Wave hello', click: () => send('command', 'hello') },
    { label: 'Dance', click: () => send('command', 'dance') },
    { label: 'Do a trick', click: () => send('command', 'trick') },
    { label: 'Moonwalk 🕺', click: () => send('command', 'moonwalk') },
    { label: 'Take a nap', click: () => send('command', 'sleep') },
    { label: 'Play hide and seek 🙈', click: () => send('command', 'hide') },
    { label: 'Climb onto a window 🪟', click: () => send('command', 'perch') },
    { label: 'Call the kitty 🐈', click: () => send('command', 'kitty') },
    { label: 'How are you feeling?', click: () => send('command', 'mood') },
    { label: 'Give her…', submenu: treats((cmd) => send('command', cmd)) },
    { label: 'Wear glasses', type: 'checkbox', checked: glasses, click: (i) => { glasses = i.checked; send('command', glasses ? 'glasses-on' : 'glasses-off'); savePrefs(); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Let her wander', type: 'checkbox', checked: wander, click: (i) => { wander = i.checked; sendAll('command', wander ? 'wander-on' : 'wander-off'); savePrefs(); refreshTrayMenu(); } },
    { label: 'Sounds', type: 'checkbox', checked: sounds, click: (i) => { sounds = i.checked; sendAll('command', sounds ? 'sound-on' : 'sound-off'); savePrefs(); refreshTrayMenu(); } },
    { label: 'Show in taskbar', type: 'checkbox', checked: inTaskbar, click: (i) => { inTaskbar = i.checked; main.win.setSkipTaskbar(!inTaskbar); savePrefs(); refreshTrayMenu(); } },
    { label: 'Reset Claude status', click: () => sendAll('command', 'reset') },
    { type: 'separator' },
    { label: 'Quit clawde chan', click: () => send('command', 'leave') },
  ];
}
function sisterMenu() {
  const s = (cmd) => sendTo(sister, 'command', cmd);
  return [
    { label: 'Wave hello', click: () => s('hello') },
    { label: 'Dance', click: () => s('dance') },
    { label: 'Do a trick', click: () => s('trick') },
    { label: 'Climb onto a window 🪟', click: () => s('perch') },
    { label: 'Give her…', submenu: treats(s) },
    { type: 'separator' },
    { label: 'Send her home', click: () => s('leave') },
  ];
}
function treats(give) {
  const fn = (cmd) => () => give(cmd);
  return [
    { label: 'Cookie 🍪', click: fn('treat:cookie') },
    { label: 'Coffee ☕', click: fn('treat:coffee') },
    { label: 'Boba tea 🧋', click: fn('treat:boba') },
    { label: 'Matcha 🍵', click: fn('treat:matcha') },
    { label: 'Milk 🥛', click: fn('treat:milk') },
    { label: 'Water 💧', click: fn('treat:water') },
  ];
}

// Claude Code hooks POST JSON here (see hook.mjs).
function startBridge() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { routeClaude(JSON.parse(body)); } catch { /* ignore malformed */ }
        res.writeHead(204).end();
      });
      return;
    }
    // same commands as her menu (handy for scripts and testing): POST /command with the command as the body
    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 200) req.destroy(); });
      req.on('end', () => { send('command', body.trim()); res.writeHead(204).end(); });
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
    loadPrefs();
    main = createChar(false);
    startBridge();
    startWindowScan();
    try { createTray(); } catch (e) { console.error('[claude-chan] tray:', e.message); }
    let last = '';
    setInterval(() => {
      const p = screen.getCursorScreenPoint();
      const key = p.x + ',' + p.y;
      if (key !== last) { last = key; sendAll('cursor', p); }
    }, 50);
  });
  app.on('window-all-closed', () => app.quit());
}
