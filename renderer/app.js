// claude-chan behavior: wandering, drag & toss physics, and Claude Code status reactions.
const api = window.chan;
const charEl = document.getElementById('char');
const hit = document.getElementById('hit');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const POSES = ['idle', 'walk', 'work', 'wait', 'cheer', 'hello', 'dance', 'sleep', 'drag', 'fall', 'flop', 'twirl', 'backflip', 'achoo', 'lounge', 'topple', 'yeet', 'exit', 'sulk', 'hop', 'snack', 'megane', 'peek', 'pullout', 'stalk', 'pounce', 'perch', 'stuffed', 'hang', 'climb'];

// Goofy tricks she does now and then: [pose, duration ms, lines]
const TRICKS = [
  ['flop', 2800, ['Waah—!', '*trips over nothing*', 'I meant to do that…']],
  ['twirl', 1300, ['Weee~!', 'Spin spin~', 'Ta-daa!']],
  ['backflip', 1300, ['Hup!', 'Backflip!', 'Watch this!']],
  ['achoo', 1800, ['Ha… ha… HACHOO!', 'Hachoo! Sorry~', '*sniff*']],
];
const LOUNGE_AFTER_MS = 5 * 60 * 1000; // sits down and spaces out
const GLASSES = 'round'; // work glasses: 'round' | 'half' | 'square'
const SLEEP_AFTER_MS = 60 * 60 * 1000; // falls asleep
const TOPPLE_AFTER_MS = 30 * 60 * 1000; // asleep this long: tips over and wakes up
const STALE_SESSION_MS = 15 * 60 * 1000;
const NIGHT_SLEEP_AFTER_MS = 20 * 60 * 1000; // after 23:00 she nods off sooner
const BREAK_AFTER_MS = 60 * 60 * 1000; // an hour of coding: water break
const BREAK_RESET_MS = 20 * 60 * 1000; // a pause this long counts as a break already
const FULL_AFTER = 4; // treats within FULL_WINDOW_MS before she's stuffed
const FULL_WINDOW_MS = 10 * 60 * 1000;
const FULL_FOR_MS = 3 * 60 * 1000;

const state = {
  x: 0, y: 0, w: 240, h: 300,
  area: null,
  vx: 0, vy: 0,
  dragging: false, falling: false,
  walkTarget: null, dir: 1,
  wander: true,
  action: null, actionUntil: 0, happyUntil: 0, // short one-off pose (cheer, hello, dance, poke)
  napping: false,
  leaving: false,
  sulkUntil: 0, sulkPats: 0,
  laptopGone: false, yeetAt: 0, // she threw it: the next work session starts with a spare from her pocket
  hideSeek: null, // { phase: "going" | "hidden", side, since, hintAt }
  bugTool: null, bugAt: 0, panicUntil: 0, // Claude's last failed tool, for the "fixed it!" moment
  pouncing: false, pouncedAt: 0,
  codingSince: 0, lastClaudeAt: 0, offering: false,
  perch: null, leap: null, // perched on a window: { id, dx, until }
  treats: [], fullUntil: 0,
  chase: null, // the kitty: { dir, kx, phase, until }
  glassesUntil: 0, alwaysGlasses: false,
  asleepSince: 0,
  lastActivity: Date.now(),
  nextIdeaAt: Date.now() + 4000,
};

// ---------- Claude Code sessions ----------
const sessions = new Map(); // session id -> { status, tool, at }

const TOOL_LINES = [
  [/^(Bash|PowerShell)$/, 'Running commands…'],
  [/^Read$/, 'Reading files…'],
  [/^(Grep|Glob|LS)$/, 'Searching the code…'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'Writing code…'],
  [/^(WebFetch|WebSearch)$/, 'Browsing the web…'],
  [/^(Agent|Task)$/, 'Calling in helpers…'],
  [/^(TodoWrite|.*update_plan)$/, 'Making a plan…'],
  [/browser|Browser|chrome/, 'Clicking around…'],
  [/^mcp__/, 'Using tools…'],
];
const TOOL_KINDS = [
  [/^(Bash|PowerShell)$/, 'term'],
  [/^(Read|NotebookRead)$/, 'read'],
  [/^(Grep|Glob|LS)$/, 'search'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'edit'],
  [/^(WebFetch|WebSearch)$/, 'web'],
  [/browser|Browser|chrome|computer/, 'web'],
  [/^(Agent|Task)$/, 'agent'],
  [/(TodoWrite|update_plan)$/, 'plan'],
];
const BADGE_KINDS = ['think', 'term', 'read', 'search', 'edit', 'web', 'agent', 'plan', 'gear', 'ask', 'done'];
const toolKind = (tool) => (tool ? (TOOL_KINDS.find(([re]) => re.test(tool)) || [, 'gear'])[1] : 'think');
// the current Claude turn, for the badge's tool count and timer
const turn = { start: 0, tools: 0, doneUntil: 0, doneText: '' };
const toolLine = (tool) => (TOOL_LINES.find(([re]) => re.test(tool || '')) || [, 'Working on it…'])[1];

function claudeStatus() {
  const now = Date.now();
  let status = 'idle';
  let tool;
  for (const [id, s] of sessions) {
    if (s.status === 'working' && now - s.at > STALE_SESSION_MS) { sessions.delete(id); continue; }
    if (s.status === 'waiting') return { status: 'waiting', tool: s.tool };
    if (s.status === 'working') { status = 'working'; tool = s.tool; }
  }
  return { status, tool };
}

// Claude changes status while you're holding her up in the air
function airReact(event) {
  if (event === 'UserPromptSubmit') { setFace('fired', 1800); say(pick(['Coding mid-air?! Okay~ 💻', 'I can type from up here!', 'Hold me steady, I\'m working!']), 2400); }
  if (event === 'Notification') { setFace('nervous', 2500); say('Put me down! Claude needs you! 👉', 0, true); }
  if (event === 'Stop' && claudeStatus().status === 'idle') { setFace('star', 2200); flash('airjoy', 900); say(pick(['Done! ✨ …can I come down now?', 'Finished! Up here! ✨', 'Ta-da~ (from the sky)']), 3000); }
}

api.onClaude((ev) => {
  const id = ev.session || 'default';
  const at = Date.now();
  if (ev.event === 'UserPromptSubmit' && (!state.codingSince || at - state.lastClaudeAt > BREAK_RESET_MS)) state.codingSince = at;
  state.lastClaudeAt = at;
  if (state.hideSeek && /UserPromptSubmit|Notification/.test(ev.event)) endHideSeek();
  if (state.dragging) queueMicrotask(() => airReact(ev.event));
  const prev = sessions.get(id);
  wake();
  switch (ev.event) {
    case 'SessionStart':
      if (state.leaving) cancelLeave();
      sessions.set(id, { status: 'idle', at: Date.now() });
      doAction('hello', 2500);
      say('Hi! Let\'s build something ✨', 3000);
      morningCoffee();
      break;
    case 'UserPromptSubmit':
      sessions.set(id, { status: 'working', tool: null, at: Date.now() });
      turn.start = Date.now();
      turn.tools = 0;
      turn.errors = 0;
      turn.doneUntil = 0;
      if (Math.random() < 0.4) {
        setFace('fired', 2000);
        say(pick(['Let\'s go! 🔥', 'Leave it to me! 🔥', 'Yosh!']), 2500);
      } else {
        setFace('think', 1800);
        say(pick(['On it!', 'Okay~ thinking…', 'Hmm, let me see…']), 2500);
      }
      break;
    case 'PreToolUse':
      sessions.set(id, { status: 'working', tool: ev.tool, at: Date.now() });
      if (!turn.start) turn.start = Date.now();
      turn.tools++;
      if (!prev || prev.tool !== ev.tool || prev.status !== 'working') say(toolLine(ev.tool), 4000);
      break;
    case 'PostToolUseFailure':
      turn.errors = (turn.errors || 0) + 1;
      state.bugTool = ev.tool;
      state.bugAt = Date.now();
      oops(turn.errors);
      break;
    case 'PostToolUse':
      // the command that failed earlier just went through
      if (state.bugTool && ev.tool === state.bugTool && Date.now() - state.bugAt < 15 * 60 * 1000) fixedIt();
      break;
    case 'Notification': {
      sessions.set(id, { status: 'waiting', tool: prev?.tool, at: Date.now() });
      const msg = String(ev.message || '');
      const line = /permission/i.test(msg) ? 'Can I do this? Need your OK!'
        : /waiting|idle/i.test(msg) ? 'Psst… your turn~'
        : msg.slice(0, 60) || 'Hey! I need you 👋';
      say(line, 0, true);
      setFace(/permission/i.test(msg) ? 'nervous' : 'surprised', 2000);
      break;
    }
    case 'Stop':
      sessions.set(id, { status: 'idle', at: Date.now() });
      if (claudeStatus().status === 'idle') {
        const took = turn.start ? Date.now() - turn.start : 0;
        turn.doneUntil = Date.now() + 2600;
        turn.doneText = (turn.tools ? '⚙' + turn.tools + ' · ' : '') + clock(took);
        turn.start = 0;
        // long run: she's earned a coffee
        if (took > 3 * 60 * 1000) setTimeout(() => { if (claudeStatus().status === 'idle' && !state.action) snack('coffee', 'Phew… coffee break ☕'); }, 2600);
        doAction('cheer', 2200);
        const f = Math.random();
        if (f < 0.4) setFace('star', 2200); else if (f < 0.6) setFace('uwu', 2200);
        say(turn.errors ? pick(['Done! We beat those errors ✨', 'Finished… after a fight! 💪', 'Ta-da~ bugs defeated!'])
          : isNight() && Math.random() < 0.35 ? pick(['Done! …now go to sleep? 🌙', 'All finished~ it\'s late, you know 🌙'])
          : pick(['Done! ✨', 'All finished!', 'Ta-da~!', 'Your turn!']), 5000);
        state.bugTool = null;
        // an hour of this: time for a water break
        if (state.codingSince && Date.now() - state.codingSince > BREAK_AFTER_MS) { state.codingSince = Date.now(); setTimeout(breakReminder, 2800); }
      }
      break;
    case 'SessionEnd':
      sessions.delete(id);
      if (sessions.size === 0) { leave(); break; }
      say('Bye bye~', 2500);
      doAction('hello', 1800);
      break;
  }
});

