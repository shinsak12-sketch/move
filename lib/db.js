import { neon } from '@neondatabase/serverless';
import { env } from './sec.js';

let _sql = null;
export function db() {
  if (!_sql) _sql = neon(env('DATABASE_URL'));
  return _sql;
}

// 처음 호출 때 표를 만듦 (이미 있으면 그대로)
let ready = null;
export function ensure() {
  if (!ready) ready = init().catch(e => { ready = null; throw e; });
  return ready;
}

async function init() {
  const sql = db();
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, val JSONB NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS org_sites (
    id SERIAL PRIMARY KEY, addr_norm TEXT UNIQUE NOT NULL, addr TEXT NOT NULL,
    lng DOUBLE PRECISION, lat DOUBLE PRECISION, geo_ok BOOLEAN DEFAULT FALSE)`;
  await sql`CREATE TABLE IF NOT EXISTS orgs (
    code TEXT PRIMARY KEY, dept TEXT NOT NULL, name TEXT NOT NULL,
    site_id INT REFERENCES org_sites(id) ON DELETE SET NULL, sort INT DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS roster (
    id SERIAL PRIMARY KEY, key_hmac TEXT UNIQUE NOT NULL, enc_identity TEXT NOT NULL, dept TEXT,
    pw_hash TEXT, fail_count INT DEFAULT 0, locked BOOLEAN DEFAULT FALSE,
    consent_version INT, consent_at TIMESTAMPTZ, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS responses (
    roster_id INT PRIMARY KEY REFERENCES roster(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft', addr_hash TEXT, calc_at TIMESTAMPTZ,
    enc_payload TEXT, prev_changed BOOLEAN, move_planned BOOLEAN, move_month TEXT, move_as_base BOOLEAN,
    wish TEXT, reason_code TEXT, wish1 TEXT, wish2 TEXT, wish3 TEXT, submitted_at TIMESTAMPTZ)`;
  await sql`ALTER TABLE responses ADD COLUMN IF NOT EXISTS calc_count INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS addr_raw TEXT`;
  await sql`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT '센터'`;
  await sql`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS region TEXT`;
  await sql`ALTER TABLE responses ADD COLUMN IF NOT EXISTS wishes JSONB`;
  await sql`ALTER TABLE roster ADD COLUMN IF NOT EXISTS hq TEXT`;
  await sql`ALTER TABLE roster ADD COLUMN IF NOT EXISTS center TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS distances (
    roster_id INT REFERENCES roster(id) ON DELETE CASCADE,
    site_id INT REFERENCES org_sites(id) ON DELETE CASCADE,
    km NUMERIC(7,1), min INT, option TEXT, calc_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (roster_id, site_id))`;
  await sql`CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT NOT NULL, ts TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip_hash, ts)`;
  await sql`CREATE TABLE IF NOT EXISTS audit (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT NOW(), action TEXT NOT NULL, roster_id INT)`;
}

// 토큰이 있어도 매 요청마다 명단에 있는지 · 잠기지 않았는지 다시 확인
export async function member(id) {
  const r = await db()`SELECT id FROM roster WHERE id = ${id} AND NOT locked`;
  return !!r[0];
}

export async function audit(action, rosterId) {
  await db()`INSERT INTO audit (action, roster_id) VALUES (${action}, ${rosterId || null})`;
}

// 같은 IP 에서 짧은 시간에 너무 많이 틀리면 막음
export async function tooMany(ipHash, limit, minutes) {
  const r = await db()`SELECT COUNT(*)::int AS n FROM login_attempts WHERE ip_hash = ${ipHash} AND ts > NOW() - ${minutes + ' minutes'}::interval`;
  return r[0].n >= limit;
}
export async function noteFail(ipHash) {
  await db()`INSERT INTO login_attempts (ip_hash) VALUES (${ipHash})`;
  await db()`DELETE FROM login_attempts WHERE ts < NOW() - INTERVAL '1 day'`;
}
