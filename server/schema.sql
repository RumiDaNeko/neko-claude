-- clawde chan sync (Cloudflare D1). Apply with:
--   npx wrangler d1 execute clawde-sync --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,       -- Discord user id
  name TEXT NOT NULL,
  avatar TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,     -- sha256 of the token the app holds (the token itself is never stored)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL         -- { got: {id: firstUnlockMs}, devices: {deviceId: {counts, kinds, at}} }
);
