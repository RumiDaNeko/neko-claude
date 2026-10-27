// Sanity checks for the companion: `npm run check`.
//  - every JS file parses
//  - no state class on #char shares a name with an SVG part's class (a CSS rule for one then styles the other:
//    that's how the laptop lid went see-through, the walk flipped off-screen and a pose outlined the whole window)
//  - every getElementById in app.js points at an element that exists
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failed = 0;
const fail = (msg) => { failed++; console.error('✗ ' + msg); };
const ok = (msg) => console.log('✓ ' + msg);

for (const f of ['main.js', 'preload.js', 'renderer/app.js', 'hook.mjs', 'install-hooks.mjs', 'scripts/check.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); } catch (e) { fail(`${f} does not parse:\n${e.stderr}`); }
}
ok('scripts parse');

const html = read('renderer/index.html');
const app = read('renderer/app.js');

// classes on SVG / HTML parts (everything except the #char div itself)
const partClasses = new Set();
for (const m of html.matchAll(/<(?!div id="char")[a-z]+[^>]*\sclass="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) partClasses.add(c);

// classes app.js puts on #char
const stateClasses = new Set();
const poses = app.match(/const POSES = \[([^\]]+)\]/);
if (poses) for (const m of poses[1].matchAll(/'([\w-]+)'/g)) stateClasses.add(m[1]);
for (const m of app.matchAll(/charEl\.classList\.toggle\('([\w-]+)'/g)) stateClasses.add(m[1]); // (its 2nd argument is a condition)
for (const m of app.matchAll(/charEl\.classList\.(?:add|remove)\(([^)]*)\)/g)) for (const q of m[1].matchAll(/'([\w-]+)'/g)) stateClasses.add(q[1]);
for (const m of app.matchAll(/flash\('([\w-]+)'/g)) stateClasses.add(m[1]);
for (const m of app.matchAll(/doAction\('([\w-]+)'/g)) stateClasses.add(m[1]);

// these pairs are deliberate: #char.item-milk shows the .item-milk cup, and so on
const PAIRED = [/^item-/, /^prop-/, /^tk-/];
const clashes = [...stateClasses].filter((c) => partClasses.has(c) && !PAIRED.some((re) => re.test(c)));
if (clashes.length) fail(`state classes that are also SVG part classes: ${clashes.join(', ')}`);
else ok(`no class clashes (${stateClasses.size} state classes, ${partClasses.size} part classes)`);

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const missing = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]).filter((id) => !ids.has(id));
if (missing.length) fail(`app.js looks up ids that aren't in index.html: ${[...new Set(missing)].join(', ')}`);
else ok('every getElementById target exists');

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall good');
