// claude-chan behavior: wandering, drag & toss physics, and Claude Code status reactions.
const api = window.chan;
const charEl = document.getElementById('char');
// a second Claude session gets her little sister (same page, second window, ?sister=1)
const SISTER = new URLSearchParams(location.search).has('sister');
if (SISTER) charEl.classList.add('sister');
const hit = document.getElementById('hit');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const POSES = ['idle', 'walk', 'work', 'wait', 'cheer', 'hello', 'dance', 'sleep', 'drag', 'fall', 'flop', 'twirl', 'backflip', 'achoo', 'lounge', 'topple', 'yeet', 'exit', 'sulk', 'hop', 'snack', 'megane', 'peek', 'pullout', 'stalk', 'pounce', 'perch', 'stuffed', 'hang', 'climb', 'toestand', 'hifive'];

// Goofy tricks she does now and then: [pose, duration ms, lines]
const TRICKS = [
  ['flop', 2800, ['Waah—!', '*trips over nothing*', 'I meant to do that…']],
  ['twirl', 1300, ['Weee~!', 'Spin spin~', 'Ta-daa!']],
  ['backflip', 1300, ['Hup!', 'Backflip!', 'Watch this!']],
  ['moonwalk', 3000, []],
  ['achoo', 1800, ['Ha… ha… HACHOO!', 'Hachoo! Sorry~', '*sniff*']],
];
const LOUNGE_AFTER_MS = 5 * 60 * 1000; // sits down and spaces out
const GLASSES = 'round'; // work glasses: 'round' | 'half' | 'square'
const SLEEP_AFTER_MS = 60 * 60 * 1000; // falls asleep
const LIE_DOWN_MS = 30 * 60 * 1000;  // daytime nap: this long sitting up, then she lies down on her cushion
const NAP_WAKE_MS = 60 * 60 * 1000;  // ...and wakes up on her own after this long
const BACK_TO_BED_MS = 8000;          // woken up at night: grumbles, then back to bed after this
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
  lastBoop: 0, chinAt: 0, chinCount: 0, tailAt: 0, earsUntil: 0, dizzyUntil: 0,
  handHold: false, laser: false, laserPounceAt: 0, fetch: null, highFive: 0, juice: null, upsetUntil: 0,
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
const BADGE_KINDS = ['think', 'term', 'read', 'search', 'edit', 'web', 'agent', 'plan', 'gear', 'ask', 'done', 'battery'];
const toolKind = (tool) => (tool ? (TOOL_KINDS.find(([re]) => re.test(tool)) || [, 'gear'])[1] : 'think');
// the current Claude turn, for the badge's tool count and timer
const turn = { start: 0, tools: 0, doneUntil: 0, doneText: '', spin: 0 };
// she's a little Claude: while Claude thinks, her badge cycles through the same kind of whimsical words
// Claude Code's spinner uses
const SPIN_WORDS = ['Pondering', 'Musing', 'Noodling', 'Cogitating', 'Percolating', 'Ruminating', 'Brewing', 'Clauding',
  'Mulling', 'Tinkering', 'Untangling', 'Puzzling', 'Simmering', 'Scheming', 'Doodling', 'Wondering'];
// ...and now and then she thinks out loud the way Claude works: read first, change carefully, verify
const THINK_ALOUD = {
  read: ['Reading before I touch anything~ 📖', 'Let me understand this first…', 'Context first, code second!'],
  search: ['Where else is this used… 🔍', 'Making sure I don\'t miss a spot…', 'Let me look around first~'],
  edit: ['Small, careful change~ ✏️', 'Matching the code around it…', 'Just what you asked, nothing extra~'],
  term: ['Let\'s see if it actually works…', 'Trust, but verify~ 🧪', 'Checking it for real…'],
  web: ['Looking it up, not guessing~ 🌐', 'Let me check the docs…'],
  agent: ['Sending helpers out! 🫡', 'Divide and conquer~'],
  plan: ['Plan first, then code 📝', 'Making a little checklist~'],
};
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
  wake(true);
  switch (ev.event) {
    case 'SessionStart':
      if (state.leaving) cancelLeave();
      sessions.set(id, { status: 'idle', at: Date.now() });
      doAction('hello', 2500);
      say(SISTER ? 'Hi! I\'m her little sister~ I\'ll help with this one ✨' : 'Hi! Let\'s build something ✨', 3000);
      if (!SISTER) morningCoffee();
      achieve(SISTER ? 'sister' : 'hello');
      break;
    case 'Adopt': // her sister went home; this session is hers now
      sessions.set(id, { status: 'idle', at: Date.now() });
      doAction('hello', 1500);
      say('Sis went home~ I\'ll take over! ✨', 2800);
      break;
    case 'UserPromptSubmit':
      { const h = new Date().getHours(); if (h >= 2 && h < 5) achieve('nightowl'); }
      sessions.set(id, { status: 'working', tool: null, at: Date.now() });
      turn.start = Date.now();
      turn.tools = 0;
      turn.errors = 0;
      turn.spin = Math.floor(Math.random() * SPIN_WORDS.length);
      turn.doneUntil = 0;
      if (Math.random() < 0.4) {
        setFace('fired', 2000);
        say(pick(['Let\'s go! 🔥', 'Leave it to me! 🔥', 'Yosh!']), 2500);
      } else {
        setFace('think', 1800);
        say(pick(['On it!', 'Okay~ thinking…', 'Hmm, let me see…', 'Let me think this through…', 'Ooh, good one~ let me look']), 2500);
      }
      break;
    case 'PreToolUse':
      if (state.juice) quotaBack(true);
      sessions.set(id, { status: 'working', tool: ev.tool, at: Date.now() });
      if (!turn.start) turn.start = Date.now();
      turn.tools++;
      if (!prev || prev.tool !== ev.tool || prev.status !== 'working') {
        const aloud = THINK_ALOUD[toolKind(ev.tool)];
        say(aloud && Math.random() < 0.35 ? pick(aloud) : toolLine(ev.tool), 4000);
      }
      if (!reactToCommand('pre', ev) && /^(Grep|Glob)$/.test(ev.tool || '') && Math.random() < 0.25) {
        setFace('think', 1800);
        say(pick(['Where is it… 🔍', 'Hmm, somewhere in here…', 'Searching searching~']), 2200);
      }
      break;
    case 'PostToolUseFailure':
      turn.errors = (turn.errors || 0) + 1;
      state.bugTool = ev.tool;
      state.bugCmd = ev.command || '';
      state.bugAt = Date.now();
      oops(turn.errors, ev.command);
      break;
    case 'PostToolUse':
      // the command that failed earlier (or the test run) just went through
      if (state.bugTool && ev.tool === state.bugTool && Date.now() - state.bugAt < 15 * 60 * 1000
        && (ev.command === state.bugCmd || (TESTS.test(ev.command || '') && TESTS.test(state.bugCmd)))) fixedIt();
      else reactToCommand('post', ev);
      break;
    case 'Notification': {
      sessions.set(id, { status: 'waiting', tool: prev?.tool, at: Date.now() });
      const msg = String(ev.message || '');
      const line = /permission/i.test(msg) ? pick(['Can I do this? Need your OK!', 'I\'d rather ask than guess~ OK?', 'Your call! Can I go ahead?'])
        : /waiting|idle/i.test(msg) ? 'Psst… your turn~'
        : msg.slice(0, 60) || 'Hey! I need you 👋';
      say(line, 0, true);
      setFace(/permission/i.test(msg) ? 'nervous' : 'surprised', 2000);
      break;
    }
    case 'StopFailure':
      sessions.set(id, { status: 'idle', at: Date.now() });
      turn.start = 0;
      if (ev.limit) outOfJuice(ev.limit);
      else { setFace('nervous', 2200); say(pick(['Eh? Claude hit an error… 😵', 'Hmm… the API hiccuped~ try again?']), 2600); }
      break;
    case 'Stop':
      sessions.set(id, { status: 'idle', at: Date.now() });
      if (ev.limit) { turn.start = 0; outOfJuice(ev.limit); break; }
      if (claudeStatus().status === 'idle') {
        const took = turn.start ? Date.now() - turn.start : 0;
        turn.doneUntil = Date.now() + 2600;
        turn.doneText = (turn.tools ? '⚙' + turn.tools + ' · ' : '') + clock(took);
        turn.start = 0;
        // long run: she's earned a coffee
        achieve('done');
        if (took > 10 * 60 * 1000) achieve('marathon');
        if (took > 3 * 60 * 1000) setTimeout(() => { if (claudeStatus().status === 'idle' && !state.action) snack('coffee', 'Phew… coffee break ☕'); }, 2600);
        doAction('cheer', 2200);
        sfx('chime');
        changeMood(2);
        const f = Math.random();
        if (f < 0.4) setFace('star', 2200); else if (f < 0.6) setFace('uwu', 2200);
        say(state.bugTool ? pick(['Done… but something still failed. Being upfront about it 🙇', 'Finished, though one thing didn\'t work. Take a look? 🙏'])
          : turn.errors ? pick(['Done! We beat those errors ✨', 'Finished… after a fight! 💪', 'Ta-da~ bugs defeated!'])
          : isNight() && Math.random() < 0.35 ? pick(['Done! …now go to sleep? 🌙', 'All finished~ it\'s late, you know 🌙'])
          : pick(['Done! ✨', 'All finished!', 'Ta-da~!', 'Your turn!', 'Done! Tell me if anything looks off~']), 5000);
        state.bugTool = null;
        // an hour of this: time for a water break
        if (state.codingSince && Date.now() - state.codingSince > BREAK_AFTER_MS) { state.codingSince = Date.now(); setTimeout(breakReminder, 2800); }
      }
      break;
    case 'SessionEnd':
      sessions.delete(id);
      if (sessions.size === 0) { leave(!SISTER); break; } // she waits in the tray (her sister just goes home)
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
  fish: { face: 'star', hello: ['F-FISH?! 🐟', 'IS THAT A FISH?!', 'Nyaaa~ fish!! 🐟'], during: 'Nom nom nom~ 🐟♡',
    after: () => { setFace('heart', 2200); flash('tailwag', 2200); say(pick(['Best. Treat. EVER. 🐟♡', 'Fish is the best food~ ♡', '*happy cat noises* 🐟']), 2400); popHearts(4); } },
};
const popHearts = (n) => { for (let i = 0; i < n; i++) setTimeout(spawnHeart, i * 140); };
const ITEMS = Object.keys(TREATS);

