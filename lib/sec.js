// 보안 유틸 — 해시(HMAC) · 공개키 암호화 · 토큰
// 서버는 공개키만 가짐. 암호문을 푸는 개인키는 관리자 브라우저에만 있음.
import crypto from 'node:crypto';

export function env(k) {
  const v = process.env[k];
  if (!v) throw new Error(k + ' 환경변수가 없음');
  return v;
}

export const norm = s => String(s == null ? '' : s).replace(/\s+/g, '').trim();

function hmac(tag, value) {
  return crypto.createHmac('sha256', env('HMAC_SECRET')).update(tag + '|' + value).digest('hex');
}

// 로그인 조회 키: 성명(공백 제거) + 생년월일 6자리
export const idKey = (name, birth) => hmac('id', norm(name) + '|' + String(birth).trim());
// 주소 변경 감지용
export const addrKey = road => hmac('addr', norm(road));
// 접속 제한용 (IP 원문은 저장하지 않음)
export const ipKey = ip => hmac('ip', String(ip || ''));

// 공개키 하이브리드 암호화: AES-256-GCM 으로 내용을 잠그고, AES 키는 RSA-OAEP(SHA-256)으로 잠금
// 브라우저(WebCrypto)에서 개인키로 풀 수 있는 형식: ct = 암호문 || 인증태그
export function seal(obj) {
  // Vercel 은 PUBLIC_ 로 시작하는 이름을 Sensitive 로 못 둠 → ENC_PUBLIC_KEY 도 받음
  const pub = publicKeyPem();
  const aes = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aes, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  const k = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes);
  return JSON.stringify({ v: 1, k: k.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
}

// 서명 토큰 (JWT 와 비슷한 단순 형식)
const b64u = b => Buffer.from(b).toString('base64url');
function tokenKey() { return process.env.TOKEN_SECRET || hmac('token', 'key'); }
export function sign(payload, minutes) {
  const body = b64u(JSON.stringify(Object.assign({}, payload, { exp: Date.now() + minutes * 60000 })));
  const sig = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
  return body + '.' + sig;
}
export function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}

export function sameText(a, b) {
  const x = crypto.createHash('sha256').update(String(a || '')).digest();
  const y = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------- Google OTP (TOTP, RFC 6238: SHA-1 · 30초 · 6자리) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  s = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0');
}
// 맞으면 사용한 시간칸 번호, 틀리면 -1 (앞뒤 30초 허용)
export function totpCheck(secret, code) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  const key = b32decode(secret), now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) if (sameText(hotp(key, now + d), code)) return now + d;
  return -1;
}

// ---------- 거리값 암호화 (서버 대칭키 · AES-256-GCM) ----------
// 직원이 다시 들어왔을 때 서버가 결과를 다시 보여줘야 해서 서버가 풀 수 있는 키를 씀.
// DB만 털려서는 못 풂 (키는 Vercel 환경변수에서 만들어짐)
function distKey() { return crypto.createHash('sha256').update(process.env.DIST_SECRET || hmac('dist', 'key')).digest(); }
export function lockBox(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', distKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return iv.toString('base64') + '.' + ct.toString('base64');
}
export function openBox(s) {
  if (!s) return null;
  const [iv, raw] = String(s).split('.').map(x => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', distKey(), iv);
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
}

// 직원 브라우저가 암호화한 응답(seal 과 같은 형식)인지 모양만 확인 — 내용은 서버도 못 봄
export function isSealed(s) {
  if (typeof s !== 'string' || s.length > 8000) return false;
  try { const o = JSON.parse(s); return o.v === 1 && [o.k, o.iv, o.ct].every(x => typeof x === 'string' && /^[A-Za-z0-9+/=]+$/.test(x)) && Buffer.from(o.iv, 'base64').length === 12 && Buffer.from(o.k, 'base64').length >= 256; }
  catch (e) { return false; }
}
export function publicKeyPem() { return (process.env.ENC_PUBLIC_KEY || env('PUBLIC_KEY')).replace(/\\n/g, '\n'); }
