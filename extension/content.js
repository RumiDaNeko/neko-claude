// clawde chan for claude.ai: watches this chat tab and tells her when Claude is answering.
// Each tab is one "session" for her; nothing from the chat itself (your messages, Claude's replies) is sent.

// how claude.ai shows a reply in progress; if claude.ai changes its page, fix these
const STREAMING = [
  '[data-is-streaming="true"]',
  'button[aria-label="Stop response"]',
  'button[aria-label*="Stop" i][aria-label*="respon" i]',
];
// what claude.ai says when you're out of messages (the time is passed on for her countdown)
const LIMIT = /(out of free messages|usage limit|message limit|limit reached)[^\n]{0,80}?(?:until|resets?(?: at)?)\s+([^\n.]{1,40})/i;

const POLL_MS = 700;
const WRITING_AFTER_MS = 2500; // thinking first, then writing the reply
const HEARTBEAT_MS = 60 * 1000; // a long reply: remind her it's still going
const DONE_AFTER_MS = 1500; // the indicator can blink between steps (web search, tools); done means gone a moment

const session = 'chat:' + Math.random().toString(36).slice(2, 10);
let started = false; // she's said hi for this tab
let busy = false;
let busySince = 0;
let lastBeat = 0;
let wrote = false;
let quietSince = 0;
let lastLimit = '';

const send = (ev) => {
  try { chrome.runtime.sendMessage({ clawde: { ...ev, session, chat: true } }); } catch { /* extension reloaded */ }
};
const streaming = () => STREAMING.some((s) => document.querySelector(s));

function checkLimit() {
  const m = LIMIT.exec(document.body ? document.body.innerText.slice(-20000) : '');
  if (!m) { lastLimit = ''; return; }
  const text = `${m[1]}, resets ${m[2]}`;
  if (text === lastLimit) return;
  lastLimit = text;
  if (!started) { started = true; send({ event: 'SessionStart' }); }
  send({ event: 'Stop', limit: text });
}

function tick() {
  const now = Date.now();
  if (streaming()) {
    quietSince = 0;
    if (!busy) {
      busy = true;
      busySince = now;
      lastBeat = now;
      wrote = false;
      if (!started) { started = true; send({ event: 'SessionStart' }); }
      send({ event: 'UserPromptSubmit' });
    } else if (!wrote && now - busySince > WRITING_AFTER_MS) {
      wrote = true;
      lastBeat = now;
      send({ event: 'PreToolUse', tool: 'Chat' });
    } else if (now - lastBeat > HEARTBEAT_MS) {
      lastBeat = now;
      send({ event: 'PreToolUse', tool: 'Chat' });
    }
    return;
  }
  if (!busy) return;
  if (!quietSince) quietSince = now;
  if (now - quietSince < DONE_AFTER_MS) return;
  busy = false;
  send({ event: 'Stop' });
  setTimeout(checkLimit, 800);
}

setInterval(tick, POLL_MS);
setInterval(() => { if (!busy) checkLimit(); }, 15000);
// tab closed or navigated away: quietly forget this session (she doesn't walk off over a closed tab)
addEventListener('pagehide', () => { if (started) send({ event: 'SessionEnd', quiet: true }); });