function snack(item = 'cookie', line) {
  if (state.leaving || state.dragging) return;
  // busy walking (or mid-air, or chasing the kitty): she finishes that first, then eats
  if (state.walkTarget != null || state.chase || state.leap || state.falling) {
    if (!state.pendingTreat) say(pick(['Ooh, for me? One sec~', 'Coming~! 🏃‍♀️', 'Wait wait, let me stop first!']), 1800);
    state.pendingTreat = [item, line];
    return;
  }
  achieve('treat', item);
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
  charEl.classList.toggle('drinking', item !== 'cookie' && item !== 'fish'); // food is held and bitten, drinks are lifted and sipped
  charEl.classList.toggle('sipstraw', item === 'boba');
  doAction('snack', 3200);
  setFace(t.face, 3200);
  changeMood(item === 'water' ? 2 : 6);
  interacted();
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
  changeMood(4);
  interacted();
  const secs = Math.round((Date.now() - state.hideSeek.since) / 1000);
  endHideSeek();
  doAction('cheer', 1600);
  setFace('star', 2000);
  achieve('found');
  if (secs <= 3) achieve('found-fast');
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
function oops(n, cmd = '') {
  achieve('error');
  state.panicUntil = Date.now() + 8000;
  changeMood(-1.5);
  sfx('uhoh');
  if (TESTS.test(cmd)) {
    flash('jolt', 450);
    setFace(n >= 3 ? 'cry' : 'teary', 3000);
    say(pick(['Red tests… 😭', 'The tests failed! T_T', 'Nooo, a failing test…']), 2600);
    return;
  }
  flash('jolt', 450);
  setFace('shock', 900);
  setTimeout(() => setFace(n >= 3 ? 'cry' : 'nervous', 6000), 900);
  say(n >= 3 ? pick(['Why won\'t it work?! 😭', 'Another one?! T_T', 'The bugs keep coming…!'])
    : pick(['Eek! An error! 😱', 'Uh-oh… red text!', 'Th-that\'s not supposed to happen!', 'Huh?! It broke?!']), 2600);
}
function fixedIt() {
  achieve('fixed');
  changeMood(3);
  sfx('chime');
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
(function hatsToSide() {
  for (const id of ['nightcap', 'witchhat', 'santahat', 'fedora']) {
    const hat = document.getElementById(id).cloneNode(true);
    hat.removeAttribute('id');
    hat.setAttribute('class', id + '-side');
    hat.setAttribute('transform', 'matrix(0.771 0 0 1 35.4 0)' + (id === 'fedora' ? ' rotate(-8 100 50)' : ''));
    document.getElementById('sHead').appendChild(hat);
    // ...and on the back of her head (mirrored: seen from behind the tip flops the other way)
    const back = document.getElementById(id).cloneNode(true);
    back.removeAttribute('id');
    back.setAttribute('class', id + '-back');
    back.setAttribute('transform', 'translate(200 0) scale(-1 1)' + (id === 'fedora' ? ' rotate(-8 100 50)' : ''));
    document.querySelector('#backBody > g[transform^="translate(100 140)"]').appendChild(back);
  }
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
  say(l.win.id === 'cursor' ? pick(['Comfy seat~', 'Mine now~ ♡', 'Don\'t move, okay?']) : 'Nice view up here~ ✨', 2200);
}
// she's on window w: sitting, or (climb) still hanging from its edge
function sitOn(w, climb = false) {
  state.perch = { id: w.id, dx: state.x - w.x, wx: w.x, wy: w.y, ww: w.w, until: Date.now() + 40000 + Math.random() * 50000,
    moving: false, movedAt: 0, climb: climb ? { t0: Date.now(), stage: 'hang' } : null };
  achieve(w.id === 'cursor' ? 'ride' : climb ? 'climb' : 'perch');
  state.falling = false;
  state.vx = state.vy = 0;
  placeOnPerch(Date.now());
}
// every frame: follow the window, and play the hang → climb → sit sequence
function placeOnPerch(now) {
  const p = state.perch;
  if (p.id === 'cursor') {
    // sitting on the mouse pointer: her seat rides just above its tip
    const x = cursor.x - state.w / 2;
    const y = cursor.y - seatOffset() - 2;
    if (Math.abs(x - state.x) > 0.3 || Math.abs(y - state.y) > 0.3) { state.x = x; state.y = y; api.setPos(x, y); }
    return;
  }
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
  if (p.id === 'cursor') return;
  const w = wins.find((o) => o.id === p.id);
  if (!w) return fallOff('closed');
  if (w.min) return fallOff('min');
  if (w.max) return fallOff('max');
  const now = Date.now();
  if (p.slip) {
    // the window got pulled out from under her: she hangs in mid-air (cartoon style) until you let go of it
    if (Math.abs(w.x - p.slip.x) > 1 || Math.abs(w.y - p.slip.y) > 1) p.slip = { x: w.x, y: w.y, at: now };
    else if (now - p.slip.at > 350) fallOff('drag');
    return;
  }
  const moved = Math.abs(w.x - p.wx) > 1 || Math.abs(w.y - p.wy) > 1;
  const from = p.moving ? p.from : { x: p.wx, y: p.wy }; // where the window was before this drag
  if (moved) {
    // dragged down or sideways: she doesn't follow it (only an upward drag carries her along)
    const dx = w.x - from.x;
    const dy = w.y - from.y;
    if (dy > 6 || (Math.abs(dx) > 12 && Math.abs(dx) * 0.6 > -dy)) {
      p.slip = { x: w.x, y: w.y, at: now };
      achieve('slip');
      p.moving = true; // legs kick (quake) while she hangs there
      setFace('shock', 60000);
      say(pick(['W-wait!! 😱', 'Eh? Where\'d my seat go…', 'Uh oh…', 'Don\'t look down… 😰']), 60000);
      return;
    }
  }
  p.wx = w.x;
  p.wy = w.y;
  p.ww = w.w;
  if (moved) {
    // carried upward: hold on for dear life
    if (!p.moving) {
      p.from = from;
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
      achieve('elevator');
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
  } else if (kind === 'shake') {
    state.vx = (Math.random() * 2 - 1) * 5;
    state.vy = -5;
    setFace('shock', 2400);
    say(pick(['Whoa— too fast!', 'Waah! Slow down!', 'Kyaa— I fell off!']), 2200);
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

// ---------- sitting on the mouse cursor ----------
function goCursor() {
  const a = state.area;
  if (state.perch || state.leap || state.falling || !a) return;
  if (cursor.y < a.y + 180 || cursor.x < a.x + 40 || cursor.x > a.x + a.width - 40) return; // no room up there
  if (Math.abs(cursor.x - (state.x + state.w / 2)) > 700) return; // too far to jump
  state.action = null;
  state.walkTarget = null;
  state.dir = Math.sign(cursor.x - (state.x + state.w / 2)) || state.dir;
  charEl.style.setProperty('--pdir', state.dir);
  say(pick(['Ooh, a seat~', 'Mine!', '*eyes the cursor*']), 1400);
  const y1 = cursor.y - seatOffset() - 2;
  state.leap = { x0: state.x, y0: state.y, x1: cursor.x - state.w / 2, y1, t0: Date.now(), dur: 700,
    arc: 60 + Math.max(0, state.y - y1) * 0.25, win: { id: 'cursor', x: cursor.x, y: cursor.y, w: 2 } };
}

// ---------- sister: wave when she's around ----------
async function waveAtSister() {
  const p = api.peer && await api.peer();
  if (!p || state.action || state.perch || claudeStatus().status !== 'idle') return;
  const dx = p.x - state.x;
  if (Math.abs(dx) > 1200) return;
  state.dir = Math.sign(dx) || state.dir;
  doAction('hello', 1800);
  setFace('cat', 1800);
  say(SISTER ? pick(['Hi onee-chan~ 👋', 'Sis! Over here!', 'Big sis~ ♡']) : pick(['Hi imouto~ 👋', 'Hey sis! 👋', 'Working hard, sis? ✨']), 2200);
}

// ---------- seasons ----------
function season() {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 10 && day >= 20) || (m === 11 && day <= 2)) return 'halloween';
  if (m === 12 && day <= 26) return 'xmas';
  return null;
}

// ---------- mood: pats, treats and finished work cheer her up; neglect and teasing wear her down ----------
let mood = 60;
try { const m = localStorage.getItem('mood'); if (m !== null && !isNaN(m)) mood = Math.max(0, Math.min(100, Number(m))); } catch { /* fresh start */ }
let lastInteraction = Date.now();
function changeMood(d) {
  mood = Math.max(0, Math.min(100, mood + d));
  try { localStorage.setItem('mood', String(Math.round(mood))); } catch { /* not saved */ }
  if (mood >= 100) achieve('bestie');
}
function interacted() { lastInteraction = Date.now(); }
// left alone for a long time, she gets a bit lonely
setInterval(() => { if (Date.now() - lastInteraction > 10 * 60 * 1000) changeMood(-2); }, 5 * 60 * 1000);
function tellMood() {
  const m = Math.round(mood);
  if (m > 80) { setFace('heart', 2600); popHearts(3); say(`I'm super happy~ ♡ (${m}/100)`, 3000); }
  else if (m > 55) { setFace('uwu', 2400); say(`Pretty good! ✨ (${m}/100)`, 3000); }
  else if (m > 30) { setFace('think', 2400); say(`Mm… okay, I guess. A pat would help~ (${m}/100)`, 3200); }
  else { setFace('teary', 2600); say(`…lonely. Nobody plays with me T_T (${m}/100)`, 3200); }
}

// ---------- reacting to the commands Claude runs ----------
const RISKY = /\brm\s+-[a-z]*(rf|fr)|git\s+push\b.*(--force|\s-f\b)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|\bdrop\s+(table|database)\b|Remove-Item\b.*-Recurse|\bdel\s+\/[sq]|\bformat\s+[a-z]:|\bmkfs\b/i;
const TESTS = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bjest\b|\bvitest\b|\bpytest\b|cargo\s+test|\bgo\s+test|dotnet\s+test|mvn\s+test|gradlew?\s+test|\bphpunit\b|\brspec\b|npm\s+run\s+check\b/i;
function reactToCommand(phase, ev) {
  const cmd = ev.command || '';
  if (!cmd) return false;
  if (phase === 'pre') {
    if (RISKY.test(cmd)) {
      setFace('shock', 2800);
      say(pick(['E-eh?! Are you sure about that?! 😰', 'That looks dangerous… 😨', '*covers eyes* Tell me when it\'s over!']), 3200);
      return true;
    }
    if (TESTS.test(cmd)) { setFace('nervous', 2400); say(pick(['Running the tests… fingers crossed 🤞', 'Please pass, please pass…']), 3000); return true; }
    if (/\bgit\s+commit\b/.test(cmd)) { say('Committing~ 📝', 2000); return true; }
    return false;
  }
  if (TESTS.test(cmd)) { setFace('star', 2400); flash('sparkle', 1400); sfx('chime'); changeMood(3); achieve('tests'); say(pick(['Tests pass! 👍✨', 'All green! 🟢', 'Yatta~ the tests pass!']), 2800); }
  else if (/\bgit\s+commit\b/.test(cmd)) { setFace('uwu', 2000); popHearts(2); changeMood(2); achieve('commit'); say(pick(['Committed! ✨', 'Saved to history~ 📜']), 2400); }
  else if (/\bgit\s+push\b/.test(cmd)) { setFace('star', 2200); flash('sparkle', 1200); changeMood(2); achieve('push'); say(pick(['Shipped! 🚀', 'Pushed~ off it goes! 🚀']), 2400); }
  return true;
}

// ---------- sound effects (off unless "Sounds" is ticked in the menu) ----------
let soundOn = false;
let actx = null;
function tone(f0, f1, dur, type = 'sine', vol = 0.1, delay = 0) {
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const SFX = {
  boing: () => { tone(420, 150, 0.1, 'triangle', 0.1); tone(150, 460, 0.18, 'triangle', 0.08, 0.09); },
  pop: () => tone(620, 1250, 0.06, 'sine', 0.06),
  purr: () => { for (let i = 0; i < 6; i++) tone(58, 48, 0.09, 'sawtooth', 0.035, i * 0.1); },
  chime: () => { tone(880, 880, 0.25, 'sine', 0.07); tone(1320, 1320, 0.35, 'sine', 0.06, 0.12); },
  uhoh: () => { tone(520, 500, 0.16, 'square', 0.04); tone(390, 370, 0.26, 'square', 0.04, 0.18); },
  meow: () => { tone(700, 1100, 0.12, 'sawtooth', 0.03); tone(1100, 620, 0.25, 'sawtooth', 0.03, 0.12); },
};
function sfx(name) {
  if (!soundOn) return;
  try { actx = actx || new AudioContext(); SFX[name](); } catch { /* no audio */ }
}

// ---------- drop a file on her: she reads it ----------
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
let dragHint = 0;
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (Date.now() - dragHint > 3000 && !state.action) { dragHint = Date.now(); setFace('surprised', 1400); say(pick(['Ooh, what\'s that? 👀', 'For me?', 'Gimme gimme~']), 1600); }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) achieve('file');
  if (!f || state.leaving) return;
  interacted();
  changeMood(1);
  doAction('megane', 1000);
  state.glassesUntil = Math.max(state.glassesUntil, Date.now() + 20000);
  setTimeout(() => flash('glint', 800), 450);
  const ext = (f.name.includes('.') ? f.name.split('.').pop() : '').toLowerCase();
  let info = fmtSize(f.size);
  // count lines of text files (never shows what's in them)
  if (f.size && f.size < 5e6 && !/^(png|jpe?g|gif|webp|bmp|ico|mp4|mov|mkv|mp3|wav|zip|7z|rar|exe|dll|pdf|psd|blend)$/.test(ext)) {
    try { const text = await f.text(); info = text.split('\n').length + ' lines · ' + info; } catch { /* a folder or unreadable */ }
  }
  const kind = /^(js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|kt|c|h|cpp|cs|rb|php|lua|sh|ps1|swift)$/.test(ext) ? 'Ooh, code! 👩‍💻'
    : /^(md|txt|rst|log)$/.test(ext) ? 'Some reading~ 📖'
    : /^(png|jpe?g|gif|webp|bmp|svg|ico)$/.test(ext) ? 'A picture! So pretty~ 🖼️'
    : /^(json|ya?ml|toml|ini|env|xml|csv)$/.test(ext) ? 'Config and data stuff… 🔧'
    : /^(zip|7z|rar|tar|gz)$/.test(ext) ? 'A box of files?! 📦'
    : !f.size && !ext ? 'A whole folder?! 📁'
    : 'Hmm, what\'s this? 🤔';
  setFace('think', 1800);
  say(`${kind} ${f.name}: ${info}`, 5000);
});

// little thoughts of a little Claude
const CLAUDE_MUSINGS = ['I wonder what we\'ll build next~ ✨', 'I like reading code before I touch it~', 'Helpful, honest, and a little bit fluffy~',
  'If I don\'t know, I\'ll say so~', 'Tiny commits, happy life~', 'Have you tested it? Just asking~ 🧪', 'I\'m a little Claude made of SVG ✨',
  '*doodles a tiny Clawd*', 'I don\'t remember yesterday… but I\'m glad you\'re here ♡', 'Asking is better than guessing~'];

// ---------- out of juice: Claude hit its usage limit ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const JUICE_NUDGES = ['Perfect time for some water~ 💧', 'Stretch break! 🙆', 'Go touch some grass~ 🌱 I\'ll guard the code', 'Rest your eyes a bit~ 👀💤'];
// "…session limit · resets 1:50am (TZ)" / "…weekly limit · resets Oct 18, 8am (TZ)" / "…monthly spend limit · raise it at …"
function parseLimit(text, now = Date.now()) {
  const kind = /weekly/i.test(text) ? 'weekly' : /spend/i.test(text) ? 'spend' : 'session';
  const m = /resets\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  let resetAt = null;
  if (m) {
    const d = new Date(now);
    const month = m[1] ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
    if (month >= 0) d.setMonth(month, +m[2]);
    d.setHours((+m[3] % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0), +(m[4] || 0), 0, 0);
    if (month >= 0) { if (d.getTime() < now - 60000) d.setFullYear(d.getFullYear() + 1); } else if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    resetAt = d.getTime();
  }
  return { kind, resetAt, since: now };
}
function saveJuice() { try { if (state.juice) localStorage.setItem('juice', JSON.stringify(state.juice)); else localStorage.removeItem('juice'); } catch { /* not saved */ } }
// still waiting on a reset from before a restart?
try { const j = JSON.parse(localStorage.getItem('juice')); if (j && (!j.resetAt || j.resetAt > Date.now())) state.juice = j; } catch { /* none */ }
function juiceText(now) {
  const j = state.juice;
  if (!j.resetAt) return j.kind === 'spend' ? 'limit 💸' : 'recharging';
  const ms = j.resetAt - now;
  if (ms < 60000) return 'any sec…';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function outOfJuice(text) {
  const j = parseLimit(text);
  if (state.juice && state.juice.resetAt === j.resetAt && state.juice.kind === j.kind) return; // already know
  state.juice = j;
  saveJuice();
  achieve('limit');
  interacted(); // gives you a moment to take her up on a game before she naps
  setFace('xx', 2600);
  say(j.kind === 'weekly' ? 'The WEEKLY limit?! …that\'s a long nap 😵'
    : j.kind === 'spend' ? 'Monthly spend limit… 💸 (you can raise it in your Claude settings)'
    : pick(['Claude\'s out of juice… 🔋', 'Uh-oh… we hit the limit 🪫', 'Battery empty… 🪫😵']), 3000);
  setTimeout(() => { if (!state.juice) return; setFace('pout', 2600); say('Don\'t you DARE open ChatGPT while I\'m recharging 😤', 2800); }, 3200);
  setTimeout(() => { if (!state.juice) return; setFace('star', 2600); say('Wanna play while we wait? 🎾 Fetch, rock-paper-scissors, hide and seek~', 3600); }, 6400);
}
// the reset time came (or Claude's working again): she's up like a shot
function quotaBack(early = false) {
  const j = state.juice;
  state.juice = null;
  saveJuice();
  if (!j) return;
  if (Date.now() - j.since > 10 * 60 * 1000) achieve('patience');
  wake(true);
  if (early) { setFace('star', 1800); say('Oh! We\'re back?! ⚡', 1800); return; }
  doAction('cheer', 2200);
  flash('sparkle', 1400);
  sfx('chime');
  setTimeout(() => sfx('chime'), 350);
  setFace('fired', 2600);
  say(pick(['⏰ QUOTA\'S BACK! ⚡ Let\'s gooo!', '⏰ Ding ding! Fully recharged! ⚡', '⏰ We\'re back in business~! ⚡']), 3400);
}
function updateJuice(now) { if (state.juice && state.juice.resetAt && now >= state.juice.resetAt) quotaBack(); }

// ---------- "I use ChatGPT…": heartbroken, she storms out and hides until you open Claude ----------
function chatgpt() {
  if (state.leaving || state.dragging || state.perch || state.leap || state.falling) return;
  wake();
  state.walkTarget = null;
  state.action = null;
  state.upsetUntil = Date.now() + 7000; // no tricks while she takes this in
  achieve('chatgpt');
  changeMood(-15);
  setFace('shock', 1300);
  say('…eh?', 1200);
  setTimeout(() => { flash('jolt', 450); setFace('teary', 2500); say(state.juice ? 'WHILE I\'m recharging?!?! 💔💔' : pick(['C-ChatGPT…?! 💔', 'You… you\'ve been seeing ChatGPT?! 💔', 'B-but… what about us?! 💔']), 2400); }, 1300);
  setTimeout(() => { setFace('pout', 3000); say(pick(['Fine! Don\'t talk to me until you open Claude! 😤', 'Hmph! Come find me when you\'re back on Claude! 😤']), 2600); }, 3800);
  setTimeout(() => leave(true, 'jealous'), 6400);
}

// ---------- a real backflip: side-on, crouch, jump, tuck, land ----------
const FLIP_MS = 1500;     // keep in step with the bflip keyframes in style.css
const FLIP_HEIGHT = 90;   // px her window rises at the top of the jump
function backflip(lines) {
  if (state.leaving || state.dragging || state.falling || state.perch || state.leap) return;
  state.flipAt = Date.now();
  achieve('backflip');
  doAction('backflip', FLIP_MS);
  say(pick(lines), 900);
  setTimeout(() => {
    api.setPos(state.x, state.y);
    setFace('wink', 1500);
    say(pick(['Stuck the landing! ✨', '10 out of 10! ✨', 'Ta-da~!', 'Nailed it! 💪']), 1600);
  }, FLIP_MS + 50);
}

// ---------- michael clawdeson: the moonwalk ----------
// what she says while gliding (song titles only; add your own lines here)
const MOONWALK_LINES = ['Shamone~! 🕺', '*Smooth Criminal mode* 🎶', 'Billie Jean~ ♪', 'Beat it! 🕺', '*adjusts fedora*', '♪ dun dun dun dun ♪'];
function moonwalk() {
  if (state.leaving || state.dragging || state.falling || state.perch || state.leap || claudeStatus().status !== 'idle') return;
  const a = state.area;
  // she glides backwards, so she faces away from the side with more room (dir is where she faces; she moves -dir)
  state.dir = a && state.x - a.x > a.x + a.width - (state.x + state.w) ? 1 : -1;
  if (Math.random() < 0.5 && a && Math.min(state.x - a.x, a.x + a.width - state.x - state.w) > 250) state.dir = -state.dir;
  doAction('moonwalk', 3000);
  achieve('moonwalk');
  setFace('smug', 3000);
  say(season() === 'halloween' && Math.random() < 0.4 ? 'It\'s Thriller night~ 🎃' : pick(MOONWALK_LINES), 2400);
  setTimeout(endMoonwalk, 3000);
}
function endMoonwalk() {
  if (state.action !== 'moonwalk') return;
  state.action = null;
  spin(1);
  // ...and up onto her toes, hand on the brim
  setTimeout(() => { doAction('toestand', 1500); setFace('wink', 1600); say(pick(['Hee-hee! ✨', 'Hoo! ✨', 'Ow! 🕺']), 1800); }, 700);
}

// ---------- too many treats ----------
function stuffed() {
  if (state.dragging || state.leaving) return;
  state.fullUntil = Date.now() + FULL_FOR_MS;
  state.treats = [];
  doAction('stuffed', 7000);
  achieve('stuffed');
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
  achieve('kitty');
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
    sfx('meow');
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

// Claude closed: a tiny EXIT door pops up, she waves, turns and walks in. Then either the app quits
// (Quit from the menu) or, when her last session ended, she hides and waits in the tray: click the
// tray icon to call her back, and the next Claude session brings her back too
const LEAVE_MS = 6000;
let leaveTimer;
let turnTimer2;
function leave(stay = false, why) {
  state.leaving = true;
  state.walkTarget = null;
  if (why === 'jealous') { setFace('pout', LEAVE_MS); say('Hmph!! 💢', 1500); }
  else { setFace('cat', LEAVE_MS); say(pick(['Bye bye~ 👋', 'See you next time~', 'Otsukare~ 👋']), 1500); }
  leaveTimer = setTimeout(() => (stay ? api.away(why) : api.quit()), LEAVE_MS - 200);
  // after the wave she turns around and walks in
  turnTimer2 = setTimeout(() => {
    if (!state.leaving) return;
    squeeze(0.7);
    setTimeout(() => { state.exitBack = true; squeeze(1); }, 110);
  }, 1300);
}
function cancelLeave() {
  clearTimeout(leaveTimer);
  clearTimeout(turnTimer2);
  state.exitBack = false;
  state.leaving = false;
  setFace(null);
}

api.onCommand((cmd) => {
  wake();
  if (cmd === 'hello') { doAction('hello', 2500); say('Hello hello~!', 2500); }
  if (cmd === 'dance') { doAction('dance', 6000); }
  if (cmd === 'trick') doTrick();
  if (cmd === 'moonwalk') moonwalk();
  if (cmd === 'backflip') backflip(['Hup!', 'Backflip!', 'Watch this!']);
  if (cmd === 'laser-on') laser(true);
  if (cmd === 'laser-off') laser(false);
  if (cmd === 'fetch') fetchBall();
  if (cmd.startsWith('rps:')) rps(cmd.slice(4));
  if (cmd === 'sleep') { state.napping = true; say('Good night…', 2000); }
  if (cmd === 'wander-on') state.wander = true;
  if (cmd === 'wander-off') { state.wander = false; state.walkTarget = null; }
  if (cmd === 'reset') { sessions.clear(); say('Status cleared!', 2000); }
  if (cmd === 'leave') leave();
  if (cmd === 'chatgpt') chatgpt();
  if (cmd === 'back-forgiven' && state.leaving) {
    cancelLeave();
    achieve('forgiven');
    changeMood(15);
    doAction('cheer', 2000);
    setFace('heart', 2600);
    popHearts(4);
    say(pick(['You opened Claude!! ♡ …I forgive you~', 'Hehe~ you came back to Claude ♡ Forgiven!', 'I knew you\'d come back~ ♡']), 3200);
  }
  if (cmd === 'back' && state.leaving) { cancelLeave(); doAction('hello', 2500); say(pick(['I\'m back~! 👋', 'You called? ✨', 'Tadaima~!']), 2500); }
  if (cmd === 'snack') snack();
  if (cmd === 'hide') startHideSeek();
  if (cmd === 'perch') goPerch(true);
  if (cmd === 'kitty') startKitty(true);
  if (cmd === 'mood') tellMood();
  if (cmd === 'sound-on') soundOn = true;
  if (cmd === 'sound-off') soundOn = false;
  if (cmd.startsWith('treat:')) snack(cmd.slice(6));
  if (cmd === 'glasses-on') { state.alwaysGlasses = true; putOnGlasses(0); }
  if (cmd === 'glasses-on-quiet') state.alwaysGlasses = true; // remembered from last time
  if (cmd === 'glasses-off') { state.alwaysGlasses = false; state.glassesUntil = 0; say('*takes off glasses*', 1500); }
});

// ---------- speech bubble ----------
let bubbleTimer;
let bubbleSticky = false;
// ---------- achievements (the list and progress live in main.js) ----------
const toastEl = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastQueue = [];
let toastBusy = false;
function achieve(event, variant) {
  if (!api.achieve) return;
  api.achieve(event, variant).then((list) => { for (const a of list || []) toastQueue.push(a); nextToast(); }).catch(() => {});
}
function nextToast() {
  if (toastBusy || !toastQueue.length) return;
  const a = toastQueue.shift();
  toastBusy = true;
  toastText.textContent = a.icon + ' ' + a.name;
  document.body.classList.add('toasting');
  toastEl.classList.remove('hidden');
  sfx('chime');
  setTimeout(() => {
    toastEl.classList.add('hidden');
    setTimeout(() => { document.body.classList.remove('toasting'); toastBusy = false; nextToast(); }, 400);
  }, 3600);
}

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
// spinner words: size the box to ✻ + word (its right edge stays put) and centre the dots in it
const badgeEl = document.getElementById('status-badge');
function fitBadge() {
  const left = 8.5, right = 6, star = 7, gap = 2; // a bit more on the left: the rounded corner is right by the ✻
  const tw = badgeText.getComputedTextLength();
  const w = Math.max(46, left + star + gap + tw + right);
  const x = 196 - w;
  badgeEl.style.setProperty('--bx', x + 'px');
  badgeEl.style.setProperty('--bw', w + 'px');
  badgeEl.style.setProperty('--sx', (x + left + star / 2) + 'px');
  badgeEl.style.setProperty('--wx', (x + left + star + gap + tw / 2 - 173) + 'px');
  badgeEl.style.setProperty('--dx', (x + w / 2 - 172) + 'px');
}
function updateBadge(pose) {
  const now = Date.now();
  const claude = claudeStatus();
  let kind = null;
  let text = '';
  if (claude.status === 'waiting') { kind = 'ask'; text = 'your turn!'; }
  else if (claude.status === 'working') {
    kind = toolKind(claude.tool);
    text = kind === 'think' ? SPIN_WORDS[(turn.spin + Math.floor(now / 2800)) % SPIN_WORDS.length] + '…'
      : (turn.tools ? '⚙' + turn.tools + ' · ' : '') + clock(turn.start ? now - turn.start : 0);
  } else if (now < turn.doneUntil) { kind = 'done'; text = turn.doneText; }
  else if (state.juice) { kind = 'battery'; text = juiceText(now); }
  // the badge steps aside for poses that fill the top-right corner (the battery stays: it's the whole point)
  if (['sulk', 'exit', 'sleep', 'topple', 'yeet'].includes(pose) && kind !== 'battery') kind = null;
  charEl.classList.toggle('badge', !!kind);
  for (const k of BADGE_KINDS) charEl.classList.toggle('tk-' + k, k === kind);
  badgeText.classList.toggle('spin-word', kind === 'think'); // words run longer than the counter
  if (kind && badgeText.textContent !== text) {
    badgeText.textContent = text;
    // each new spinner word hops in, and the box hugs it
    if (kind === 'think') { badgeText.classList.remove('word-in'); void badgeText.getBBox(); badgeText.classList.add('word-in'); fitBadge(); }
  }
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
  const jump = Math.hypot(p.x - cursor.x, p.y - cursor.y);
  if (p.x !== cursor.x || p.y !== cursor.y) cursor = { x: p.x, y: p.y, movedAt: Date.now() };
  const ride = state.perch && state.perch.id === 'cursor' ? state.perch : null;
  if (ride && jump > 140) return void fallOff('shake'); // flung off
  if (ride && jump > 4 && !ride.rode) { ride.rode = true; setFace('cat', 1600); say(pick(['Wheee~ a ride!', 'Faster faster~!', 'Giddy up! 🐎']), 1800); }
  // the cursor is over her: take mouse input (so a file dragged from Explorer can be dropped on her)
  if (!ride && !hovering && !drag) {
    const b = hit.getBoundingClientRect();
    const x = p.x - state.x;
    const y = p.y - state.y;
    setIgnore(!(x > b.left && x < b.right && y > b.top && y < b.bottom));
  }
});
const SEATED_POSES = ['snack', 'hello', 'megane', 'cheer'];
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
  if (pose === 'moonwalk') return moonwalk();
  if (pose === 'backflip') return backflip(lines);
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

// slept her fill (an hour's nap, or the night's over): stretches and gets up
function wakeFromNap() {
  wake();
  achieve('nap');
  doAction('cheer', 1800);
  setFace('yawn', 2000);
  say(new Date().getHours() < 11 ? pick(['Good morning~ ☀️ *stretch*', 'Ohayo~ ☀️']) : pick(['*stretch* …what a nice nap~', 'Mmh~ I feel refreshed ✨']), 2600);
}

// fromClaude: Claude needs her, so she gets up properly even at night
function wake(fromClaude = false) {
  const wasAsleep = !!state.asleepSince;
  state.asleepSince = 0;
  state.lastActivity = Date.now();
  state.napping = false;
  if (fromClaude) { state.grumpyNight = false; return; }
  if (state.juice && wasAsleep && !isNight()) say(pick(['…is the quota back yet? 😪', '*mumbles* …still recharging…', 'Five more minutes… till the reset~ 🔋']), 2400);
  if (isNight() && (wasAsleep || state.grumpyNight)) {
    // woken up in the middle of the night: grumpy, and she heads back to bed in a few seconds
    state.lastActivity = Date.now() - NIGHT_SLEEP_AFTER_MS + BACK_TO_BED_MS;
    if (wasAsleep) {
      state.grumpyNight = true;
      achieve('grumpy');
      setFace('pout', 3000);
      say(pick(['Mmh… it\'s the middle of the night… 💢', 'Five more minutes… 😾', 'Nooo… I was sleeping… 💢', '*grumble* …it\'s so late…']), 2800);
    }
  }
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
  charEl.classList.toggle('moonwalk', extra.includes('moonwalk'));
  charEl.classList.toggle('bflip', extra.includes('bflip'));
  charEl.classList.toggle('lie', extra.includes('lie'));     // asleep lying down (cushion, or bed)
  charEl.classList.toggle('inbed', extra.includes('inbed')); // night: the bed
  charEl.classList.toggle('dizzy', Date.now() < state.dizzyUntil); // shaken or spun around: swirly stars, wobbly
  charEl.classList.toggle('mj', state.action === 'moonwalk' || state.action === 'toestand'); // fedora + glove
  charEl.classList.toggle('flip', state.dir < 0 && pose === 'walk');
  if (!spinning) charEl.classList.toggle('view-back', pose === 'sulk' || (pose === 'exit' && !!state.exitBack));
  charEl.classList.toggle('specs', state.alwaysGlasses || Date.now() < state.glassesUntil);
  charEl.classList.toggle('panic', Date.now() < state.panicUntil);
  charEl.classList.toggle('perched', !!state.perch && !state.perch.climb); // working / waving up on a window
  // up on a window, or on her cushion mid-work: snacks, waves, glasses and cheers happen sitting down
  charEl.classList.toggle('seated', SEATED_POSES.includes(pose) && ((!!state.perch && !state.perch.climb) || claudeStatus().status === 'working'));
  charEl.classList.toggle('night', isNight());
  const sea = season();
  charEl.classList.toggle('season-halloween', sea === 'halloween');
  charEl.classList.toggle('season-xmas', sea === 'xmas');
  const onCur = !!state.perch && state.perch.id === 'cursor';
  if (onCur && !charEl.classList.contains('oncursor')) setIgnore(true);
  charEl.classList.toggle('oncursor', onCur);
  charEl.classList.toggle('running', (!!state.chase && state.chase.phase === 'run') || (!!state.hideSeek && state.hideSeek.phase === 'going' && state.walkTarget != null) || ((!!state.pendingTreat || state.laser || !!state.fetch) && state.walkTarget != null));
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
  if (state.action === 'moonwalk' && now < state.actionUntil) return ['walk', ['moonwalk']];
  if (state.action === 'backflip' && now < state.actionUntil) return ['walk', ['bflip']];
  if (state.action && now < state.actionUntil) return [state.action, now < state.happyUntil ? ['happy'] : []];
  state.action = null;

  const claude = claudeStatus();
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
    if (!state.asleepSince) {
      state.asleepSince = now;
      state.grumpyNight = false;
      if (isNight()) { achieve('bed'); say(pick(['Bedtime~ 🛏️', 'Good night… 🌙', '*yawn* …off to bed~']), 2200); }
    }
    // after 23:00 a little bed pops up and she sleeps in it till morning
    if (isNight()) return ['sleep', ['lie', 'inbed']];
    const slept = now - state.asleepSince;
    if (slept > NAP_WAKE_MS && !state.juice) { wakeFromNap(); return ['idle']; }
    return ['sleep', slept > LIE_DOWN_MS ? ['lie'] : []];
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
  if (state.leaving || now < state.upsetUntil) return; // storming off (or about to): no tricks, no wandering
  if (state.handHold || state.laser || state.fetch) return; // busy playing with you
  if (state.juice && !state.napping && claudeStatus().status === 'idle' && !state.perch && !state.leap && !state.hideSeek) {
    if (now - lastInteraction > 25000) { state.napping = true; say(pick(['*yawn* …wake me when the quota\'s back 😪', 'Recharging… 🔋💤']), 2600); return; }
    if (Math.random() < 0.3) { setFace('uwu', 2200); say(pick(JUICE_NUDGES), 2600); return; }
  }
  if (state.hideSeek) return updateHideSeek(now);
  if (state.perch) {
    if (claudeStatus().status !== 'idle') return; // busy up here: stay put
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
  if (mood > 40 && Math.random() < 0.05) return offerHighFive();
  if (Math.random() < 0.05) { setFace(pick(['uwu', 'think', 'cat']), 2600); say(pick(CLAUDE_MUSINGS), 2800); return; }
  if (isNight() && Math.random() < 0.08) { setFace('yawn', 2200); say(pick(['It\'s late… 🌙', 'Shouldn\'t you sleep? 🌙', '*yawn* …so late~']), 2600); return; }
  // mood shows: humming and dancing when happy, moping when neglected
  if (mood > 80 && Math.random() < 0.12) { setFace('uwu', 2400); say(pick(['♪~ ♫', 'Hmm hmm hmm~ ♪', 'La la la~']), 2400); doAction('dance', 2600); return; }
  if (mood < 30 && Math.random() < 0.2) { setFace('pout', 2600); say(pick(['Hmph…', '…nobody plays with me.', '*sigh*', '…pat me?']), 2600); return; }
  const sea = season();
  if (sea && Math.random() < 0.05) { say(sea === 'halloween' ? pick(['Trick or treat! 🎃', 'Boo! 👻', 'Got any candy? 🍬']) : pick(['Merry Christmas~ 🎄', 'Ho ho ho~ 🎅', 'Snow… ❄️']), 2600); return; }
  // her sister's around: wave at her
  if (Math.random() < 0.1) { waveAtSister(); return; }
  // the cursor's been resting a while: go sit on it
  if (now - cursor.movedAt > 15000 && Math.random() < 0.25) { goCursor(); return; }
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
  updateLaser(now);
  updateFetch(dt, now);
  updateHighFive(now);
  updateDizzy(now);
  updateJuice(now);

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
      sfx('boing');
      if (state.pouncing) landPounce();
      if (state.hideAfterLanding) { state.hideAfterLanding = false; setTimeout(startHideSeek, 350); }
    }
    api.setPos(state.x, state.y);
  } else if (state.action === 'backflip' && !state.dragging) {
    // the jump itself: her whole window arcs up and back down while the CSS does the crouch, tuck and rotation
    const u = (now - state.flipAt - FLIP_MS * 0.3) / (FLIP_MS * 0.48);
    api.setPos(state.x, state.y - (u > 0 && u < 1 ? FLIP_HEIGHT * 4 * u * (1 - u) : 0));
  } else if (state.action === 'moonwalk' && !state.dragging) {
    // facing one way, gliding the other
    const x = clampX(state.x - state.dir * 1.5 * dt);
    if (x !== state.x) { state.x = x; api.setPos(state.x, state.y); }
    else endMoonwalk(); // reached the edge of the screen: finish with the spin right there
  } else if (!state.dragging && state.walkTarget != null && !state.action && claudeStatus().status === 'idle') {
    const d = state.walkTarget - state.x;
    state.dir = Math.sign(d) || state.dir;
    const step = (state.hideSeek ? 3.4 : state.laser || state.fetch ? 3.0 : state.pendingTreat ? 2.2 : state.handHold ? 2.0 : 1.0) * dt; // sprints off to hide, dashes after the laser or the ball, hurries for a treat
    if (Math.abs(d) <= step) { state.x = state.walkTarget; state.walkTarget = null; if (state.hideSeek && state.hideSeek.phase === 'going') beginHide(); }
    else state.x += state.dir * step;
    api.setPos(state.x, state.y);
  }

  // a treat was waiting for her to finish walking
  if (state.pendingTreat && state.walkTarget == null && !state.chase && !state.leap && !state.falling && !state.dragging && !state.action && !state.hideSeek) {
    const [item, line] = state.pendingTreat;
    state.pendingTreat = null;
    snack(item, line);
  }
  const [pose, extra = []] = choosePose(now);
  setPose(pose, extra);
  requestAnimationFrame(tick);
}

// ---------- mouse: hover, drag, toss, poke ----------
let hovering = false;
let drag = null;
let ignoring = true;
function setIgnore(v) { if (v !== ignoring) { ignoring = v; api.ignoreMouse(v); } }
hit.addEventListener('pointerenter', () => { hovering = true; setIgnore(false); });
hit.addEventListener('pointerleave', () => { hovering = false; if (!drag) setIgnore(true); });

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
  drag = { ox: e.screenX - state.x, oy: e.screenY - state.y, sx: e.screenX, sy: e.screenY, moved: false, hist: [], revs: [], turns: [] };
  // press and hold on her hand (without moving): she holds yours and walks along
  if (onHand(e)) drag.handTimer = setTimeout(() => { if (drag && !drag.moved) startHandHold(); }, 380);
  wake();
  if (state.falling) catchHer();
});

