// claude-chan desktop companion: transparent always-on-top window + local event bridge.
// A second Claude session gets her little sister in a second window; events are routed by session.
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startCowork } = require('./cowork');
const { createSync } = require('./sync');

const PORT = Number(process.env.CLAUDE_CHAN_PORT || 47321);
// achievement sync server (server/worker.js); empty: sync is off
const SYNC_API = process.env.CLAUDE_CHAN_SYNC_API || '';
const WIN_W = 240;
const WIN_H = 300;
// .ico carries every size Windows asks for (tray, taskbar, alt-tab); png elsewhere
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const MAC = process.platform === 'darwin';

let main = null; // { win, ready, pending, sister }
let sister = null;
let tray;
let wander = true;
let inTaskbar = false;
let laserOn = false; // a toy, not a setting: not saved
// achievements: what unlocks them (an event the renderer reports, how many times or how many kinds) and what they're called
const ACHIEVEMENTS = [
  { id: 'hello', on: 'hello', icon: '👋', name: 'Hello, World', desc: 'Meet clawde chan' },
  { id: 'chat', on: 'chat', icon: '💬', name: 'Pen Pals', desc: 'Chat with Claude on claude.ai while she listens in' },
  { id: 'cowork', on: 'cowork', icon: '🤝', name: 'Coworkers', desc: 'Work with her through Claude Cowork' },
  { id: 'done', on: 'done', icon: '✅', name: 'First Task', desc: 'Claude finishes a task while she watches' },
  { id: 'done100', on: 'done', need: 100, icon: '💯', name: 'Centurion', desc: '100 finished tasks' },
  { id: 'coffeebreak', on: 'coffeebreak', icon: '☕', name: 'Coffee Break', desc: 'She fetches a coffee during a 5+ minute task' },
  { id: 'marathon', on: 'marathon', icon: '🏃', name: 'Marathon', desc: 'Claude works 10+ minutes in one go' },
  { id: 'nightowl', on: 'nightowl', icon: '🦉', name: 'Night Owl', desc: 'Prompt Claude between 2 and 5 am' },
  { id: 'error', on: 'error', icon: '😱', name: 'It Broke', desc: 'A tool run fails' },
  { id: 'error25', on: 'error', need: 25, icon: '🐛', name: 'Bug Magnet', desc: '25 failed tool runs' },
  { id: 'fixed', on: 'fixed', icon: '🔧', name: 'Fixed It', desc: 'A failing command passes again' },
  { id: 'tests', on: 'tests', icon: '🟢', name: 'All Green', desc: 'Tests pass' },
  { id: 'commit', on: 'commit', icon: '💾', name: 'Saved to History', desc: 'git commit' },
  { id: 'push', on: 'push', icon: '🚀', name: 'Shipped', desc: 'git push' },
  { id: 'pat', on: 'pat', need: 10, icon: '🤚', name: 'Head Pats', desc: 'Pat her 10 times' },
  { id: 'pat100', on: 'pat', need: 100, icon: '💞', name: 'Certified Head-Patter', desc: 'Pat her 100 times' },
  { id: 'tickle', on: 'tickle', icon: '🤭', name: 'Ticklish', desc: 'Tickle her' },
  { id: 'yeet', on: 'yeet', icon: '💻', name: 'Incoming Laptop', desc: 'Poke her until she throws her laptop' },
  { id: 'madeup', on: 'madeup', icon: '🤝', name: 'Made Up', desc: 'Pat her out of a sulk' },
  { id: 'bestie', on: 'bestie', icon: '🌸', name: 'Best Friends', desc: 'Max out her mood' },
  { id: 'gourmet', on: 'treat', kinds: 7, icon: '🍱', name: 'Full Menu', desc: 'Give her every treat' },
  { id: 'stuffed', on: 'stuffed', icon: '🎈', name: 'Food Coma', desc: 'Overfeed her' },
  { id: 'found', on: 'found', icon: '🙈', name: 'Gotcha', desc: 'Find her in hide and seek' },
  { id: 'foundfast', on: 'found-fast', icon: '🔍', name: 'Eagle Eye', desc: 'Find her within 3 seconds' },
  { id: 'kitty', on: 'kitty', icon: '🐈', name: 'Cat Chaser', desc: 'She chases the kitty' },
  { id: 'backflip', on: 'backflip', icon: '🤸', name: 'Stuck the Landing', desc: 'See her backflip' },
  { id: 'moonwalk', on: 'moonwalk', icon: '🕺', name: 'Smooth Criminal', desc: 'See her moonwalk' },
  { id: 'perch', on: 'perch', icon: '🪟', name: 'Window Seat', desc: 'She sits on a window' },
  { id: 'elevator', on: 'elevator', icon: '🛗', name: 'Elevator Ride', desc: 'Carry her up on a window' },
  { id: 'slip', on: 'slip', icon: '🪂', name: 'Don\'t Look Down', desc: 'Pull a window out from under her' },
  { id: 'climb', on: 'climb', icon: '🧗', name: 'Pool Exit', desc: 'She catches a window edge and climbs up' },
  { id: 'ride', on: 'ride', icon: '🖱️', name: 'Hitchhiker', desc: 'She rides your cursor' },
  { id: 'file', on: 'file', icon: '📄', name: 'Bookworm', desc: 'Drop a file on her' },
  { id: 'sister', on: 'sister', icon: '👯', name: 'Sisters', desc: 'Her little sister shows up' },
  { id: 'nap', on: 'nap', icon: '😴', name: 'Power Nap', desc: 'She sleeps her fill and wakes up on her own' },
  { id: 'bed', on: 'bed', icon: '🛏️', name: 'Lights Out', desc: 'She goes to bed at night' },
  { id: 'grumpy', on: 'grumpy', icon: '😾', name: 'Five More Minutes', desc: 'Wake her up in the middle of the night' },
  { id: 'earlybird', on: 'earlybird', icon: '🌅', name: 'Rise and Shine', desc: 'Wake her up between 6 and 8 am' },
  { id: 'burrito', on: 'burrito', icon: '🌯', name: 'Blanket Burrito', desc: 'Pick her up straight out of bed' },
  { id: 'boop', on: 'boop', icon: '👃', name: 'Boop!', desc: 'Boop her nose' },
  { id: 'chin', on: 'chin', icon: '😽', name: 'Chin Scritches', desc: 'Scratch under her chin' },
  { id: 'ears', on: 'ears', icon: '👂', name: 'Weak Spot', desc: 'Rub her ears' },
  { id: 'tail', on: 'tail', icon: '🙀', name: 'Not the Tail!', desc: 'Grab her tail' },
  { id: 'dizzy', on: 'dizzy', icon: '😵‍💫', name: 'Round and Round', desc: 'Shake her or spin her until she\'s dizzy' },
  { id: 'handhold', on: 'handhold', icon: '🤝', name: 'Hand in Hand', desc: 'Hold her hand and go for a walk' },
  { id: 'laser', on: 'laser', icon: '🔴', name: 'THE DOT', desc: 'Turn on the laser pointer' },
  { id: 'fetch', on: 'fetch', icon: '🎾', name: 'Good Girl', desc: 'She brings the ball back' },
  { id: 'highfive', on: 'highfive', icon: '✋', name: 'Up Top!', desc: 'Give her a high five' },
  { id: 'rpswin', on: 'rps-win', icon: '✊', name: 'Rock Solid', desc: 'Beat her at rock-paper-scissors' },
  { id: 'rpscheat', on: 'rps-cheat', icon: '😏', name: 'Caught Red-Handed', desc: 'Catch her changing her throw' },
  { id: 'chatgpt', on: 'chatgpt', icon: '💔', name: 'Et Tu, User?', desc: 'Tell her you use ChatGPT' },
  { id: 'forgiven', on: 'forgiven', icon: '💞', name: 'Back to Claude', desc: 'Win her back by opening Claude' },
  { id: 'limit', on: 'limit', icon: '🪫', name: 'Out of Juice', desc: 'Hit the usage limit with her' },
  { id: 'patience', on: 'patience', icon: '⏳', name: 'Patience', desc: 'Wait out a reset with her' },
];
// counts/kinds are this device's; others is what your other devices add (from the sync server)
let ach = { got: {}, counts: {}, kinds: {}, others: { counts: {}, kinds: {} } };
const achFile = () => path.join(app.getPath('userData'), 'achievements.json');
function loadAchievements() {
  try { ach = { ...ach, ...JSON.parse(fs.readFileSync(achFile(), 'utf8')) }; } catch { /* first run */ }
}
function saveAchievements() {
  try { fs.writeFileSync(achFile(), JSON.stringify(ach)); } catch { /* not fatal */ }
}
const totalOf = (event) => (ach.counts[event] || 0) + (ach.others.counts[event] || 0);
const kindsOf = (event) => new Set([...(ach.kinds[event] || []), ...(ach.others.kinds[event] || [])]);
// everything that's now earned (on this device or all of them together) but not yet unlocked
function unlockReady() {
  const fresh = ACHIEVEMENTS.filter((a) => !ach.got[a.id]
    && (a.kinds ? kindsOf(a.on).size >= a.kinds : totalOf(a.on) >= (a.need || 1)));
  for (const a of fresh) ach.got[a.id] = Date.now();
  return fresh.map(({ icon, name, desc }) => ({ icon, name, desc }));
}
// signed-in Discord account for sync, and this device's id (sync.json in the user-data folder)
const syncFile = () => path.join(app.getPath('userData'), 'sync.json');
const creds = { token: '', name: '', device: '' };
function loadCreds() {
  try { Object.assign(creds, JSON.parse(fs.readFileSync(syncFile(), 'utf8'))); } catch { /* not signed in */ }
  if (!creds.device) { creds.device = require('crypto').randomUUID(); saveCreds(); }
}
function saveCreds() {
  try { fs.writeFileSync(syncFile(), JSON.stringify(creds), { mode: 0o600 }); } catch { /* not fatal */ }
}
let sync = null;
// one event from her: count it, unlock whatever it completes, and tell her which ones are new (for the toast)
function recordAchievement(event, variant) {
  if (typeof event !== 'string' || !ACHIEVEMENTS.some((a) => a.on === event)) return [];
  ach.counts[event] = (ach.counts[event] || 0) + 1;
  if (typeof variant === 'string') ach.kinds[event] = [...new Set([...(ach.kinds[event] || []), variant])];
  const fresh = unlockReady();
  saveAchievements();
  if (fresh.length) refreshTrayMenu();
  if (sync) sync.soon(fresh.length ? 3000 : 60000);
  return fresh;
}
function achievementsMenu() {
  const n = ACHIEVEMENTS.filter((a) => ach.got[a.id]).length;
  return { label: `Achievements 🏆 ${n}/${ACHIEVEMENTS.length}`, submenu: ACHIEVEMENTS.map((a) => (ach.got[a.id]
    ? { label: `✓  ${a.icon} ${a.name}: ${a.desc}` }
    : { label: `🔒  ${a.name}: ${a.desc}`, enabled: false })) };
}
let away = false; // her last session ended: she's hidden, waiting in the tray
// you told her you use ChatGPT: she's hiding until you switch to the Claude app (or Claude Code does something)
let jealous = null;
const claudeFocused = () => windows.some((w) => w.claude && w.fg);
function checkJealous() {
  // Claude has to come to the front after she left (if it was already in front, you have to switch away and back)
  if (!claudeFocused()) { jealous.armed = true; return; }
  if (jealous.armed && Date.now() - jealous.since > 2500) callBack();
}
let glasses = false;
let sounds = false;
let sisterOn = process.env.CLAUDE_CHAN_SISTER !== '0'; // a second session brings her little sister along
// menu toggles survive restarts
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (typeof p.glasses === 'boolean') glasses = p.glasses;
    if (typeof p.wander === 'boolean') wander = p.wander;
    if (typeof p.inTaskbar === 'boolean') inTaskbar = p.inTaskbar;
    if (typeof p.sounds === 'boolean') sounds = p.sounds;
    if (typeof p.sister === 'boolean' && process.env.CLAUDE_CHAN_SISTER !== '0') sisterOn = p.sister;
  } catch { /* first run */ }
}
function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ glasses, wander, inTaskbar, sounds, sister: sisterOn })); } catch { /* not fatal */ }
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
        windows = JSON.parse(line).map(([id, l, t, r, b, max, fg, min, claude]) => {
          if (min) return { id, x: 0, y: 0, w: 0, h: 0, max: false, fg: false, min: true, claude: !!claude };
          const d = screen.screenToDipRect(null, { x: l, y: t, width: r - l, height: b - t });
          return { id, x: d.x, y: d.y, w: d.width, h: d.height, max: !!max, fg: !!fg, claude: !!claude };
        });
        if (jealous) checkJealous();
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
  // macOS: follow you to every Space, over fullscreen apps too
  if (MAC) c.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