// a cookie from the menu: three bites, crumbs, heart eyes (and all is forgiven)
// what she says and how she reacts for each treat
const TREATS = {
  cookie: { face: 'nom', hello: ['A cookie! ✨', 'For me?!', 'Snack time~'], during: 'Nom nom nom~',
    after: () => { setFace('heart', 1800); say(pick(['Thanks for the snack! ♡', 'Delicious~ ♡', 'More? ♡']), 2000); popHearts(2); } },
  coffee: { face: 'sip', hello: ['Coffee! ☕', 'Ooh, coffee~'], during: '*sip* … *sip*',
    after: () => { setFace('fired', 2000); putOnGlasses(30000); say(pick(['Caffeine get! ⚡', 'Fully charged! ⚡ Let\'s code!']), 2200); } },
  boba: { face: 'sip', hello: ['BOBA!! 🧋', 'Boba time~'], during: '*slurp* ♪',
    after: () => { setFace('heart', 1800); say(pick(['Boba is life~ 🧋♡', 'The pearls are so chewy~ ♡']), 2200); popHearts(3); } },
  matcha: { face: 'sip', hello: ['Matcha~ 🍵', 'Tea time~'], during: '*sip*… ahh~',
    after: () => { setFace('uwu', 2400); say(pick(['So calming~ 🍵', 'Ahh~ peaceful…']), 2400); } },
  water: { face: 'sip', hello: ['Water! 💧', 'Hydration time~'], during: '*gulp gulp*',
    after: () => { setFace('uwu', 2200); say(pick(['Refreshing~ 💧', 'Ahh~ much better 💧']), 2200); } },
  milk: { face: 'sip', hello: ['Milk! 🥛', 'Gotta grow tall~'], during: '*gulp gulp*',
    after: () => { setFace('milk', 3000); say(pick(['Ehehe~ milk mustache 🥛', 'Do I have something on my face?']), 3000); } },
};
const popHearts = (n) => { for (let i = 0; i < n; i++) setTimeout(spawnHeart, i * 140); };
const ITEMS = Object.keys(TREATS);

function snack(item = 'cookie', line) {
  if (state.leaving || state.dragging) return;
  const t = TREATS[item] || TREATS.cookie;
  const now = Date.now();
  if (item !== 'water') {
    if (now < state.fullUntil) {
      setFace('xx', 1600);
      say(pick(['N-no more… I\'m so full~', 'I can\'t… not one more bite… 😵', '*shakes head* …later…']), 2000);
      return;
    }
    state.treats = state.treats.filter((t0) => now - t0 < FULL_WINDOW_MS);
    state.treats.push(now);
    if (state.treats.length >= FULL_AFTER) setTimeout(stuffed, 3300);
  }
  const forgiven = sulking();
  state.sulkUntil = 0;
  for (const i of ITEMS) charEl.classList.toggle('item-' + i, i === item);
  charEl.classList.remove('offering');
  charEl.classList.toggle('drinking', item !== 'cookie');
  charEl.classList.toggle('sipstraw', item === 'boba');
  doAction('snack', 3200);
  setFace(t.face, 3200);
  say(line || (forgiven ? '…for me? …fine. Forgiven ♡' : pick(t.hello)), 1200);
  setTimeout(() => say(t.during, 1600), 1200);
  setTimeout(t.after, 3200);
}

// ---------- hide and seek ----------
const HIDE_GIVE_UP_MS = 90 * 1000;
function startHideSeek() {
  if (state.leaving || state.dragging || state.hideSeek) return;
  // up on a window or in the air: come down first, then play
  if (state.perch || state.leap || state.falling) {
    state.hideAfterLanding = true;
    say('Hide and seek? Coming down!', 1500);
    if (state.perch) hopDown();
    return;
  }
  if (state.chase) { state.chase = null; kittyEl.classList.remove('on'); }
  state.action = null;
  const side = pick(['left', 'right', 'bottom']);
  state.hideSeek = { phase: 'going', side, since: Date.now(), hintAt: 0 };
  say(pick(['Count to 10! No peeking~ 🙈', 'Hide and seek! Close your eyes~', 'Ready or not… I\'m hiding! 🙈']), 2500);
  if (side === 'bottom') return void setTimeout(beginHide, 1200);
  // run to the edge of the screen first
  const a = state.area;
  state.walkTarget = side === 'right' ? a.x + a.width - state.w : a.x;
}
function beginHide() {
  const h = state.hideSeek;
  if (!h) return;
  h.phase = 'hidden';
  h.since = Date.now();
  h.hintAt = Date.now() + 12000 + Math.random() * 8000;
  hideBubble();
  charEl.classList.add('hiding', 'hide-' + h.side);
  document.body.classList.add('grip-' + h.side);
}
function updateHideSeek(now) {
  const h = state.hideSeek;
  if (h.phase !== 'hidden') return;
  if (now - h.since > HIDE_GIVE_UP_MS) {
    endHideSeek();
    setFace('smug', 2400);
    say(pick(['You\'re bad at this~ 😝', 'I was right here the whole time!', 'Giving up? Fufu~']), 3000);
    return;
  }
  if (now > h.hintAt) {
    h.hintAt = now + 15000 + Math.random() * 10000;
    say(pick(['*giggle*', 'hehe…', '…', '*tries not to laugh*']), 1500);
  }
}
function found() {
  const secs = Math.round((Date.now() - state.hideSeek.since) / 1000);
  endHideSeek();
  doAction('cheer', 1600);
  setFace('star', 2000);
  say(secs <= 3 ? 'Eh?! Already?! 😳' : `You found me! ✨ (${secs}s)`, 2600);
}
function endHideSeek() {
  const h = state.hideSeek;
  state.hideSeek = null;
  if (h) charEl.classList.remove('hide-' + h.side);
  document.body.classList.remove('grip-left', 'grip-right', 'grip-bottom');
  if (h && h.phase === 'going') state.walkTarget = null;
  setTimeout(() => { if (!state.hideSeek) charEl.classList.remove('hiding'); }, 800);
}

// ---------- Claude hit an error / fixed it ----------
function oops(n) {
  state.panicUntil = Date.now() + 8000;
  flash('jolt', 450);
  setFace('shock', 900);
  setTimeout(() => setFace(n >= 3 ? 'cry' : 'nervous', 6000), 900);
  say(n >= 3 ? pick(['Why won\'t it work?! 😭', 'Another one?! T_T', 'The bugs keep coming…!'])
    : pick(['Eek! An error! 😱', 'Uh-oh… red text!', 'Th-that\'s not supposed to happen!', 'Huh?! It broke?!']), 2600);
}
function fixedIt() {
  state.bugTool = null;
  state.panicUntil = 0;
  setFace('star', 2400);
  flash('sparkle', 1600);
  popHearts(2);
  say(pick(['Fixed it! ✨', 'It works now! 🎉', 'Bug squashed! 🐛💥', 'Green! Yatta~ ✨']), 2600);
}