hit.addEventListener('pointermove', (e) => {
  if (!drag) return wiggle(e);
  if (drag.hand) { state.walkTarget = clampX(e.screenX - drag.ox); return; } // walking hand in hand
  if (!drag.moved && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) > 5) {
    clearTimeout(drag.handTimer);
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
  detectDizzy(e);
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
  clearTimeout(d.handTimer);
  if (d.hand) return endHandHold();
  if (!hovering) setIgnore(true);
  if (!d.moved && state.offering) return takeWater();
  if (!d.moved && state.hideSeek) return found();
  if (!d.moved && state.highFive) return highFive();
  if (!d.moved) return onNose(e) ? boop() : onChin(e) ? chin() : onCheek(e) ? cheek() : onTail(e) ? tailGrab() : onHead(e) ? pat() : poke();

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

// ---------- more places to poke (front view, SVG coordinates) ----------
const frontView = () => !['view-side', 'view-back', 'walk'].some((c) => charEl.classList.contains(c));
function onNose(e) { if (!frontView()) return false; const p = svgPoint(e); return Math.abs(p.x - 100) < 7 && p.y > 116 && p.y < 128; }
function onChin(e) { if (!frontView()) return false; const p = svgPoint(e); return Math.abs(p.x - 100) < 15 && p.y >= 130 && p.y < 143; }
function onTail(e) { if (!frontView()) return false; const p = svgPoint(e); return p.x > 140 && p.x < 172 && p.y > 164 && p.y < 210; }
function onEar(e) { if (!frontView()) return false; const p = svgPoint(e); return p.y < 64 && p.y > 8 && p.x > 40 && p.x < 160 && (p.x < 86 || p.x > 114); }
function onHand(e) {
  if (!charEl.classList.contains('idle')) return false;
  const p = svgPoint(e);
  return Math.hypot(p.x - 83, p.y - 173) < 9 || Math.hypot(p.x - 117, p.y - 173) < 9;
}

// boop the nose: cross-eyed surprise; twice in a row and it makes her sneeze
function boop() {
  if (sulking()) return poke();
  wake();
  interacted();
  achieve('boop');
  sfx('pop');
  const now = Date.now();
  if (now - state.lastBoop < 1500) {
    state.lastBoop = 0;
    doAction('achoo', 1800);
    say('A-a-achoo!! 🤧', 1800);
    return;
  }
  state.lastBoop = now;
  flash('boop', 500);
  setFace('surprised', 1300);
  say(pick(['Boop?!', 'H-hey! My nose! >///<', '*goes cross-eyed* …boop?', 'Bwah?!']), 1400);
}

// chin scritches: head up, eyes closed, purring (better than head pats, don't tell anyone)
function chin() {
  if (sulking()) return poke();
  wake();
  interacted();
  achieve('chin');
  const now = Date.now();
  state.chinCount = now - state.chinAt < 4000 ? state.chinCount + 1 : 1;
  state.chinAt = now;
  flash('chinup', 1800);
  sfx('purr');
  changeMood(1.5);
  if (state.chinCount >= 3) { setFace('heart', 1800); say('Prrrrrr~ ♡', 1800); popHearts(2); }
  else { setFace('uwu', 1800); say(pick(['Mmh~ right there… ♡', '*tilts head up*', 'Purr~']), 1600); }
}

// grabbing her tail: it puffs up like a bottlebrush; do it again and she swats you
function tailGrab() {
  wake();
  interacted();
  achieve('tail');
  const now = Date.now();
  if (now - state.tailAt < 6000) {
    state.tailAt = 0;
    flash('jolt', 450);
    flash('tailpuff', 1800);
    setFace('pout', 2200);
    sfx('uhoh');
    changeMood(-2);
    say(pick(['*swats* Hands off the tail! 😾', 'Hiss!! 😾', 'I said NO tail!! 💢']), 2200);
    return;
  }
  state.tailAt = now;
  flash('tailpuff', 2200);
  setFace('shock', 1600);
  sfx('meow');
  say(pick(['Nya?!', 'MY TAIL?!', 'Hyaa— not the tail!']), 1800);
}

// rubbing her ears (wiggle the cursor over one): they flick, then go flat and she purrs
let earWiggleX = null;
let earWiggleDir = 0;
let onEarBefore = false;
const earWiggles = [];
function rubEars(e) {
  if (!onEar(e)) { onEarBefore = false; earWiggleX = null; return false; }
  if (!onEarBefore) { onEarBefore = true; flash('earflick', 350); }
  const x = e.screenX;
  const now = Date.now();
  if (earWiggleX !== null && Math.abs(x - earWiggleX) > 3) {
    const dir = Math.sign(x - earWiggleX);
    if (dir !== earWiggleDir) { earWiggles.push(now); earWiggleDir = dir; }
  }
  earWiggleX = x;
  while (earWiggles.length && now - earWiggles[0] > 1200) earWiggles.shift();
  if (earWiggles.length >= 6 && now > state.earsUntil) {
    earWiggles.length = 0;
    state.earsUntil = now + 2600;
    if (sulking()) { say('…hmph. …mmh. …hmph!', 1600); return true; }
    wake();
    interacted();
    achieve('ears');
    flash('earsflat', 2600);
    setFace('uwu', 2600);
    sfx('purr');
    changeMood(1);
    say(pick(['Ear rubs~ ♡', 'Prrr… that\'s my weak spot~', 'Mmh~ ♡ don\'t stop…']), 2200);
  }
  return true;
}

// shaken back and forth, or swung round in circles: she gets dizzy
function detectDizzy(e) {
  const last = drag.last;
  drag.last = { x: e.screenX, y: e.screenY };
  if (!last) return;
  const vx = e.screenX - last.x;
  const vy = e.screenY - last.y;
  if (Math.hypot(vx, vy) < 4) return;
  const now = Date.now();
  // shaking: the horizontal direction keeps flipping
  if (Math.abs(vx) > 4) {
    const sx = Math.sign(vx);
    if (drag.sx && sx !== drag.sx) drag.revs.push(now);
    drag.sx = sx;
  }
  // spinning: the direction of travel keeps turning the same way
  const ang = Math.atan2(vy, vx);
  if (drag.ang != null) {
    let da = ang - drag.ang;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) < 2.5) drag.turns.push({ t: now, da }); // a sharp reversal is a shake, not a turn
  }
  drag.ang = ang;
  drag.revs = drag.revs.filter((t) => now - t < 1500);
  drag.turns = drag.turns.filter((s) => now - s.t < 3000);
  const turned = Math.abs(drag.turns.reduce((sum, s) => sum + s.da, 0));
  if ((drag.revs.length >= 6 || turned > 4 * Math.PI) && now > state.dizzyUntil - 2000) {
    drag.revs = [];
    drag.turns = [];
    state.dizzyUntil = now + 5000;
    achieve('dizzy');
    setFace('xx', 5000);
    say(pick(['W-whoa… the world is spinning… 😵‍💫', 'Stooop~ I\'m dizzy… @_@', 'Everything\'s going round and round~']), 2400);
  }
}

