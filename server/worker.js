// clawde chan sync: a Cloudflare Worker that keeps achievements in step across your devices.
// Sign-in is Discord OAuth (scope "identify" only: your Discord id, name and avatar, nothing else).
//
//   GET  /login?port=47321&nonce=…  -> Discord's consent page
//   GET  /callback                  -> back from Discord; hands a token to the app on 127.0.0.1:<port>/auth
//   GET  /me                        -> who the token belongs to
//   PUT  /achievements              -> this device's progress in, everyone's merged progress out
//   POST /logout                    -> forget this token
//
// Env: DISCORD_CLIENT_ID (var), DISCORD_CLIENT_SECRET (secret), DB (D1, see schema.sql).

const DISCORD = 'https://discord.com';
const TOKEN_DAYS = 180;
const MAX_BODY = 64 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const fail = (status, error) => json({ error }, status);
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// the app's local bridge: only ever a loopback port
function appPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null;
}

async function login(url, env) {
  const port = appPort(url.searchParams.get('port'));
  const nonce = url.searchParams.get('nonce') || '';
  if (!port || !/^[a-f0-9]{16,64}$/.test(nonce)) return fail(400, 'bad port or nonce');
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: url.origin + '/callback',
    response_type: 'code',
    scope: 'identify',
    prompt: 'none',
    state: b64url(JSON.stringify({ port, nonce })),
  });
  return Response.redirect(`${env.DISCORD_API || DISCORD}/oauth2/authorize?${q}`, 302);
}

async function callback(url, env) {
  let st;
  try { st = JSON.parse(unb64url(url.searchParams.get('state') || '')); } catch { return fail(400, 'bad state'); }
  const port = appPort(st && st.port);
  if (!port || typeof st.nonce !== 'string') return fail(400, 'bad state');
  const back = (params) => Response.redirect(`http://127.0.0.1:${port}/auth?${new URLSearchParams({ nonce: st.nonce, ...params })}`, 302);
  const code = url.searchParams.get('code');
  if (!code) return back({ error: url.searchParams.get('error') || 'cancelled' });

  const api = env.DISCORD_API || DISCORD;
  const tr = await fetch(`${api}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: url.origin + '/callback',
    }),
  });
  if (!tr.ok) return back({ error: 'discord said no' });
  const { access_token } = await tr.json();
  const ur = await fetch(`${api}/api/users/@me`, { headers: { authorization: `Bearer ${access_token}` } });
  if (!ur.ok) return back({ error: 'discord said no' });
  const u = await ur.json();
  const name = u.global_name || u.username || 'you';

  await env.DB.prepare('INSERT INTO users (id, name, avatar) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET name = ?2, avatar = ?3')
    .bind(u.id, name, u.avatar || null).run();
  const token = randomToken();
  await env.DB.prepare('INSERT INTO tokens (hash, user_id, expires) VALUES (?1, ?2, ?3)')
    .bind(await sha256(token), u.id, Date.now() + TOKEN_DAYS * 864e5).run();
  return back({ token, name });
}

async function userOf(req, env) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  return env.DB.prepare('SELECT u.id, u.name, t.hash FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?1 AND t.expires > ?2')
    .bind(await sha256(m[1]), Date.now()).first();
}

// unlock times: keep the earliest; counts and kinds: per device, so nothing is counted twice
const cleanGot = (g) => Object.fromEntries(Object.entries(g || {}).filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && Number.isFinite(v)).slice(0, 500));
const cleanCounts = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && Number.isInteger(v) && v >= 0).slice(0, 500));
const cleanKinds = (k) => Object.fromEntries(Object.entries(k || {}).filter(([e, v]) => /^[\w-]{1,40}$/.test(e) && Array.isArray(v))
  .map(([e, v]) => [e, v.filter((x) => typeof x === 'string' && x.length <= 40).slice(0, 100)]).slice(0, 200));

async function putAchievements(req, env, user) {
  const text = await req.text();
  if (text.length > MAX_BODY) return fail(413, 'too big');
  let body;
  try { body = JSON.parse(text); } catch { return fail(400, 'bad json'); }
  const device = String(body.device || '');
  if (!/^[a-f0-9-]{8,64}$/.test(device)) return fail(400, 'bad device');

  const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?1').bind(user.id).first();
  const data = row ? JSON.parse(row.data) : { got: {}, devices: {} };
  for (const [id, at] of Object.entries(cleanGot(body.got))) if (!data.got[id] || at < data.got[id]) data.got[id] = at;
  data.devices[device] = { counts: cleanCounts(body.counts), kinds: cleanKinds(body.kinds), at: Date.now() };
  await env.DB.prepare('INSERT INTO progress (user_id, data) VALUES (?1, ?2) ON CONFLICT(user_id) DO UPDATE SET data = ?2')
    .bind(user.id, JSON.stringify(data)).run();

  // what the other devices add on top of this one
  const others = { counts: {}, kinds: {} };
  for (const [id, d] of Object.entries(data.devices)) {
    if (id === device) continue;
    for (const [e, n] of Object.entries(d.counts || {})) others.counts[e] = (others.counts[e] || 0) + n;
    for (const [e, ks] of Object.entries(d.kinds || {})) others.kinds[e] = [...new Set([...(others.kinds[e] || []), ...ks])];
  }
  return json({ got: data.got, others, devices: Object.keys(data.devices).length });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/login') return await login(url, env);
      if (req.method === 'GET' && url.pathname === '/callback') return await callback(url, env);
      if (req.method === 'GET' && url.pathname === '/') return new Response('clawde chan sync 🐾');
      const user = await userOf(req, env);
      if (!user) return fail(401, 'sign in again');
      if (req.method === 'GET' && url.pathname === '/me') return json({ id: user.id, name: user.name });
      if (req.method === 'PUT' && url.pathname === '/achievements') return await putAchievements(req, env, user);
      if (req.method === 'POST' && url.pathname === '/logout') {
        await env.DB.prepare('DELETE FROM tokens WHERE hash = ?1').bind(user.hash).run();
        return json({ ok: true });
      }
      return fail(404, 'not found');
    } catch (e) {
      console.error(e);
      return fail(500, 'server error');
    }
  },
};
