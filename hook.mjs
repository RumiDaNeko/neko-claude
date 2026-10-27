#!/usr/bin/env node
// Claude Code hook -> claude-chan bridge. Reads the hook JSON on stdin and forwards
// a trimmed event to the companion. Never blocks or fails Claude Code.
const PORT = Number(process.env.CLAUDE_CHAN_PORT || 47321);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* ignore */ }
  const event = {
    event: input.hook_event_name || process.argv[2] || 'unknown',
    session: input.session_id || 'default',
    tool: input.tool_name,
    message: input.message,
    cwd: input.cwd,
    at: Date.now(),
  };
  try {
    await fetch(`http://127.0.0.1:${PORT}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(400),
    });
  } catch { /* companion not running: that's fine */ }
  process.exit(0);
});