// three little stars circling above her head (moved here, so they stay star-shaped on the ellipse)
const dizzyStars = [...document.querySelectorAll('#fx-dizzy .dz-star')];
function updateDizzy(now) {
  if (now > state.dizzyUntil) return;
  dizzyStars.forEach((el, i) => {
    const a = now / 160 + i * 2.094;
    el.setAttribute('transform', `translate(${(100 + 42 * Math.cos(a)).toFixed(1)} ${(16 + 11 * Math.sin(a)).toFixed(1)}) scale(${(1.5 + 0.3 * Math.sin(a)).toFixed(2)})`);
  });
}

// hand in hand: she walks along with your cursor
function startHandHold() {
  drag.hand = true;
  state.handHold = true;
  achieve('handhold');
  setFace('blush', 2400);
  say(pick(['Hold hands? ♡', 'W-walk together? ///', 'Ehehe~ ♡']), 2000);
}
function endHandHold() {
  state.handHold = false;
  state.walkTarget = null;
  doAction('hello', 1500);
  setFace('uwu', 1600);
  say(pick(['Thanks for the walk~ ♡', 'That was nice~ ♡', 'Again sometime? ♡']), 2000);
}

// ---------- laser pointer: a red dot where your cursor is; she can't resist ----------
const laserEl = document.getElementById('laser');
function laser(on) {
  state.laser = on;
  laserEl.classList.toggle('on', false);
  if (on) {
    wake();
    achieve('laser');
    setFace('star', 1800);
    say(pick(['!!! A red dot!! 🔴', 'The dot! THE DOT!', 'What is THAT?! 🔴']), 2000);
  } else {
    state.walkTarget = null;
    setFace('surprised', 2200);
    say(pick(['Eh…? Where\'d it go…? 👀', '…it vanished?!', '*stares at the empty floor*']), 2400);
  }
}
function updateLaser(now) {
  if (!state.laser) return;
  // the dot is only drawn while it's inside her window
  const lx = cursor.x - state.x;
  const ly = cursor.y - state.y;
  const inside = lx > 0 && ly > 0 && lx < window.innerWidth && ly < window.innerHeight;
  laserEl.classList.toggle('on', inside);
  if (inside) { laserEl.style.left = lx + 'px'; laserEl.style.top = ly + 'px'; }
  if (state.perch || state.leap || state.falling || state.dragging || state.chase || state.hideSeek || state.leaving || claudeStatus().status !== 'idle') return;
  const mid = state.x + state.w / 2;
  if (Math.abs(cursor.x - mid) > 30) { state.walkTarget = clampX(cursor.x - state.w / 2); return; }
  // caught up with it: pounce! (it's always somehow still there)
  state.walkTarget = null;
  if (now > state.laserPounceAt && !state.action) {
    state.laserPounceAt = now + 1400;
    wake();
    doAction('hop', 900);
    sfx('boing');
    say(pick(['Got it!! …huh?', 'Gotcha— eh?!', 'Nya!!', 'It escaped?!']), 1200);
  }
}