// ---------- pounce on a still cursor ----------
function feetY() { const m = svgRoot.getScreenCTM(); return state.y + m.d * 231 + m.f; }
function updatePounce(now) {
  if (!state.wander || state.dragging || state.falling || state.action || state.perch || state.leap || state.chase || state.hideSeek || state.leaving || state.offering) return;
  if (state.walkTarget != null || sulking() || claudeStatus().status !== 'idle' || now - state.lastActivity > LOUNGE_AFTER_MS) return;
  const still = now - cursor.movedAt;
  if (still < 1200 || still > 6000 || cursor.movedAt <= state.pouncedAt) return;
  const dx = cursor.x - (state.x + state.w / 2);
  const fy = feetY();
  if (Math.abs(dx) < 70 || Math.abs(dx) > 260 || cursor.y < fy - 120 || cursor.y > fy + 15) return;
  state.pouncedAt = now;
  if (Math.random() < 0.4) return; // not every time
  state.dir = Math.sign(dx);
  charEl.style.setProperty('--pdir', state.dir);
  doAction('stalk', 1300);
  setFace('cat', 1500);
  say(pick(['…!', '*wiggle wiggle*', 'Target locked~', 'Nya…']), 1300);
  setTimeout(() => {
    if (state.dragging || state.falling || state.action !== 'stalk') return;
    const tx = clampX(cursor.x - state.w / 2);
    state.action = null;
    state.pouncing = true;
    state.vy = -10.8;
    state.vx = (tx - state.x) / 24;
    state.falling = true;
  }, 1300);
}
function landPounce() {
  state.pouncing = false;
  const near = Math.abs(cursor.x - (state.x + state.w / 2)) < 70 && Math.abs(cursor.y - feetY()) < 130;
  if (near) { setFace('star', 1800); say(pick(['Got it! ✨', 'Caught you~!', 'Gotcha! 🐾']), 2000); }
  else { setFace('surprised', 1500); say(pick(['Eh? Where did it go?', 'Missed…!', 'Hmph, too fast!']), 2000); }
}

// ---------- break reminder: an hour of coding, have some water ----------
function breakReminder() {
  if (state.leaving || state.dragging || state.action || claudeStatus().status !== 'idle') return;
  for (const i of ITEMS) charEl.classList.toggle('item-' + i, i === 'water');
  charEl.classList.add('drinking', 'offering');
  charEl.classList.remove('sipstraw');
  state.offering = true;
  doAction('snack', 6000);
  setFace('uwu', 6000);
  say(pick(['An hour of coding! Drink some water~ 💧', 'Break time! Here, water 💧', 'Stretch and hydrate~ 💧']), 6000);
  setTimeout(() => {
    if (!state.offering) return;
    state.offering = false;
    snack('water', 'No? Then I\'ll drink it~ 💧');
  }, 6000);
}
function takeWater() {
  state.offering = false;
  state.action = null;
  charEl.classList.remove('offering');
  setFace('heart', 2000);
  popHearts(3);
  say(pick(['Good job~ stay hydrated ♡', 'Ehehe~ drink it all! ♡']), 2400);
}

// ---------- time of day ----------
const isNight = () => { const h = new Date().getHours(); return h >= 23 || h < 5; };
function morningCoffee() {
  const d = new Date();
  if (d.getHours() < 5 || d.getHours() >= 10) return;
  const today = d.toDateString();
  try { if (localStorage.getItem('morning') === today) return; localStorage.setItem('morning', today); } catch { /* fine */ }
  setTimeout(() => { if (!state.action && claudeStatus().status === 'idle') snack('coffee', 'Good morning~ ☕'); }, 2800);
}
// the cap rides along on the walking (3/4) head too
(function capToSide() {
  const cap = document.getElementById('nightcap').cloneNode(true);
  cap.removeAttribute('id');
  cap.setAttribute('class', 'nightcap-side');
  cap.setAttribute('transform', 'matrix(0.771 0 0 1 35.4 0)');
  document.getElementById('sHead').appendChild(cap);
})();

// ---------- perching on window title bars ----------
let wins = [];
(async function pollWindows() {
  try { wins = (api.windows && await api.windows()) || []; } catch { wins = []; }
  if (state.perch) updatePerch();
  // quick while she's up on a window or in the air, so she rides along smoothly
  setTimeout(pollWindows, state.perch || state.falling || state.leap ? 120 : 500);
})();
// how far below the top of her window her seat (sitting) and her chin (hanging from an edge) are
function seatOffset() { const m = svgRoot.getScreenCTM(); return m.d * 214 + m.f; }
function handOffset() { const m = svgRoot.getScreenCTM(); return m.d * EDGE_HANG + m.f; }
const HANG_MS = 1000; // hanging behind the window, peeking over its edge
const CLIMB_MS = 1300; // pulling herself up and over, like out of a pool
const EDGE_HANG = 134; // svg y of the window edge while she hangs (just under her chin)
const EDGE_SIT = 214; // ...and once she's sitting on it
const ledgeEl = document.getElementById('ledge');
const ledgeL = document.getElementById('ledgeL');
const ledgeR = document.getElementById('ledgeR');
const frontOf = (i, x, y) => wins.slice(0, i).some((o) => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h);
function perchSpot() {
  const a = state.area;
  const mid = state.x + state.w / 2;
  let best = null;
  wins.forEach((w, i) => {
    if (w.min || w.max || w.w < 260 || w.y < a.y + 140 || w.y > a.y + a.height - 140 || w.x + w.w < a.x || w.x > a.x + a.width) return;
    const sx = Math.min(Math.max(mid, w.x + 60), w.x + w.w - 60);
    if (frontOf(i, sx, w.y)) return; // that bit of the bar is covered by a window in front
    const d = Math.abs(sx - mid) + Math.abs(w.y - state.y) * 0.3;
    if (!best || d < best.d) best = { w, sx, d };
  });
  return best;
}
function goPerch(asked) {
  if (state.perch || state.leap || state.dragging || state.falling || state.leaving || state.hideSeek || state.chase) return;
  if (claudeStatus().status !== 'idle') return;
  const spot = perchSpot();
  if (!spot) { if (asked) say(pick(['No windows to climb~', 'Hmm, nowhere to sit up there…']), 2000); return; }
  state.action = null;
  state.walkTarget = null;
  state.dir = Math.sign(spot.sx - (state.x + state.w / 2)) || state.dir;
  charEl.style.setProperty('--pdir', state.dir);
  say(pick(['Hup!', 'Up we go~', 'Climbing!']), 1200);
  const x1 = spot.sx - state.w / 2;
  const y1 = spot.w.y - seatOffset();
  state.leap = { x0: state.x, y0: state.y, x1, y1, t0: Date.now(), dur: 750, arc: 70 + Math.max(0, state.y - y1) * 0.25, win: spot.w };
}
function updateLeap(now) {
  const l = state.leap;
  const t = Math.min(1, (now - l.t0) / l.dur);
  state.x = l.x0 + (l.x1 - l.x0) * t;
  state.y = l.y0 + (l.y1 - l.y0) * t - l.arc * 4 * t * (1 - t);
  api.setPos(state.x, state.y);
  if (t < 1) return;
  state.leap = null;
  sitOn(l.win);
  if (state.hideAfterLanding) return void hopDown();
  flash('land', 350);
  setFace('cat', 1600);
  say('Nice view up here~ ✨', 2200);
}
// she's on window w: sitting, or (climb) still hanging from its edge
function sitOn(w, climb = false) {
  state.perch = { id: w.id, dx: state.x - w.x, wx: w.x, wy: w.y, ww: w.w, until: Date.now() + 40000 + Math.random() * 50000,
    moving: false, movedAt: 0, climb: climb ? { t0: Date.now(), stage: 'hang' } : null };
  state.falling = false;
  state.vx = state.vy = 0;
  placeOnPerch(Date.now());
}
// every frame: follow the window, and play the hang → climb → sit sequence
function placeOnPerch(now) {
  const p = state.perch;
  let off = seatOffset();
  if (p.climb) {
    const t = now - p.climb.t0;
    let edge = EDGE_HANG;
    if (t >= HANG_MS + CLIMB_MS) {
      p.climb = null;
      showLedge(null);
      flash('land', 350);
      setFace('uwu', 1800);
      say(pick(['Phew… made it! 😅', '*climbs up* …ta-da~', 'Hehe, nailed it~']), 2200);
    } else {
      if (t >= HANG_MS) {
        p.climb.stage = 'climb';
        const k = (t - HANG_MS) / CLIMB_MS;
        edge = EDGE_HANG + (EDGE_SIT - EDGE_HANG) * k * k * (3 - 2 * k);
      }
      const m = svgRoot.getScreenCTM();
      off = m.d * edge + m.f;
      showLedge(edge, m);
    }
  }
  const x = Math.min(Math.max(p.wx + p.dx, p.wx - state.w / 2 + 30), p.wx + p.ww - state.w / 2 - 30);
  const y = p.wy - off;
  if (Math.abs(x - state.x) > 0.3 || Math.abs(y - state.y) > 0.3) { state.x = x; state.y = y; api.setPos(x, y); }
}
function showLedge(edge, m) {
  if (edge == null) {
    svgRoot.style.clipPath = '';
    ledgeEl.classList.remove('on');
    return;
  }
  const b = svgRoot.getBoundingClientRect();
  svgRoot.style.clipPath = `inset(0 0 ${Math.max(0, b.height * (1 - (edge + 0.5) / 240))}px 0)`;
  // her own arms take over once the edge is down at hand height
  ledgeEl.classList.toggle('on', edge < 166);
  const y = m.d * edge + m.f;
  ledgeL.setAttribute('transform', `translate(${m.a * 78 + m.e} ${y})`);
  ledgeR.setAttribute('transform', `translate(${m.a * 122 + m.e} ${y})`);
}
// each window scan: did her window move, vanish, shrink away or fill the screen?
function updatePerch() {
  const p = state.perch;
  const w = wins.find((o) => o.id === p.id);
  if (!w) return fallOff('closed');
  if (w.min) return fallOff('min');
  if (w.max) return fallOff('max');
  const now = Date.now();
  const moved = Math.abs(w.x - p.wx) > 1 || Math.abs(w.y - p.wy) > 1;
  p.wx = w.x;
  p.wy = w.y;
  p.ww = w.w;
  if (moved) {
    // you're dragging her window around: hold on for dear life
    if (!p.moving) {
      p.from = { x: w.x, y: w.y };
      if (!p.climb) { setFace('shock', 60000); say(pick(['W-wait!! 😱', 'Whoa whoa whoa—!', 'Don\'t shake it!!', 'Earthquake?!']), 60000); }
    }
    p.moving = true;
    p.movedAt = now;
  } else if (p.moving && now - p.movedAt > 350) {
    // you let go of the window. Carried up: she's fine. Down or sideways: she slips off
    const dx = w.x - p.from.x;
    const dy = w.y - p.from.y;
    if (dy < -15 && -dy >= Math.abs(dx) * 0.6) {
      p.moving = false;
      setFace('uwu', 2000);
      say(pick(['Phew… a free elevator ride~', 'Going up~ ♪', 'Ooh, higher! Nice view~']), 2400);
    } else {
      fallOff('drag');
    }
  }
}
async function fallOff(kind) {
  const p = state.perch;
  if (!p) return;
  state.perch = null;
  showLedge(null);
  state.noCatchId = p.id; // she won't grab the window she just fell off
  state.pouncing = false;
  state.area = await api.workAreaAt(state.x + state.w / 2, state.y + state.h);
  if (kind === 'max') {
    // the window balloons to full screen and bounces her off
    state.vx = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 2);
    state.vy = -12;
    setFace('shock', 2600);
    say(pick(['Whoa! It got HUGE!', 'Kyaa— it\'s taking over the screen!', 'Hey! No room for me?!']), 2400);
  } else if (kind === 'min') {
    state.vx = 0;
    state.vy = 1;
    setFace('surprised', 2200);
    say(pick(['Eh?! It vanished!', 'Where did my seat go?!', 'It shrank into the taskbar?!']), 2400);
  } else if (kind === 'drag') {
    state.vx = (Math.random() * 2 - 1) * 2;
    state.vy = -3;
    setFace('shock', 2600);
    say(pick(['Waaaah—!!', 'Noooo— I\'m falling!', 'Kyaa—!!']), 2200);
  } else {
    state.vx = 0;
    state.vy = -2;
    setFace('surprised', 1800);
    say(pick(['Hey! My seat!', 'Waah—!', 'Eek—!']), 1800);
  }
  state.falling = true;
}
async function hopDown() {
  if (!state.perch) return;
  state.noCatchId = state.perch.id;
  state.perch = null;
  showLedge(null);
  state.area = await api.workAreaAt(state.x + state.w / 2, state.y + state.h);
  state.pouncing = false;
  state.vx = state.dir * 2.5;
  state.vy = -7;
  state.falling = true;
  say(pick(['Wheee~', 'Coming down!', 'Hup!']), 1400);
}
// falling past a window: a gentle drop lands her sitting on it; a fast one, she grabs the edge and climbs up
function catchWindow() {
  if (state.hideAfterLanding) return false; // on her way down to play hide and seek
  const mid = state.x + state.w / 2;
  const seatNow = state.y + seatOffset();
  const handNow = state.y + handOffset();
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    if (w.min || w.max || w.id === state.noCatchId || mid < w.x + 40 || mid > w.x + w.w - 40 || w.y < state.area.y + 100) continue;
    if (frontOf(i, mid, w.y)) continue;
    if (state.vy < 7 && seatNow - state.vy <= w.y && seatNow >= w.y) {
      sitOn(w);
      flash('land', 350);
      setFace('cat', 1600);
      say(pick(['Safe landing~ ✨', 'Nailed it! ✨', 'Ta-da~ I\'m up here!']), 2200);
      return true;
    }
    if (handNow - state.vy <= w.y && handNow >= w.y) {
      sitOn(w, true);
      setFace('nervous', HANG_MS + CLIMB_MS);
      say(pick(['Hnngh—! Caught it!', '*grabs on*', 'S-safe…!']), 1600);
      return true;
    }
  }
  return false;
}