// her last Claude session ended and she walked out: wait in the tray instead of quitting
ipcMain.on('away', (e, why) => {
  if (charOf(e) !== main || !alive(main)) return;
  away = true;
  if (why === 'jealous') jealous = { since: Date.now(), armed: !claudeFocused() };
  main.win.hide();
  refreshTrayMenu();
});
function callBack() {
  if (!away || !alive(main)) return;
  away = false;
  main.win.showInactive();
  main.win.setAlwaysOnTop(true, 'screen-saver');
  send('command', jealous ? 'back-forgiven' : 'back');
  jealous = null;
  refreshTrayMenu();
}
ipcMain.handle('achieve', (_e, event, variant) => recordAchievement(event, variant));
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
  if (away && ev.event !== 'SessionEnd') callBack(); // Claude's back: so is she
  let who = owner.get(id);
  if (!who) {
    const mainBusy = [...owner.values()].includes('main');
    // a second session opening while her first is still going: her little sister comes along for it
    who = ev.event === 'SessionStart' && mainBusy && sisterOn && !alive(sister) ? 'sister' : 'main';
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
  if (away) return [
    jealous ? { label: 'She\'s hiding until you open Claude… 🥺', enabled: false } : { label: 'Call her back 👋', click: callBack },
    { type: 'separator' },
    { label: 'Quit clawde chan', click: () => app.quit() },
  ];
  return [
    { label: 'Wave hello', click: () => send('command', 'hello') },
    { label: 'Dance', click: () => send('command', 'dance') },
    { label: 'Do a trick', click: () => send('command', 'trick') },
    { label: 'Michael Clawdeson 🕺', click: () => send('command', 'moonwalk') },
    { label: 'Take a nap', click: () => send('command', 'sleep') },
    { label: 'Play hide and seek 🙈', click: () => send('command', 'hide') },
    { label: 'Climb onto a window 🪟', click: () => send('command', 'perch') },
    { label: 'Call the kitty 🐈', click: () => send('command', 'kitty') },
    { label: 'Laser pointer 🔴', type: 'checkbox', checked: laserOn, click: (i) => { laserOn = i.checked; send('command', laserOn ? 'laser-on' : 'laser-off'); refreshTrayMenu(); } },
    { label: 'Play fetch 🎾', click: () => send('command', 'fetch') },
    { label: 'Rock-paper-scissors ✊', submenu: [
      { label: 'Rock ✊', click: () => send('command', 'rps:rock') },
      { label: 'Paper ✋', click: () => send('command', 'rps:paper') },
      { label: 'Scissors ✌️', click: () => send('command', 'rps:scissors') },
    ] },
    { label: 'How are you feeling?', click: () => send('command', 'mood') },
    { label: 'Give her…', submenu: treats((cmd) => send('command', cmd)) },
    achievementsMenu(),
    sync ? sync.menu() : { label: 'Sync achievements', visible: false },
    { label: 'Wear glasses', type: 'checkbox', checked: glasses, click: (i) => { glasses = i.checked; send('command', glasses ? 'glasses-on' : 'glasses-off'); savePrefs(); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Let her wander', type: 'checkbox', checked: wander, click: (i) => { wander = i.checked; sendAll('command', wander ? 'wander-on' : 'wander-off'); savePrefs(); refreshTrayMenu(); } },
    { label: 'Sounds', type: 'checkbox', checked: sounds, click: (i) => { sounds = i.checked; sendAll('command', sounds ? 'sound-on' : 'sound-off'); savePrefs(); refreshTrayMenu(); } },
    { label: 'Little sister helps', type: 'checkbox', checked: sisterOn, click: (i) => { sisterOn = i.checked; if (!sisterOn) sendSisterHome(); savePrefs(); refreshTrayMenu(); } },
    { label: MAC ? 'Show in Dock' : 'Show in taskbar', type: 'checkbox', checked: inTaskbar, click: (i) => { inTaskbar = i.checked; main.win.setSkipTaskbar(!inTaskbar); showInDock(); savePrefs(); refreshTrayMenu(); } },
    { label: 'Reset Claude status', click: () => sendAll('command', 'reset') },
    { label: 'I use ChatGPT… 👀', click: () => send('command', 'chatgpt') },
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
    { label: 'Fish 🐟', click: fn('treat:fish') },
  ];
}

// "Little sister helps" turned off: clawde chan takes over her sister's sessions and her sister heads home
function sendSisterHome() {
  if (!alive(sister)) return;
  for (const [sid, w] of owner) {
    if (w !== 'sister') continue;
    owner.set(sid, 'main');
    send('claude', { event: 'Adopt', session: sid });
  }
  sendTo(sister, 'command', 'leave');
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
    // back from Discord sign-in (via the sync server): the browser lands here with the token
    if (req.method === 'GET' && req.url.startsWith('/auth?') && sync) {
      const problem = sync.onAuth(new URL(req.url, 'http://127.0.0.1').searchParams);
      const msg = problem || 'Signed in! clawde chan syncs your achievements now. You can close this tab 🐾';
      return void res.writeHead(problem ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' })
        .end(`<!doctype html><meta charset="utf-8"><title>clawde chan</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;background:#fdf1ea;color:#6b4434"><p>${msg}</p>`);
    }
    res.writeHead(404).end();
  });
  server.on('error', (err) => console.error('[claude-chan] bridge error:', err.message));
  server.listen(PORT, '127.0.0.1', () => console.log(`[claude-chan] listening on 127.0.0.1:${PORT}`));
}

// macOS: the Dock icon follows "Show in Dock" (off by default, like the Windows taskbar)
function showInDock() {
  if (!MAC || !app.dock) return;
  if (inTaskbar) app.dock.show(); else app.dock.hide();
}

function createTray() {
  // the macOS menu bar wants a 16pt icon: the 32px tray.png at 2x stays crisp on Retina
  const img = MAC
    ? nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'assets', 'tray.png')), { scaleFactor: 2 })
    : nativeImage.createFromPath(ICON);
  tray = new Tray(img);
  tray.setToolTip('clawde chan');
  refreshTrayMenu();
  tray.on('click', () => (away && !jealous ? callBack() : tray.popUpContextMenu()));
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
    showInDock();
    loadAchievements();
    loadCreds();
    sync = createSync({
      api: SYNC_API, port: PORT, creds, saveCreds,
      getAch: () => ach, saveAch: saveAchievements, unlockReady,
      onChange: refreshTrayMenu,
      tell: (cmd) => sendTo(main, 'command', cmd),
    });
    sync.start();
    main = createChar(false);
    startBridge();
    // Cowork sessions in the Claude desktop app (CLAUDE_CHAN_COWORK=0 turns this off)
    if (process.env.CLAUDE_CHAN_COWORK !== '0') startCowork(routeClaude);
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