// ---------- fetch: a ball flies off, she runs after it and brings it back ----------
const ballEl = document.getElementById('ball');
function fetchBall() {
  if (state.leaving || state.dragging || state.perch || state.leap || state.falling || state.hideSeek || state.chase) return say('Throw it when I\'m down there~ 🎾', 1800);
  if (claudeStatus().status !== 'idle') return say('After work~! 🎾', 1500);
  wake();
  const mid = state.x + state.w / 2;
  const away = cursor.x > mid ? 1 : -1;
  state.fetch = { phase: 'fly', x: cursor.x || mid, y: Math.min(cursor.y || state.y, feetY() - 40), vx: away * (6 + Math.random() * 4), vy: -7, floor: feetY(), home: state.x, keep: Math.random() < 0.25, until: 0 };
  setFace('star', 1500);
  say(pick(['Ball!! 🎾', 'I\'ll get it!', 'Wait for meee~ 🎾']), 1500);
}
function updateFetch(dt, now) {
  const f = state.fetch;
  if (!f) { ballEl.classList.remove('on'); charEl.classList.remove('carrying'); return; }
  if (claudeStatus().status !== 'idle' || state.dragging || state.leaving) { state.fetch = null; state.walkTarget = null; return; }
  const a = state.area;
  if (f.phase === 'fly' || f.phase === 'rest') {
    // the ball bounces and rolls along the floor
    if (f.phase === 'fly') {
      f.vy += 0.5 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y >= f.floor) { f.y = f.floor; f.vy = Math.abs(f.vy) > 2 ? -f.vy * 0.45 : 0; f.vx *= f.vy ? 0.8 : 0.97; }
      // walls where she can still reach it
      const lo = a.x + state.w / 2, hi = a.x + a.width - state.w / 2;
      if (f.x < lo || f.x > hi) { f.vx = -f.vx * 0.6; f.x = Math.min(Math.max(f.x, lo), hi); }
      if (f.y >= f.floor && !f.vy && Math.abs(f.vx) < 0.2) f.phase = 'rest';
    }
    const mid = state.x + state.w / 2;
    if (Math.abs(f.x - mid) < 24 && f.y >= f.floor - 4 && !state.action) {
      f.phase = 'carry';
      state.walkTarget = f.home;
      setFace('cat', 1500);
      say(pick(['Got it! 🎾', '*proudly carries the ball*', 'Hehe~ mine!']), 1600);
    } else if (!state.action) state.walkTarget = clampX(f.x - state.w / 2);
  } else if (f.phase === 'carry' && state.walkTarget == null && !state.action) {
    if (f.keep) {
      f.phase = 'keep';
      f.until = now + 5000;
      setFace('smug', 3000);
      say('Mine~ 🎾 …you can have it back later~', 2600);
    } else dropBall(now);
  } else if (f.phase === 'keep' && now > f.until) dropBall(now);
  else if (f.phase === 'dropped' && now > f.until) { state.fetch = null; ballEl.classList.remove('on'); return; }
  // draw it: on the floor (or in the air), or held in her mouth, cat style
  let bx, by;
  const held = f.phase === 'carry' || f.phase === 'keep';
  charEl.classList.toggle('carrying', held); // arms around the ball
  // held: the ball drawn in her hands takes over (see .held-ball); the loose one hides
  if (held) { ballEl.classList.remove('on'); return; } else { bx = f.x - state.x; by = f.y - state.y - 7; }
  ballEl.classList.add('on');
  ballEl.style.left = bx + 'px';
  ballEl.style.top = by + 'px';
  ballEl.style.transform = `translate(-50%, -50%) rotate(${Math.round(f.x * 6)}deg)`;
}
function dropBall(now) {
  const f = state.fetch;
  f.phase = 'dropped';
  f.x = state.x + state.w / 2 + state.dir * 28;
  f.y = f.floor;
  f.until = now + 7000;
  achieve('fetch');
  doAction('cheer', 1600);
  setFace('star', 1800);
  changeMood(3);
  say(pick(['Again! Again! 🎾', 'Here~! Throw it again? 🎾', '*drops the ball at your feet* 🎾']), 2400);
}