// ---------- too many treats ----------
function stuffed() {
  if (state.dragging || state.leaving) return;
  state.fullUntil = Date.now() + FULL_FOR_MS;
  state.treats = [];
  doAction('stuffed', 7000);
  setFace('drowsy', 3800);
  say(pick(['Ugh… so full~ I can\'t move…', 'I ate too much… 😵', '*flops* …so… full…']), 3400);
  setTimeout(() => { setFace('blush', 2200); say('*hic* …excuse me! 😳', 2200); }, 4000);
}

// ---------- the kitty dashes by; she gives chase ----------
const kittyEl = document.getElementById('kitty');
function startKitty(asked) {
  if (state.chase || state.perch || state.leap || state.dragging || state.falling || state.leaving || state.hideSeek || state.offering) return;
  if (claudeStatus().status !== 'idle') { if (asked) say('Not now, I\'m working~', 1500); return; }
  const a = state.area;
  let dir = Math.random() < 0.5 ? 1 : -1;
  const room = (d) => (d > 0 ? a.x + a.width - (state.x + state.w) : state.x - a.x);
  if (room(dir) < 250) dir = -dir;
  state.action = null;
  state.walkTarget = null;
  state.chase = { dir, kx: dir > 0 ? state.x - 40 : state.x + state.w + 40, phase: 'pass', until: 0 };
  kittyEl.classList.add('on');
  kittyEl.classList.toggle('left', dir < 0);
}
const CHASE_MS = 4000;
function updateChase(dt, now) {
  const c = state.chase;
  const mid = state.x + state.w / 2;
  if (c.phase === 'pass') {
    // dashes past her from behind
    c.kx += c.dir * 4.6 * dt;
    if ((c.kx - mid) * c.dir > 10) {
      c.phase = 'notice';
      c.until = now + 550;
      state.dir = c.dir;
      setFace('surprised', 700);
      say(pick(['!! A kitty!', 'Nya?! A cat!', 'Kitty!! 🐈']), 1200);
    }
  } else if (c.phase === 'notice') {
    c.kx += c.dir * 1.2 * dt; // slows down and looks back at her
    if (now > c.until) {
      c.phase = 'run';
      c.t0 = now;
      c.until = now + CHASE_MS;
      setFace('star', CHASE_MS);
      say(pick(['Wait for meee~!', 'Come back, kitty!', 'Let me pet you!!']), 2400);
    }
  } else if (c.phase === 'run') {
    const x = clampX(state.x + c.dir * 3.4 * dt);
    const stuck = x === state.x;
    state.x = x;
    api.setPos(state.x, state.y);
    // the kitty stays just out of reach (inside her window, so you can see it), teasing her
    const lead = 76 + 16 * Math.sin((now - c.t0) / 1000 * 4.5);
    c.kx += (state.x + state.w / 2 + c.dir * lead - c.kx) * Math.min(1, 0.18 * dt);
    if (now > c.until || stuck) {
      // then it shoots off for real
      c.phase = 'escape';
      c.until = now + 900;
      setFace('teary', 2400);
      say(pick(['Haa… haa… it got away~', 'So fast…', 'Next time, kitty…']), 2600);
    }
  } else if (c.phase === 'escape') {
    c.kx += c.dir * 9 * dt;
    if (now > c.until) {
      state.chase = null;
      kittyEl.classList.remove('on');
      return;
    }
  }
  // kitty runs along the floor line; its screen x is kx
  const b = svgRoot.getBoundingClientRect();
  kittyEl.style.left = (c.kx - state.x - 24) + 'px';
  kittyEl.style.top = (b.top + b.height * (231 / 240) - 33) + 'px';
}

// Claude closed: a tiny EXIT door pops up, she waves and backs into it, then the app quits.
// (the SessionStart hook brings her back next time)
const LEAVE_MS = 6000;
let leaveTimer;
function leave() {
  state.leaving = true;
  state.walkTarget = null;
  setFace('cat', LEAVE_MS);
  say(pick(['Bye bye~ 👋', 'See you next time~', 'Otsukare~ 👋']), 1500);
  leaveTimer = setTimeout(() => api.quit(), LEAVE_MS - 200);
}
function cancelLeave() {
  clearTimeout(leaveTimer);
  state.leaving = false;
  setFace(null);
}

