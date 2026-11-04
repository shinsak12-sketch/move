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
  const pub = env('PUBLIC_KEY').replace(/\\n/g, '\n');
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