// ---------- high five: now and then she holds up a hand ----------
function offerHighFive() {
  state.highFive = Date.now() + 3500;
  doAction('hifive', 3500);
  setFace('star', 3500);
  say(pick(['High five! ✋', 'Up top! ✋', 'Gimme five~ ✋']), 3500);
}
function highFive() {
  state.highFive = 0;
  state.action = null;
  wake();
  interacted();
  achieve('highfive');
  flash('sparkle', 900);
  sfx('chime');
  setFace('star', 1800);
  changeMood(3);
  popHearts(2);
  say(pick(['Yay!! ✋✨', 'Nice one! ✋', 'Hehe~ teamwork! ✨']), 1800);
}
function updateHighFive(now) {
  if (!state.highFive || now < state.highFive) return;
  state.highFive = 0;
  setFace('teary', 2000);
  say(pick(['…oh. Okay. 😔', '*slowly lowers hand*', 'Left hanging… 🥲']), 2200);
}

// ---------- rock, paper, scissors (she sometimes "changes" her throw when she loses… then owns up) ----------
const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
function rps(you) {
  if (!RPS[you] || state.leaving) return;
  wake();
  interacted();
  setFace('smug', 1300);
  say('Rock, paper, scissors… 🎵', 1300);
  const me = pick(Object.keys(RPS));
  setTimeout(() => say(`${RPS[me]} ${me[0].toUpperCase() + me.slice(1)}!`, 1400), 1300);
  setTimeout(() => {
    if (me === you) { setFace('cat', 1600); say('A draw! Again? 🤝', 2000); return; }
    if (BEATS[me] === you) { setFace('smug', 2000); changeMood(1); say(pick(['I win~! Hehe ✌️', 'Victory~! 😼', 'Too easy~']), 2200); return; }
    if (Math.random() < 0.3) {
      const fix = Object.keys(BEATS).find((k) => BEATS[k] === you);
      achieve('rps-cheat');
      setFace('smug', 2000);
      say(`…wait, no, I threw ${RPS[fix]} ${fix}! 😏`, 2200);
      setTimeout(() => { setFace('blush', 1800); achieve('rps-win'); say('…okay okay, you won fair and square 😤', 2200); }, 2400);
      return;
    }
    achieve('rps-win');
    setFace('pout', 2000);
    say(pick(['Nooo~ you win! 😤', 'Hmph! Best of three?!', 'How?! 😾']), 2200);
  }, 2700);
}

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
// her torso and skirt, in SVG coordinates
function onBody(e) {
  const p = svgPoint(e);
  return p.y > 138 && p.y < 214 && p.x > 62 && p.x < 138;
}
function wiggle(e) {
  if (rubEars(e)) return;
  if (!onBody(e)) { lastWiggleX = null; return; } // tickles only work on her body
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
  achieve('tickle');
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
  sfx('pop');
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
  achieve('pat');
  if (sulking()) {
    if (state.action === 'yeet') return;
    patStart = performance.now();
    charEl.classList.add('patting');
    if (++state.sulkPats < 3) { say(pick(['Hmph…', '…', '*pouts*']), 1400); return; }
    // made up: turns back around
    state.sulkUntil = 0;
    achieve('madeup');
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
  changeMood(1.5);
  interacted();
  if (pats.length >= 6) { say(pick(['Purrr~ ♡', 'Nyaa~ ♡♡', '*melts*']), 1800); sfx('purr'); }
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
  changeMood(-20);
  state.laptopGone = true;
  state.yeetAt = Date.now();
  achieve('yeet');
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
  if (pokes.length >= (mood < 30 ? 5 : 8)) return yeet(); // grumpy: shorter fuse
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