api.onCommand((cmd) => {
  wake();
  if (cmd === 'hello') { doAction('hello', 2500); say('Hello hello~!', 2500); }
  if (cmd === 'dance') { doAction('dance', 6000); }
  if (cmd === 'trick') doTrick();
  if (cmd === 'sleep') { state.napping = true; say('Good night…', 2000); }
  if (cmd === 'wander-on') state.wander = true;
  if (cmd === 'wander-off') { state.wander = false; state.walkTarget = null; }
  if (cmd === 'reset') { sessions.clear(); say('Status cleared!', 2000); }
  if (cmd === 'leave') leave();
  if (cmd === 'snack') snack();
  if (cmd === 'hide') startHideSeek();
  if (cmd === 'perch') goPerch(true);
  if (cmd === 'kitty') startKitty(true);
  if (cmd.startsWith('treat:')) snack(cmd.slice(6));
  if (cmd === 'glasses-on') { state.alwaysGlasses = true; putOnGlasses(0); }
  if (cmd === 'glasses-on-quiet') state.alwaysGlasses = true; // remembered from last time
  if (cmd === 'glasses-off') { state.alwaysGlasses = false; state.glassesUntil = 0; say('*takes off glasses*', 1500); }
});

// ---------- speech bubble ----------
let bubbleTimer;
let bubbleSticky = false;
function say(text, ms = 3000, sticky = false) {
  clearTimeout(bubbleTimer);
  bubbleText.textContent = text;
  bubble.title = text;
  bubble.classList.toggle('urgent', sticky);
  bubble.classList.remove('hidden');
  bubbleSticky = sticky;
  if (!sticky && ms > 0) bubbleTimer = setTimeout(hideBubble, ms);
}
function hideBubble() { bubble.classList.add('hidden'); bubbleSticky = false; }

// ---------- expressions ----------
const FACES = ['star', 'wink', 'xx', 'teary', 'surprised', 'smug', 'pout', 'blush', 'think', 'yawn', 'cat', 'pat', 'heart', 'uwu', 'nervous', 'fired', 'cry', 'shock', 'drowsy', 'laugh', 'nom', 'sip', 'milk'];
let faceTimer;
// ---------- Claude status badge ----------
const badgeText = document.getElementById('badge-text');
const clock = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function updateBadge(pose) {
  const now = Date.now();
  const claude = claudeStatus();
  let kind = null;
  let text = '';
  if (claude.status === 'waiting') { kind = 'ask'; text = 'your turn!'; }
  else if (claude.status === 'working') {
    kind = toolKind(claude.tool);
    text = (turn.tools ? '⚙' + turn.tools + ' · ' : '') + clock(turn.start ? now - turn.start : 0);
  } else if (now < turn.doneUntil) { kind = 'done'; text = turn.doneText; }
  // the badge steps aside for poses that fill the top-right corner
  if (['sulk', 'exit', 'sleep', 'topple', 'yeet'].includes(pose)) kind = null;
  charEl.classList.toggle('badge', !!kind);
  for (const k of BADGE_KINDS) charEl.classList.toggle('tk-' + k, k === kind);
  if (kind && badgeText.textContent !== text) badgeText.textContent = text;
}

// ---------- glasses ----------
function putOnGlasses(ms = 25000 + Math.random() * 20000) {
  const already = charEl.classList.contains('specs');
  state.glassesUntil = Math.max(state.glassesUntil, Date.now() + ms);
  doAction('megane', 1000);
  setTimeout(() => flash('glint', 800), 450);
  say(already ? pick(['*pushes glasses up*', 'Fufu~ 🤓']) : pick(['*puts on glasses*', 'Smart mode: ON 🤓', 'Let me read up a bit~']), 2000);
}

// ---------- eyes follow the cursor ----------
let cursor = { x: 0, y: 0, movedAt: 0 };
api.onCursor((p) => {
  if (p.x !== cursor.x || p.y !== cursor.y) cursor = { x: p.x, y: p.y, movedAt: Date.now() };
});
const TRACK_POSES = ['idle', 'lounge', 'hello', 'cheer', 'wait', 'dance', 'hop', 'megane', 'stalk', 'perch'];
function updateTracking(pose) {
  const glancing = pose === 'work' && charEl.classList.contains('glance');
  const on = (TRACK_POSES.includes(pose) || glancing)
    && !charEl.classList.contains('has-face') && !charEl.classList.contains('view-side') && !charEl.classList.contains('view-back')
    && Date.now() - cursor.movedAt < 5000;
  charEl.classList.toggle('track', on);
  if (!on) return;
  // her eyes sit around (100, 116) in the SVG
  const m = svgRoot.getScreenCTM();
  const ex = state.x + m.a * 100 + m.e;
  const ey = state.y + m.d * 116 + m.f;
  const dx = cursor.x - ex;
  const dy = cursor.y - ey;
  charEl.style.setProperty('--gx', (6 * dx / (Math.abs(dx) + 160)).toFixed(2) + 'px');
  // looking down travels further, and the upper lids follow the eyes down a little
  charEl.style.setProperty('--gy', (dy > 0 ? 8 * dy / (dy + 140) : 5 * dy / (-dy + 140)).toFixed(2) + 'px');
  charEl.style.setProperty('--ly', (dy > 0 ? 4 * dy / (dy + 140) : 0).toFixed(2) + 'px');
}

// copy every front expression part into the 3/4 head so faces stay on while she walks
(function cloneFacesToSide() {
  const sFace = document.getElementById('sFace');
  const parts = document.querySelectorAll('#head .face-part, #tears, #fx-anger, #blush-hatch-heavy');
  for (const el of parts) sFace.appendChild(el.cloneNode(true)); // same ids on purpose: the face rules match both
})();

function setFace(name, ms = 0) {
  clearTimeout(faceTimer);
  charEl.classList.remove('has-face', ...FACES.map((f) => 'face-' + f));
  if (!name) return;
  charEl.classList.add('has-face', 'face-' + name);
  if (ms) faceTimer = setTimeout(() => setFace(null), ms);
}
const pokes = [];

// ---------- actions & poses ----------
// what she trips over (sometimes, classically, nothing at all)
const TRIP_CAUSES = {
  banana: ['Who left a banana here?!', 'A banana peel?! Classic…'],
  pebble: ['Ow— a pebble?!', 'This rock came out of nowhere!'],
  cable: ['Stupid cable…!', 'Who runs cables across the floor?!'],
  tail: ['*steps on her own tail*', 'Nyaa— my tail!'],
  nothing: ['*trips over nothing*', 'I meant to do that…', 'The floor moved!'],
};
const TRIP_PROPS = ['banana', 'pebble', 'cable'];

function doTrick() {
  const [pose, ms, lines] = pick(TRICKS);
  doAction(pose, ms);
  if (pose === 'flop') {
    const cause = pick(['banana', 'pebble', 'cable', 'tail', 'nothing']);
    for (const p of TRIP_PROPS) charEl.classList.toggle('prop-' + p, p === cause);
    charEl.classList.toggle('trip-tail', cause === 'tail');
    say(pick(TRIP_CAUSES[cause]), ms);
    return;
  }
  say(pick(lines), ms);
  if (pose === 'twirl') spin(2);
}

// A real 360°: front -> 3/4 -> side -> back -> other side -> 3/4 -> front, always the same direction.
const SPIN_STEPS = [
  ['', 1, 0], ['view-side', 1, -4], ['view-side', 0.5, -8], ['view-back', 1, -10],
  ['view-side', -0.5, -8], ['view-side', -1, -4], ['', 1, 0],
];
// squeeze/lift the whole character around her feet (100, 240); an SVG attribute transform on an inner group,
// because a CSS transform on the root <svg> made Chromium misdraw the blur-filtered views mid-spin
const spinnerEl = document.getElementById('spinner');
function squeeze(sx, dy = 0) {
  if (sx === 1 && !dy) return spinnerEl.removeAttribute('transform');
  spinnerEl.setAttribute('transform', `translate(100 ${240 + dy}) scale(${sx} 1) translate(-100 -240)`);
}

function spin(times = 1, stepMs = 85) {
  if (spinning) return;
  spinning = true;
  let i = 0;
  const total = (SPIN_STEPS.length - 1) * times + 1;
  const tick = () => {
    const [view, sx, dy] = SPIN_STEPS[i % (SPIN_STEPS.length - 1)];
    charEl.classList.toggle('view-side', view === 'view-side');
    charEl.classList.toggle('view-back', view === 'view-back');
    squeeze(sx, dy);
    i++;
    if (i < total) return void setTimeout(tick, stepMs);
    charEl.classList.remove('view-side', 'view-back');
    squeeze(1);
    spinning = false;
  };
  tick();
}

function doAction(name, ms) {
  state.action = name;
  state.actionUntil = Date.now() + ms;
  state.walkTarget = null;
}

