#!/usr/bin/env node
// Claude Code hook -> claude-chan bridge. Reads the hook JSON on stdin and forwards
// a trimmed event to the companion. Never blocks or fails Claude Code.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.CLAUDE_CHAN_PORT || 47321);
const HERE = dirname(fileURLToPath(import.meta.url));

// Claude just opened and she isn't running: launch her (CLAUDE_CHAN_AUTOSTART=0 to opt out)
function launch() {
  if (process.env.CLAUDE_CHAN_AUTOSTART === '0') return;
  try {
    const electron = createRequire(import.meta.url)('electron'); // path to the electron binary
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(electron, ['.'], { cwd: HERE, env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* electron not installed: nothing to do */ }
}

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
    // the shell command, so she can react to tests, commits, pushes and scary rm -rf's
    command: typeof input.tool_input?.command === 'string' ? input.tool_input.command.slice(0, 300) : undefined,
    error: typeof input.error === 'string' ? input.error.slice(0, 200) : undefined,
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
  } catch {
    // companion not running: that's fine, unless Claude is just starting up
    if (event.event === 'SessionStart') {
      launch();
      // exiting at once can take the brand-new process down with us; give it a moment
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  process.exit(0);
});
