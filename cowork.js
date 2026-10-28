// Claude Cowork (agent mode in the Claude desktop app) runs Claude Code inside a VM, where our hooks
// can't reach her. Instead we tail the session transcripts the desktop app keeps on this machine and
// turn new entries into the same events hook.mjs would send.
// Most Cowork tasks run Claude in the cloud, though, and only their commands run here (in the VM, with
// your folder mounted): for those we read the VM daemon's log, which notes each command and its exit code.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCAN_MS = 1500;
const QUIET_END_MS = 20 * 60 * 1000; // no activity this long: the session is over (quietly: she doesn't leave for it)
const MAX_DEPTH = 9;
const SKIP_DIRS = new Set(['skills-plugin', 'node_modules', '.git', 'vm_bundles']);
const LIMIT_RE = /You['’]ve hit your [^\n"]*?limit[^\n"]*/;
const REMOTE_DONE_MS = 30 * 1000; // a cloud task we only see through its commands: this long without one and the turn's over

function logFiles() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    ...(process.env.CLAUDE_CHAN_COWORKD_LOG ? [process.env.CLAUDE_CHAN_COWORKD_LOG] : []), // for testing
    path.join(local, 'Claude', 'logs', 'coworkd.log'),
    path.join(home, 'Library', 'Logs', 'Claude', 'coworkd.log'),
  ].filter((p) => fs.existsSync(p));
}

function roots() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const out = [
    ...(process.env.CLAUDE_CHAN_COWORK_DIR ? [process.env.CLAUDE_CHAN_COWORK_DIR] : []), // for testing
    path.join(roaming, 'Claude', 'local-agent-mode-sessions'),
    path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions'),
  ];
  // the Microsoft Store build keeps its data under Claude-Data\claude_<publisher> (or the package's LocalCache)
  for (const [dir, sub] of [[path.join(local, 'Claude-Data'), []], [path.join(local, 'Packages'), ['LocalCache', 'Roaming', 'Claude']]]) {
    try {
      for (const d of fs.readdirSync(dir)) if (/^claude/i.test(d)) out.push(path.join(dir, d, ...sub, 'local-agent-mode-sessions'));
    } catch { /* not installed that way */ }
  }
  return out.filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

function walk(dir, depth, found) {
  if (depth > MAX_DEPTH || found.length > 5000) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1, found); }
    else if (e.name.endsWith('.jsonl')) found.push(path.join(dir, e.name));
  }
}

// one Cowork session can write several transcripts (subagents): group them by the local_<id> folder
const sessionOf = (file, entry) => 'cowork:' + ((/local_[0-9a-f-]{8,}/i.exec(file) || [])[0] || entry.sessionId || path.basename(file, '.jsonl'));

// a transcript entry -> zero or more hook-style events
function toEvents(entry) {
  const msg = entry.message;
  if (!msg || (entry.type !== 'user' && entry.type !== 'assistant')) return [];
  const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
  const out = [];
  if (entry.type === 'user') {
    for (const b of blocks) if (b.type === 'tool_result') out.push({ event: b.is_error ? 'PostToolUseFailure' : 'PostToolUse' });
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    // a prompt from you (not tool output, not the app's own injected context)
    if (!out.length && text && !entry.isMeta && !entry.isSidechain && !text.startsWith('<')) out.push({ event: 'UserPromptSubmit' });
    return out;
  }
  for (const b of blocks) {
    if (b.type !== 'tool_use') continue;
    out.push({ event: 'PreToolUse', tool: b.name, command: typeof b.input?.command === 'string' ? b.input.command.slice(0, 300) : undefined });
  }
  if (msg.stop_reason === 'end_turn' && !entry.isSidechain) {
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = LIMIT_RE.exec(text);
    out.push({ event: 'Stop', limit: m ? m[0] : undefined });
  }
  return out;
}