// slept too long: tips off the cushion and wakes up with a start
function topple() {
  wake();
  state.asleepSince = 0;
  doAction('topple', 3600);
  setTimeout(() => { setFace('surprised', 1300); say(pick(['Hwah?!', 'Nya?!', '!!']), 1300); }, 1900);
  setTimeout(() => { setFace('yawn', 1800); say(pick(['…I fell asleep?', 'Ouch… *rubs eyes*', 'I wasn\'t sleeping!']), 2400); }, 3200);
}

function wake() {
  state.asleepSince = 0;
  state.lastActivity = Date.now();
  state.napping = false;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const POKE_LINES = ['Hehe~', 'That tickles!', 'I\'m clawde chan!', 'Need help with code?', '✨', 'Don\'t poke too hard!', 'Mou~', 'Hm? What is it?'];

// Turning between the front view and the 3/4 walking view: squeeze narrow, swap, spring back.
const svgEl = document.getElementById('svg');
let shownWalk = false;
let turnTimer = null;
let spinning = false;

function setPose(pose, extra = []) {
  const wantWalk = pose === 'walk';
  if (!spinning && wantWalk !== shownWalk) {
    if (!turnTimer) {
      squeeze(0.7);
      turnTimer = setTimeout(() => {
        shownWalk = wantWalk;
        turnTimer = null;
        squeeze(1);
      }, 110);
    }
    pose = shownWalk ? 'walk' : (pose === 'walk' ? 'idle' : pose);
  }
  for (const p of POSES) charEl.classList.toggle(p, p === pose);
  charEl.classList.toggle('thinking', extra.includes('thinking'));
  charEl.classList.toggle('happy', extra.includes('happy'));
  charEl.classList.toggle('airwork', extra.includes('airwork'));
  charEl.classList.toggle('airwait', extra.includes('airwait'));
  charEl.classList.toggle('quake', extra.includes('quake'));
  charEl.classList.toggle('flip', state.dir < 0 && pose === 'walk');
  if (!spinning) charEl.classList.toggle('view-back', pose === 'sulk');
  charEl.classList.toggle('specs', state.alwaysGlasses || Date.now() < state.glassesUntil);
  charEl.classList.toggle('panic', Date.now() < state.panicUntil);
  charEl.classList.toggle('night', isNight());
  charEl.classList.toggle('running', (!!state.chase && state.chase.phase === 'run') || (!!state.hideSeek && state.hideSeek.phase === 'going' && state.walkTarget != null));
  updateTracking(pose);
  updateBadge(pose);
}

function flash(cls, ms) {
  charEl.classList.remove(cls);
  void charEl.getBoundingClientRect(); // restart the animation
  charEl.classList.add(cls);
  setTimeout(() => charEl.classList.remove(cls), ms);
}

function choosePose(now) {
  if (state.leaving) return ['exit'];
  if (state.dragging) {
    const c = claudeStatus().status;
    return ['drag', c === 'working' ? ['airwork'] : c === 'waiting' ? ['airwait'] : []];
  }
  if (state.leap || (state.falling && state.pouncing)) return ['pounce'];
  if (state.falling) return ['fall'];
  if (state.chase) return [state.chase.phase === 'run' ? 'walk' : 'idle'];
  if (state.action && now < state.actionUntil) return [state.action, now < state.happyUntil ? ['happy'] : []];
  state.action = null;

  const claude = claudeStatus();
  if (state.perch && claude.status !== 'idle') { hopDown(); return ['pounce']; }
  if (claude.status === 'waiting') return ['wait'];
  if (claude.status === 'working') {
    state.walkTarget = null;
    if (state.laptopGone) {
      if (now < state.sulkUntil && now - state.yeetAt < 5000) return ['sulk'];
      pullLaptop();
      return [state.action];
    }
    return ['work', claude.tool ? [] : ['thinking']];
  }
  if (bubbleSticky) hideBubble();
  if (now < state.sulkUntil) return ['sulk'];
  if (state.hideSeek && state.hideSeek.phase === 'hidden') return ['peek'];
  if (state.perch) return [state.perch.climb ? state.perch.climb.stage : 'perch', state.perch.moving ? ['quake'] : []];

  if (state.napping || now - state.lastActivity > (isNight() ? NIGHT_SLEEP_AFTER_MS : SLEEP_AFTER_MS)) {
    if (!state.asleepSince) state.asleepSince = now;
    if (now - state.asleepSince > TOPPLE_AFTER_MS) {
      topple();
      return [state.action];
    }
    return ['sleep'];
  }
  state.asleepSince = 0;
  if (now - state.lastActivity > LOUNGE_AFTER_MS) return ['lounge'];
  if (state.walkTarget != null) return ['walk'];
  return ['idle'];
}

// ---------- movement ----------
function ground() { return state.area.y + state.area.height - state.h; }
function clampX(x) { return Math.min(Math.max(x, state.area.x - 20), state.area.x + state.area.width - state.w + 20); }

function think(now) {
  if (now < state.nextIdeaAt) return;
  state.nextIdeaAt = now + 5000 + Math.random() * 9000;
  if (state.hideSeek) return updateHideSeek(now);
  if (state.perch) {
    if (now > state.perch.until) return hopDown();
    if (Math.random() < 0.25) say(pick(['Nice view up here~', '*swings legs*', 'I\'m taller than you now~', '♪~']), 2200);
    return;
  }
  if (state.chase || state.leap || state.offering) return;
  if (!state.wander || state.dragging || state.falling || state.action || state.napping || now < state.sulkUntil) return;
  if (claudeStatus().status !== 'idle') return;
  if (now - state.lastActivity > LOUNGE_AFTER_MS) {
    if (Math.random() < 0.15) say(pick(['…', 'Hmm…', '*stares at the ceiling*', 'Bored~', 'Still there?']), 2500);
    else if (Math.random() < 0.08) { setFace('yawn', 2200); say('Fuaah~', 2200); }
    else if (Math.random() < 0.1) { setFace('drowsy', 3500); say('*blinks slowly*', 2500); }
    return;
  }

  // late at night she gets sleepy and says so
  if (isNight() && Math.random() < 0.08) { setFace('yawn', 2200); say(pick(['It\'s late… 🌙', 'Shouldn\'t you sleep? 🌙', '*yawn* …so late~']), 2600); return; }
  // the cursor moved off somewhere: tag along
  const cdx = cursor.x - (state.x + state.w / 2);
  if (now - cursor.movedAt < 2500 && cursor.y > state.y + 60 && Math.abs(cdx) > 150 && Math.abs(cdx) < 700 && Math.random() < 0.6) {
    state.walkTarget = clampX(cursor.x - state.w / 2 - Math.sign(cdx) * 70);
    return;
  }
  const r = Math.random();
  if (r < 0.5) {
    const span = Math.min(500, state.area.width / 2);
    state.walkTarget = clampX(state.x + (Math.random() * 2 - 1) * span);
  } else if (r < 0.56) {
    doAction('dance', 3000);
  } else if (r < 0.7) {
    doTrick();
  } else if (r < 0.74) {
    const idleFor = now - state.lastActivity;
    const [face, lines] = idleFor > 2 * 60 * 1000 && Math.random() < 0.6
      ? ['yawn', ['*yawn*', 'Fuaah~', 'Sleepy…']]
      : pick([['smug', ['Heh~', 'Fufu~', 'I know something you don\'t~']], ['cat', ['Nya~', '♪', 'Hehe~']], ['uwu', ['uwu', 'Ehehe~', '♡']]]);
    setFace(face, 2400);
    say(pick(lines), 2400);
  } else if (r < 0.8) {
    say(pick(['~♪', 'Hmm hmm~', 'What should we make?', 'Stretch break!', '☕?']), 2500);
  } else if (r < 0.88) {
    putOnGlasses();
  } else if (r < 0.92) {
    goPerch(false);
  } else if (r < 0.94) {
    startKitty(false);
  }
}

let last = performance.now();
function tick(t) {
  const dt = Math.min(2, (t - last) / 16.67);
  last = t;
  const now = Date.now();
  think(now);
  updateHearts(t);
  updatePat(t);
  updateWorkHead(t, dt);
  updateTickle(Date.now());
  if (state.leap) updateLeap(now);
  if (state.perch && !state.dragging) placeOnPerch(now);
  if (state.chase) updateChase(dt, now);
  updatePounce(now);

  if (state.falling) {
    state.vy += 0.9 * dt;
    state.x = clampX(state.x + state.vx * dt);
    state.y += state.vy * dt;
    state.vx *= 0.99;
    if (state.vy > 0 && !state.pouncing && catchWindow()) return void requestAnimationFrame(tick);
    if (state.y >= ground()) {
      state.y = ground();
      state.falling = false;
      if (state.vy > 22) { charEl.classList.add('oops'); setFace(Math.random() < 0.5 ? 'cry' : 'teary', 2200); say(pick(['Ouch!', 'Owie… >_<', 'That hurt!']), 2200); setTimeout(() => charEl.classList.remove('oops'), 1500); }
      state.vy = state.vx = 0;
      flash('land', 350);
      state.noCatchId = null;
      if (state.pouncing) landPounce();
      if (state.hideAfterLanding) { state.hideAfterLanding = false; setTimeout(startHideSeek, 350); }
    }
    api.setPos(state.x, state.y);
  } else if (!state.dragging && state.walkTarget != null && !state.action && claudeStatus().status === 'idle') {
    const d = state.walkTarget - state.x;
    state.dir = Math.sign(d) || state.dir;
    const step = (state.hideSeek ? 3.4 : 1.0) * dt; // sprints off to hide
    if (Math.abs(d) <= step) { state.x = state.walkTarget; state.walkTarget = null; if (state.hideSeek && state.hideSeek.phase === 'going') beginHide(); }
    else state.x += state.dir * step;
    api.setPos(state.x, state.y);
  }

  const [pose, extra = []] = choosePose(now);
  setPose(pose, extra);
  requestAnimationFrame(tick);
}

// ---------- mouse: hover, drag, toss, poke ----------
let hovering = false;
let drag = null;
hit.addEventListener('pointerenter', () => { hovering = true; api.ignoreMouse(false); });
hit.addEventListener('pointerleave', () => { hovering = false; if (!drag) api.ignoreMouse(true); });

hit.addEventListener('dblclick', () => {
  pokes.splice(-2);
  if (sulking() || state.leaving) return;
  setFace('cat', 1000);
  // no hopping off the cushion mid-work
  if (claudeStatus().status === 'working') return say(pick(['Hehe~ not now!', 'Working~ ♪']), 1000);
  doAction('hop', 900);
  say(pick(['Hop!', 'Boing~', 'Wheee!']), 1000);
});

hit.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  hit.setPointerCapture(e.pointerId);
  drag = { ox: e.screenX - state.x, oy: e.screenY - state.y, sx: e.screenX, sy: e.screenY, moved: false, hist: [] };
  wake();
  if (state.falling) catchHer();
});

