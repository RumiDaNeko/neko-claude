// claude-chan behavior: wandering, drag & toss physics, and Claude Code status reactions.
const api = window.chan;
const charEl = document.getElementById('char');
const hit = document.getElementById('hit');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const POSES = ['idle', 'walk', 'work', 'wait', 'cheer', 'hello', 'dance', 'sleep', 'drag', 'fall', 'flop', 'twirl', 'backflip', 'achoo', 'lounge'];

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
const STALE_SESSION_MS = 15 * 60 * 1000;

const state = {
  x: 0, y: 0, w: 240, h: 300,
  area: null,
  vx: 0, vy: 0,
  dragging: false, falling: false,
  walkTarget: null, dir: 1,
  wander: true,
  action: null, actionUntil: 0, happyUntil: 0, // short one-off pose (cheer, hello, dance, poke)
  napping: false,
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

api.onClaude((ev) => {
  const id = ev.session || 'default';
  const prev = sessions.get(id);
  wake();
  switch (ev.event) {
    case 'SessionStart':
      sessions.set(id, { status: 'idle', at: Date.now() });
      doAction('hello', 2500);
      say('Hi! Let\'s build something ✨', 3000);
      break;
    case 'UserPromptSubmit':
      sessions.set(id, { status: 'working', tool: null, at: Date.now() });
      say(pick(['On it!', 'Leave it to me!', 'Okay~ thinking…', 'Let\'s go!']), 2500);
      break;
    case 'PreToolUse':
      sessions.set(id, { status: 'working', tool: ev.tool, at: Date.now() });
      if (!prev || prev.tool !== ev.tool || prev.status !== 'working') say(toolLine(ev.tool), 4000);
      break;
    case 'Notification': {
      sessions.set(id, { status: 'waiting', tool: prev?.tool, at: Date.now() });
      const msg = String(ev.message || '');
      const line = /permission/i.test(msg) ? 'Can I do this? Need your OK!'
        : /waiting|idle/i.test(msg) ? 'Psst… your turn~'
        : msg.slice(0, 60) || 'Hey! I need you 👋';
      say(line, 0, true);
      break;
    }
    case 'Stop':
      sessions.set(id, { status: 'idle', at: Date.now() });
      if (claudeStatus().status === 'idle') {
        doAction('cheer', 2200);
        say(pick(['Done! ✨', 'All finished!', 'Ta-da~!', 'Your turn!']), 5000);
      }
      break;
    case 'SessionEnd':
      sessions.delete(id);
      say('Bye bye~', 2500);
      doAction('hello', 1800);
      break;
  }
});

api.onCommand((cmd) => {
  wake();
  if (cmd === 'hello') { doAction('hello', 2500); say('Hello hello~!', 2500); }
  if (cmd === 'dance') { doAction('dance', 6000); }
  if (cmd === 'trick') doTrick();
  if (cmd === 'sleep') { state.napping = true; say('Good night…', 2000); }
  if (cmd === 'wander-on') state.wander = true;
  if (cmd === 'wander-off') { state.wander = false; state.walkTarget = null; }
  if (cmd === 'reset') { sessions.clear(); say('Status cleared!', 2000); }
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

// ---------- actions & poses ----------
function doTrick() {
  const [pose, ms, lines] = pick(TRICKS);
  doAction(pose, ms);
  say(pick(lines), ms);
  if (pose === 'twirl') spin(2);
}

// A real 360°: front -> 3/4 -> side -> back -> other side -> 3/4 -> front, always the same direction.
const SPIN_STEPS = [
  ['', 1, 0], ['view-side', 1, -4], ['view-side', 0.5, -8], ['view-back', 1, -10],
  ['view-side', -0.5, -8], ['view-side', -1, -4], ['', 1, 0],
];
function spin(times = 1, stepMs = 85) {
  if (spinning) return;
  spinning = true;
  const prevTransition = svgEl.style.transition;
  svgEl.style.transition = 'transform 0.06s linear';
  let i = 0;
  const total = (SPIN_STEPS.length - 1) * times + 1;
  const tick = () => {
    const [view, sx, dy] = SPIN_STEPS[i % (SPIN_STEPS.length - 1)];
    charEl.classList.toggle('view-side', view === 'view-side');
    charEl.classList.toggle('view-back', view === 'view-back');
    svgEl.style.transform = `translateY(${dy}px) scaleX(${sx})`;
    i++;
    if (i < total) return void setTimeout(tick, stepMs);
    charEl.classList.remove('view-side', 'view-back');
    svgEl.style.transform = '';
    svgEl.style.transition = prevTransition;
    spinning = false;
  };
  tick();
}

function doAction(name, ms) {
  state.action = name;
  state.actionUntil = Date.now() + ms;
  state.walkTarget = null;
}

function wake() {
  state.lastActivity = Date.now();
  state.napping = false;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const POKE_LINES = ['Hehe~', 'That tickles!', 'I\'m claude-chan!', 'Need help with code?', '✨', 'Don\'t poke too hard!', 'Mou~', 'Hm? What is it?'];

// Turning between the front view and the 3/4 walking view: squeeze narrow, swap, spring back.
const svgEl = document.getElementById('svg');
let shownWalk = false;
let turnTimer = null;
let spinning = false;

function setPose(pose, extra = []) {
  const wantWalk = pose === 'walk';
  if (!spinning && wantWalk !== shownWalk) {
    if (!turnTimer) {
      svgEl.style.transform = 'scaleX(0.7)';
      turnTimer = setTimeout(() => {
        shownWalk = wantWalk;
        turnTimer = null;
        svgEl.style.transform = '';
      }, 110);
    }
    pose = shownWalk ? 'walk' : (pose === 'walk' ? 'idle' : pose);
  }
  for (const p of POSES) charEl.classList.toggle(p, p === pose);
  charEl.classList.toggle('thinking', extra.includes('thinking'));
  charEl.classList.toggle('happy', extra.includes('happy'));
  charEl.classList.toggle('flip', state.dir < 0 && pose === 'walk');
}

function flash(cls, ms) {
  charEl.classList.remove(cls);
  void charEl.getBoundingClientRect(); // restart the animation
  charEl.classList.add(cls);
  setTimeout(() => charEl.classList.remove(cls), ms);
}

function choosePose(now) {
  if (state.dragging) return ['drag'];
  if (state.falling) return ['fall'];
  if (state.action && now < state.actionUntil) return [state.action, now < state.happyUntil ? ['happy'] : []];
  state.action = null;

  const claude = claudeStatus();
  if (claude.status === 'waiting') return ['wait'];
  if (claude.status === 'working') {
    state.walkTarget = null;
    return ['work', claude.tool ? [] : ['thinking']];
  }
  if (bubbleSticky) hideBubble();

  if (state.napping || now - state.lastActivity > SLEEP_AFTER_MS) return ['sleep'];
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
  if (!state.wander || state.dragging || state.falling || state.action || state.napping) return;
  if (claudeStatus().status !== 'idle') return;
  if (now - state.lastActivity > LOUNGE_AFTER_MS) {
    if (Math.random() < 0.15) say(pick(['…', 'Hmm…', '*stares at the ceiling*', 'Bored~', 'Still there?']), 2500);
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
  } else if (r < 0.78) {
    say(pick(['~♪', 'Hmm hmm~', 'What should we make?', 'Stretch break!', '☕?']), 2500);
  }
}

let last = performance.now();
function tick(t) {
  const dt = Math.min(2, (t - last) / 16.67);
  last = t;
  const now = Date.now();
  think(now);

  if (state.falling) {
    state.vy += 0.9 * dt;
    state.x = clampX(state.x + state.vx * dt);
    state.y += state.vy * dt;
    state.vx *= 0.99;
    if (state.y >= ground()) {
      state.y = ground();
      state.falling = false;
      if (state.vy > 22) { charEl.classList.add('oops'); say('Ouch!', 1500); setTimeout(() => charEl.classList.remove('oops'), 1500); }
      state.vy = state.vx = 0;
      flash('land', 350);
    }
    api.setPos(state.x, state.y);
  } else if (!state.dragging && state.walkTarget != null && !state.action && claudeStatus().status === 'idle') {
    const d = state.walkTarget - state.x;
    state.dir = Math.sign(d) || state.dir;
    const step = 1.0 * dt;
    if (Math.abs(d) <= step) { state.x = state.walkTarget; state.walkTarget = null; }
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

hit.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  hit.setPointerCapture(e.pointerId);
  drag = { ox: e.screenX - state.x, oy: e.screenY - state.y, sx: e.screenX, sy: e.screenY, moved: false, hist: [] };
  wake();
});

hit.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) > 5) {
    drag.moved = true;
    state.dragging = true;
    state.walkTarget = null;
    state.action = null;
    say(pick(['Waah!', 'Eek!', 'Wheee~', 'Where are we going?']), 1500);
  }
  if (!drag.moved) return;
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
  if (!d.moved) return poke();

  state.dragging = false;
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

function poke() {
  if (claudeStatus().status === 'waiting') {
    say('Go check the terminal! 👉', 2500);
    return;
  }
  flash('poke', 350);
  doAction('hello', 900);
  state.happyUntil = Date.now() + 900;
  say(pick(POKE_LINES), 2000);
}

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
  say('claude-chan is here! ✨', 3000);
  requestAnimationFrame(tick);
})();
