// Achievement sync: sign in with Discord through the sync server (server/worker.js), then this device's
// progress goes up and every device's comes back. Unlocks keep the earliest time; counts add up per device.
const crypto = require('crypto');
const { shell } = require('electron');

const SYNC_EVERY_MS = 10 * 60 * 1000;
const LOGIN_WAIT_MS = 10 * 60 * 1000;

// deps: api (server URL), port (local bridge), getAch(), saveAch(), creds {token, name, device}, saveCreds(),
//       onChange() (menu), tell(cmd) (to her), unlockReady() -> newly unlocked achievements
function createSync(deps) {
  let login = null; // { nonce, at } while the browser is on Discord's page
  let timer = null;
  let busy = false;

  const signedIn = () => !!(deps.api && deps.creds.token);

  async function call(method, route, body) {
    const res = await fetch(deps.api.replace(/\/+$/, '') + route, {
      method,
      headers: { authorization: 'Bearer ' + deps.creds.token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) {
      deps.creds.token = '';
      deps.saveCreds();
      deps.onChange();
      deps.tell('say:Discord signed me out… sign in again to keep syncing 🥺');
      throw new Error('signed out');
    }
    if (!res.ok) throw new Error('sync server ' + res.status);
    return res.json();
  }

  async function syncNow(quiet = true) {
    if (!signedIn() || busy) return;
    busy = true;
    try {
      const ach = deps.getAch();
      const r = await call('PUT', '/achievements', { device: deps.creds.device, got: ach.got, counts: ach.counts, kinds: ach.kinds });
      let gained = 0;
      for (const [id, at] of Object.entries(r.got || {})) {
        if (!ach.got[id]) gained++;
        if (!ach.got[id] || at < ach.got[id]) ach.got[id] = at;
      }
      ach.others = r.others || { counts: {}, kinds: {} };
      const fresh = deps.unlockReady();
      deps.saveAch();
      if (gained || fresh.length) deps.onChange();
      if (fresh.length) deps.tell('toast:' + JSON.stringify(fresh));
      if (gained) deps.tell(`say:${gained} achievement${gained > 1 ? 's' : ''} synced from your other device${r.devices > 2 ? 's' : ''}~ 🏆`);
      else if (!quiet) deps.tell('say:All synced~ ✨');
    } catch (e) {
      if (!quiet && e.message !== 'signed out') deps.tell('say:Couldn\'t reach the sync server… 😿');
      console.error('[claude-chan] sync:', e.message);
    } finally {
      busy = false;
    }
  }

  // a little after an unlock (or any progress), so a burst of pats is one upload
  function soon(ms = 30000) {
    if (!signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), ms);
  }

  function signIn() {
    if (!deps.api) return;
    login = { nonce: crypto.randomBytes(16).toString('hex'), at: Date.now() };
    shell.openExternal(`${deps.api.replace(/\/+$/, '')}/login?port=${deps.port}&nonce=${login.nonce}`);
  }

  async function signOut() {
    if (deps.creds.token) await call('POST', '/logout').catch(() => {});
    deps.creds.token = '';
    deps.creds.name = '';
    deps.saveCreds();
    deps.onChange();
    deps.tell('say:Signed out. Achievements stay on this device~');
  }

  // the browser comes back here (GET /auth on the bridge) with the token, if the nonce is ours
  function onAuth(params) {
    const ok = login && params.get('nonce') === login.nonce && Date.now() - login.at < LOGIN_WAIT_MS;
    if (!ok) return 'That sign-in link is old or not from this clawde chan. Try again from her menu.';
    login = null;
    const token = params.get('token') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) return 'Sign-in was cancelled. You can close this tab.';
    deps.creds.token = token;
    deps.creds.name = (params.get('name') || 'you').slice(0, 64);
    deps.saveCreds();
    deps.onChange();
    deps.tell(`say:Hi ${deps.creds.name}! Achievements sync now~ ✨`);
    syncNow();
    return null;
  }

  function start() {
    setTimeout(() => syncNow(), 5000);
    setInterval(() => syncNow(), SYNC_EVERY_MS);
  }

  function menu() {
    if (!deps.api) return { label: 'Sync achievements', visible: false };
    if (!signedIn()) return { label: 'Sync achievements: sign in with Discord…', click: signIn };
    return { label: `Sync achievements (${deps.creds.name})`, submenu: [
      { label: 'Sync now', click: () => syncNow(false) },
      { label: 'Sign out', click: signOut },
    ] };
  }

  return { start, soon, syncNow, onAuth, menu };
}

module.exports = { createSync };
