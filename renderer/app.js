// claude-chan behavior: wandering, drag & toss physics, and Claude Code status reactions.
const api = window.chan;
const charEl = document.getElementById('char');
const hit = document.getElementById('hit');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const POSES = ['idle', 'walk', 'work', 'wait', 'cheer', 'hello', 'dance', 'sleep', 'drag', 'fall', 'flop', 'twirl', 'backflip', 'achoo', 'lounge', 'topple', 'yeet', 'exit', 'sulk'];

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
      if (state.leaving) cancelLeave();
      sessions.set(id, { status: 'idle', at: Date.now() });
      doAction('hello', 2500);
      say('Hi! Let\'s build something ✨', 3000);
      break;
    case 'UserPromptSubmit':
      sessions.set(id, { status: 'working', tool: null, at: Date.now() });
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
      if (!prev || prev.tool !== ev.tool || prev.status !== 'working') say(toolLine(ev.tool), 4000);
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
        doAction('cheer', 2200);
        const f = Math.random();
        if (f < 0.4) setFace('star', 2200); else if (f < 0.6) setFace('uwu', 2200);
        say(pick(['Done! ✨', 'All finished!', 'Ta-da~!', 'Your turn!']), 5000);
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
const FACES = ['star', 'wink', 'xx', 'teary', 'surprised', 'smug', 'pout', 'blush', 'think', 'yawn', 'cat', 'pat', 'heart', 'uwu', 'nervous', 'fired', 'cry', 'shock', 'drowsy'];
let faceTimer;
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
  if (!spinning) charEl.classList.toggle('view-back', pose === 'sulk');
}

function flash(cls, ms) {
  charEl.classList.remove(cls);
  void charEl.getBoundingClientRect(); // restart the animation
  charEl.classList.add(cls);
  setTimeout(() => charEl.classList.remove(cls), ms);
}

function choosePose(now) {
  if (state.leaving) return ['exit'];
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
  if (now < state.sulkUntil) return ['sulk'];

  if (state.napping || now - state.lastActivity > SLEEP_AFTER_MS) {
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
  if (!state.wander || state.dragging || state.falling || state.action || state.napping || now < state.sulkUntil) return;
  if (claudeStatus().status !== 'idle') return;
  if (now - state.lastActivity > LOUNGE_AFTER_MS) {
    if (Math.random() < 0.15) say(pick(['…', 'Hmm…', '*stares at the ceiling*', 'Bored~', 'Still there?']), 2500);
    else if (Math.random() < 0.08) { setFace('yawn', 2200); say('Fuaah~', 2200); }
    else if (Math.random() < 0.1) { setFace('drowsy', 3500); say('*blinks slowly*', 2500); }
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

  if (state.falling) {
    state.vy += 0.9 * dt;
    state.x = clampX(state.x + state.vx * dt);
    state.y += state.vy * dt;
    state.vx *= 0.99;
    if (state.y >= ground()) {
      state.y = ground();
      state.falling = false;
      if (state.vy > 22) { charEl.classList.add('oops'); setFace(Math.random() < 0.5 ? 'cry' : 'teary', 2200); say(pick(['Ouch!', 'Owie… >_<', 'That hurt!']), 2200); setTimeout(() => charEl.classList.remove('oops'), 1500); }
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
  if (!d.moved) return onHead(e) ? pat() : poke();

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
    doAction('hello', 1500);
    setFace('blush', 2600);
    say(pick(['…fine. Forgiven ♡', 'Mou… okay ♡', '…don\'t do it again ♡']), 2600);
    setTimeout(() => { if (!charEl.classList.contains('has-face')) { setFace('cry', 2600); say('…but my laptop T_T', 2600); } }, 3200);
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

// teased too much: up goes the laptop, and it's coming at you
function yeet() {
  pokes.length = 0;
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
  if (charEl.classList.contains('work') && Math.random() < 0.08) flash('glint', 800);
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