function startCowork(emit) {
  const sizes = new Map(); // transcript -> bytes already read
  const partial = new Map(); // transcript -> an unfinished last line
  const live = new Map(); // session -> last activity
  let first = true;

  function read(file, from, to) {
    const buf = Buffer.alloc(to - from);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
    const lines = ((partial.get(file) || '') + buf.toString('utf8')).split('\n');
    partial.set(file, lines.pop());
    for (const line of lines) {
      if (!line.includes('"message"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const evs = toEvents(entry);
      if (!evs.length) continue;
      const session = sessionOf(file, entry);
      if (!live.has(session)) emit({ event: 'SessionStart', session, cowork: true, at: Date.now() });
      live.set(session, Date.now());
      for (const ev of evs) emit({ ...ev, session, cowork: true, at: Date.now() });
    }
  }

  function scan() {
    const files = [];
    for (const r of roots()) walk(r, 0, files);
    for (const file of files) {
      let size;
      try { size = fs.statSync(file).size; } catch { continue; }
      const had = sizes.get(file);
      sizes.set(file, size);
      // transcripts already there when she started are history: only what's written from now on counts
      if (had === undefined && first) continue;
      const from = had ?? 0;
      if (size > from) { try { read(file, from, size); } catch { /* being written: next time */ } }
      else if (size < from) partial.delete(file); // rewritten from scratch
    }
    first = false;
    const now = Date.now();
    for (const [session, at] of live) {
      if (now - at < QUIET_END_MS) continue;
      live.delete(session);
      emit({ event: 'SessionEnd', session, cowork: true, quiet: true, at: now });
    }
  }

  // ---- cloud tasks: their commands, from the VM daemon's log ----
  const logs = new Map(); // log file -> bytes already read
  const procs = new Map(); // VM process -> session
  const remote = new Map(); // session -> { running, at } (for telling when the turn is over)
  function logLine(line) {
    let m = /\[process:(\S+)\] spawn: name=(\S+)/.exec(line);
    if (m) {
      const session = 'cowork:' + m[2];
      procs.set(m[1], session);
      if (!live.has(session)) emit({ event: 'SessionStart', session, cowork: true, at: Date.now() });
      if (!remote.get(session)?.turn) emit({ event: 'UserPromptSubmit', session, cowork: true, at: Date.now() });
      live.set(session, Date.now());
      remote.set(session, { turn: true, running: (remote.get(session)?.running || 0) + 1, at: Date.now() });
      emit({ event: 'PreToolUse', session, tool: 'Bash', cowork: true, at: Date.now() });
      return;
    }
    m = /\[process:(\S+)\] direct child exited: code=(-?\d+)/.exec(line);
    if (m && procs.has(m[1])) {
      const session = procs.get(m[1]);
      procs.delete(m[1]);
      const r = remote.get(session);
      if (r) { r.running = Math.max(0, r.running - 1); r.at = Date.now(); }
      live.set(session, Date.now());
      emit({ event: m[2] === '0' ? 'PostToolUse' : 'PostToolUseFailure', session, cowork: true, at: Date.now() });
    }
  }
  function tailLogs() {
    for (const file of logFiles()) {
      let size;
      try { size = fs.statSync(file).size; } catch { continue; }
      let from = logs.get(file);
      logs.set(file, size);
      if (from === undefined) continue; // what was logged before she started is history
      if (size < from) from = 0; // the log was rotated
      if (size === from) continue;
      try {
        const buf = Buffer.alloc(size - from);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
        for (const line of buf.toString('utf8').split('\n')) logLine(line);
      } catch { /* next time */ }
    }
    // no Stop comes through the log: a quiet spell with nothing running means Claude's done
    const now = Date.now();
    for (const [session, r] of remote) {
      if (r.turn && !r.running && now - r.at > REMOTE_DONE_MS) { r.turn = false; emit({ event: 'Stop', session, cowork: true, at: now }); }
    }
  }

  scan();
  tailLogs();
  return setInterval(() => { scan(); tailLogs(); }, SCAN_MS);
}

module.exports = { startCowork, toEvents };