hit.addEventListener('pointermove', (e) => {
  if (!drag) return wiggle(e);
  if (!drag.moved && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) > 5) {
    drag.moved = true;
    state.dragging = true;
    state.walkTarget = null;
    state.action = null;
    if (state.hideSeek) endHideSeek();
    state.perch = null;
    showLedge(null);
    state.leap = null;
    state.pouncing = false;
    say(pick(['Waah!', 'Eek!', 'Wheee~', 'Where are we going?']), 1500);
    setFace(Math.random() < 0.3 ? 'shock' : 'surprised', 1200);
    drag.since = Date.now();
  }
  if (!drag.moved) return;
  if (drag.since && Date.now() - drag.since > 3000 && !charEl.classList.contains('face-xx')) { setFace('xx'); say('Put me dooown~', 2000); }
  state.x = e.screenX - drag.ox;
  state.y = e.screenY - drag.oy;
  drag.hist.push({ x: e.screenX, y: e.screenY, t: performance.now() });
  if (drag.hist.length > 6) drag.hist.shift();
  api.setPos(state.x, state.y);
});

hit.addEventListener('pointerup', async (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!hovering) api.ignoreMouse(true);
  if (!d.moved && state.offering) return takeWater();
  if (!d.moved && state.hideSeek) return found();
  if (!d.moved) return onCheek(e) ? cheek() : onHead(e) ? pat() : poke();

  state.dragging = false;
  setFace(null);
  state.area = await api.workAreaAt(e.screenX, e.screenY);
  const h = d.hist;
  if (h.length >= 2) {
    const a = h[0], b = h[h.length - 1];
    const frames = Math.max(1, (b.t - a.t) / 16.67);
    state.vx = Math.max(-25, Math.min(25, (b.x - a.x) / frames));
    state.vy = Math.max(-25, Math.min(25, (b.y - a.y) / frames));
  }
  state.falling = true;
});

hit.addEventListener('contextmenu', (e) => { e.preventDefault(); api.openMenu(); });

// ---------- Pat Pat ----------
const svgRoot = document.getElementById('svg');
const heartsEl = document.getElementById('fx-hearts');
const pats = [];
let patStart = 0;
const PAT_FRAME_MS = 30;
const PAT_FRAMES = 10;
const PAT_CYCLES = 2;
const patImg = document.getElementById('pat-img');
// preload so swapping frames never flickers
const patFrames = Array.from({ length: PAT_FRAMES }, (_, i) => {
  const src = `../assets/petpet/pet${i}.gif`;
  new Image().src = src;
  return src;
});

function svgPoint(e) {
  const pt = svgRoot.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svgRoot.getScreenCTM().inverse());
}

// cheeks: either side of the face, below the eyes (front view only)
function onCheek(e) {
  if (['view-side', 'view-back', 'walk'].some((c) => charEl.classList.contains(c))) return false;
  const p = svgPoint(e);
  return p.y > 112 && p.y < 142 && (p.x < 80 || p.x > 120) && p.x > 44 && p.x < 156;
}

function cheek() {
  if (sulking()) return poke();
  wake();
  flash('mochi', 450);
  setFace('blush', 1600);
  say(pick(['Mfu?!', 'Mochi mochi~', 'H-hey! ///', 'Not the cheeks~!']), 1600);
}

let lastWiggleX = null;
let wiggleDir = 0;
const wiggles = [];
let tickleUntil = 0;
function wiggle(e) {
  const x = e.screenX;
  if (lastWiggleX !== null && Math.abs(x - lastWiggleX) > 3) {
    const dir = Math.sign(x - lastWiggleX);
    if (dir !== wiggleDir) { wiggles.push(Date.now()); wiggleDir = dir; }
    lastWiggleX = x;
  } else if (lastWiggleX === null) lastWiggleX = x;
  const now = Date.now();
  while (wiggles.length && now - wiggles[0] > 1200) wiggles.shift();
  if (tickling) { if (wiggles.length && wiggles[wiggles.length - 1] === now) lastTickleAt = now; return; }
  if (wiggles.length >= 6 && now > tickleUntil) { wiggles.length = 0; tickle(); }
}

// she keeps laughing for as long as you keep wiggling; the lines escalate the longer it goes
const TICKLE_LINES = [
  ['Ahaha! S-stop~!', 'Kyahaha! That tickles!', 'Hehehe~ no fair!'],
  ['Ahahaha! Okay okay!', 'N-not there! Kyaa~!', 'Hehehehe— stooop~'],
  ['I c-can\'t breathe! Ahaha!', 'Mercy! MERCY! >///<', 'Hyaa— I give up! I give up!'],
];
let tickling = false;
let tickleStart = 0;
let lastTickleAt = 0;
let tickleLineAt = 0;
function tickle() {
  tickleUntil = Date.now() + 3000;
  if (sulking()) { say('…pff— no! Hmph!', 1500); flash('huff', 400); return; }
  wake();
  tickling = true;
  tickleStart = lastTickleAt = Date.now();
  tickleLineAt = 0;
  charEl.classList.add('giggling');
  setFace('laugh');
}
// runs every frame from tick()
function updateTickle(now) {
  if (!tickling) return;
  // stopped wiggling: catch her breath
  if (now - lastTickleAt > 700) {
    tickling = false;
    tickleUntil = now + 1200;
    charEl.classList.remove('giggling');
    const long = now - tickleStart > 6000;
    setFace(long ? 'cry' : 'blush', 2000);
    say(long ? pick(['Haa… haa… tears… meanie~', '*wheeze*… you\'re evil~']) : pick(['Haa… haa… meanie~', 'Phew… you got me~']), 2200);
    return;
  }
  if (now >= tickleLineAt) {
    const stage = Math.min(TICKLE_LINES.length - 1, Math.floor((now - tickleStart) / 3000));
    say(pick(TICKLE_LINES[stage]), 1900);
    if (!charEl.classList.contains('face-laugh')) setFace('laugh');
    tickleLineAt = now + 1800;
  }
}

// grabbed mid-air: she stops dead in your hand
function catchHer() {
  const fast = state.vy > 14;
  state.falling = false;
  state.vx = state.vy = 0;
  state.dragging = true;
  state.walkTarget = null;
  state.action = null;
  drag.moved = true;
  drag.since = Date.now();
  flash('caught', 400);
  if (fast) {
    setFace('shock', 900);
    say(pick(['That was close!!', 'M-my life flashed before my eyes…']), 1800);
    setTimeout(() => setFace('blush', 1200), 900);
  } else {
    setFace(pick(['star', 'blush', 'uwu']), 1500);
    say(pick(['Nice catch! ✨', 'Kyaa— caught me ♡', 'Phew… thanks!', 'Again! Again!']), 1600);
  }
  spawnHeart();
}

