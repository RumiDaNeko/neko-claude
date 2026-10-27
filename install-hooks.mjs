// Adds claude-chan hooks to Claude Code settings.
//   node install-hooks.mjs            -> ./.claude/settings.local.json (only when Claude Code runs in this folder)
//   node install-hooks.mjs --global   -> ~/.claude/settings.json (every project)
//   add --remove to take them out again
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const global = process.argv.includes('--global');
const remove = process.argv.includes('--remove');
const target = global
  ? path.join(os.homedir(), '.claude', 'settings.json')
  : path.join(here, '.claude', 'settings.local.json');

const hookPath = path.join(here, 'hook.mjs').replace(/\\/g, '/');
const command = `node "${hookPath}"`;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SessionEnd'];

let settings = {};
if (fs.existsSync(target)) settings = JSON.parse(fs.readFileSync(target, 'utf8'));
settings.hooks ??= {};

for (const ev of EVENTS) {
  const groups = (settings.hooks[ev] ?? []).map((g) => ({
    ...g,
    hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes('companion/hook.mjs')),
  })).filter((g) => g.hooks.length);
  if (!remove) {
    const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (ev === 'PreToolUse' || ev === 'PostToolUseFailure') group.matcher = '*';
    // successes only matter for commands (a failing test that passes again)
    if (ev === 'PostToolUse') group.matcher = 'Bash|PowerShell';
    groups.push(group);
  }
  if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
console.log(`${remove ? 'Removed' : 'Installed'} claude-chan hooks ${remove ? 'from' : 'in'} ${target}`);
