// passes the chat tab's events on to clawde chan's local bridge (the same one Claude Code's hooks use)
const BRIDGE = 'http://127.0.0.1:47321/event';

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.clawde) return;
  fetch(BRIDGE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg.clawde) })
    .catch(() => { /* she isn't running */ });
});