function onHead(e) {
  const pt = svgRoot.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svgRoot.getScreenCTM().inverse());
  return p.y < 132;
}

const hearts = [];
function spawnHeart() {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('class', 'heart');
  p.setAttribute('d', 'M0,3 C-6,-3 -3,-8 0,-4 C3,-8 6,-3 0,3 Z');
  g.appendChild(p);
  heartsEl.appendChild(g);
  hearts.push({ g, born: performance.now(), x: 70 + Math.random() * 60, y: 30 + Math.random() * 16, s: 1.2 + Math.random() * 0.8, drift: (Math.random() - 0.5) * 10 });
  updateHearts(performance.now());
}
// called every frame from tick()
function updateHearts(now) {
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i];
    const t = (now - h.born) / 1300;
    if (t >= 1) { h.g.remove(); hearts.splice(i, 1); continue; }
    const rise = 1 - Math.pow(1 - t, 2);
    const pop = t < 0.2 ? 0.4 + (t / 0.2) * 0.75 : 1.15 - (t - 0.2) * 0.3;
    h.g.setAttribute('transform', `translate(${h.x + h.drift * rise} ${h.y - 34 * rise}) scale(${h.s * pop})`);
    h.g.setAttribute('opacity', t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
  }
}

// called every frame from tick(): one petpet frame, head squished the way the original GIF does it
function updatePat(now) {
  if (!patStart) return;
  const f = Math.floor((now - patStart) / PAT_FRAME_MS);
  if (f >= PAT_FRAMES * PAT_CYCLES) {
    patStart = 0;
    charEl.classList.remove('patting');
    return;
  }
  const i = f % PAT_FRAMES;
  const j = i < PAT_FRAMES / 2 ? i : PAT_FRAMES - i;
  patImg.setAttribute('href', patFrames[i]);
  charEl.style.setProperty('--pat-sx', 1 + j * 0.025);
  charEl.style.setProperty('--pat-sy', 1 - j * 0.035);
  // hair hangs from y 73 to 223: its top follows the squashed head, its ends don't move
  charEl.style.setProperty('--pat-hy', (223 - (140 - 67 * (1 - j * 0.035))) / 150);
}

function sulking() { return Date.now() < state.sulkUntil; }

function pat() {
  if (sulking()) {
    if (state.action === 'yeet') return;
    patStart = performance.now();
    charEl.classList.add('patting');
    if (++state.sulkPats < 3) { say(pick(['Hmph…', '…', '*pouts*']), 1400); return; }
    // made up: turns back around
    state.sulkUntil = 0;
    // no standing up from the cushion mid-work
    if (claudeStatus().status === 'idle') doAction('hello', 1500);
    setFace('blush', 2600);
    say(pick(['…fine. Forgiven ♡', 'Mou… okay ♡', '…don\'t do it again ♡']), 2600);
    // no crying over the laptop while typing on one
    setTimeout(() => { if (state.laptopGone && claudeStatus().status === 'idle' && !charEl.classList.contains('has-face')) { setFace('cry', 2600); say('…but my laptop T_T', 2600); } }, 3200);
    for (let i = 0; i < 3; i++) setTimeout(spawnHeart, i * 120);
    return;
  }
  wake();
  const now = Date.now();
  pats.push(now);
  while (pats.length && now - pats[0] > 4000) pats.shift();

  // restart the hand + squish; updatePat() plays it
  patStart = performance.now();
  charEl.classList.add('patting');
  updatePat(patStart);

  setFace(pats.length >= 6 ? 'heart' : pats.length >= 3 && Math.random() < 0.4 ? 'uwu' : 'pat', 1800);
  const n = pats.length >= 4 ? 3 : pats.length >= 2 ? 2 : 1;
  for (let i = 0; i < n; i++) setTimeout(spawnHeart, i * 120);
  if (pats.length >= 6) say(pick(['Purrr~ ♡', 'Nyaa~ ♡♡', '*melts*']), 1800);
  else if (pats.length >= 3) say(pick(['Ehehe~ ♡', 'More~ ♡', 'Mmm~']), 1600);
  else say(pick(['♡', 'Hehe~', 'Pat pat~']), 1400);
}

// she needs a laptop again after throwing hers: a spare comes out of the apron pocket
function pullLaptop() {
  state.laptopGone = false;
  const grumpy = sulking();
  state.sulkUntil = 0;
  doAction('pullout', 2200);
  setFace(grumpy ? 'pout' : 'smug', 2600);
  say(grumpy ? pick(['Hmph… work is work. 💢', '…fine. I have a spare. Hmph.']) : pick(['Good thing I keep a spare~ ✨', '*pulls a laptop out of her pocket*', 'Backup laptop, go! ✨']), 2600);
}

// teased too much: up goes the laptop, and it's coming at you
function yeet() {
  pokes.length = 0;
  state.laptopGone = true;
  state.yeetAt = Date.now();
  state.sulkUntil = Date.now() + 1800 + 25000;
  state.sulkPats = 0;
  doAction('yeet', 1800);
  setFace('pout', 3200);
  say('THAT\'S IT!! 💢', 900);
  setTimeout(() => say(pick(['Take THIS!', 'Hmph!! 💢', '*yeet*']), 1300), 900);
  setTimeout(() => say(pick(['Hmph. Not talking to you.', 'Hmph! 💢', '…I\'m not sorry!']), 2600), 2200);
}

function poke() {
  if (claudeStatus().status === 'waiting') {
    say('Go check the terminal! 👉', 2500);
    return;
  }
  if (sulking()) {
    if (state.action === 'yeet') return; // mid-throw: no
    flash('huff', 400);
    say(pick(['Hmph.', '…', 'Not talking to you.', '💢', '*ignores you*']), 1500);
    state.sulkUntil = Math.max(state.sulkUntil, Date.now() + 8000); // poking only makes it worse
    return;
  }
  flash('poke', 350);
  const now = Date.now();
  pokes.push(now);
  while (pokes.length && now - pokes[0] > 6000) pokes.shift();
  if (pokes.length >= 8) return yeet();
  if (pokes.length >= 5) {
    setFace('pout', 2600);
    say(pick(['Mou! Stop it! 💢', 'Hmph!', 'I\'m not a button!']), 2600);
    return;
  }
  if (pokes.length >= 3) {
    setFace('blush', 2000);
    say(pick(['E-eh?!', 'S-stop that~', 'Th-that tickles…']), 2000);
    return;
  }
  // busy at the laptop: she stays seated and just looks up at you
  if (claudeStatus().status === 'working') {
    charEl.classList.add('glance');
    setTimeout(() => charEl.classList.remove('glance'), 1400);
    setFace(Math.random() < 0.5 ? 'wink' : 'cat', 1200);
    say(pick(['Hm? I\'m working~', 'Busy busy~ ✨', 'Almost done, hold on!', 'Hehe, hi~']), 1800);
    return;
  }
  doAction('hello', 900);
  if (Math.random() < 0.5) setFace('wink', 1200); else state.happyUntil = now + 900;
  say(pick(POKE_LINES), 2000);
}

// working head: nods over the keyboard, eases into a slow sway while glancing up
let glanceMix = 0;
let workT0 = null;
function updateWorkHead(t, dt) {
  if (!charEl.classList.contains('work')) { glanceMix = 0; workT0 = null; return; }
  if (workT0 === null) workT0 = t;
  const target = charEl.classList.contains('glance') ? 1 : 0;
  glanceMix += (target - glanceMix) * Math.min(1, dt * 0.06);
  const nod = (1 - Math.cos(((t - workT0) / 1600) * Math.PI * 2)) / 2;
  const sway = Math.sin(((t - workT0) / 3000) * Math.PI * 2);
  const m = glanceMix * glanceMix * (3 - 2 * glanceMix);
  charEl.style.setProperty('--wr', ((1 - m) * 2 * nod - m * 3 * sway).toFixed(3) + 'deg');
  charEl.style.setProperty('--wy', ((1 - m) * nod - m * 1.5).toFixed(3) + 'px');
}

// while working her glasses catch the light now and then
setInterval(() => {
  if ((charEl.classList.contains('work') || charEl.classList.contains('specs')) && Math.random() < 0.08) flash('glint', 800);
}, 1000);

// while working she now and then glances up from the laptop
setInterval(() => {
  if (!charEl.classList.contains('work') || charEl.classList.contains('glance')) return;
  if (Math.random() < 0.12) {
    charEl.classList.add('glance');
    setTimeout(() => charEl.classList.remove('glance'), 1400 + Math.random() * 1200);
  }
}, 1000);

// ---------- boot ----------
charEl.classList.add('g-' + GLASSES);
(async () => {
  const g = await api.geometry();
  Object.assign(state, { x: g.x, y: g.y, w: g.w, h: g.h, area: g.workArea });
  state.y = ground();
  api.setPos(state.x, state.y);
  doAction('hello', 2500);
  say('clawde chan is here! ✨', 3000);
  requestAnimationFrame(tick);
})();
