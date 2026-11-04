import { verify } from './sec.js';

export function send(res, code, obj) {
  res.status(code);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

export const fail = (res, code, msg, extra) => send(res, code, Object.assign({ error: msg }, extra || {}));

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
}

// scopes: 'setup'(본인 확인 후 비번 설정 전) · 'emp'(직원) · 'admin'
export function auth(req, scopes) {
  const h = String(req.headers.authorization || '');
  const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p || scopes.indexOf(p.scope) < 0) return null;
  return p;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

// 요청 본문(주소 · 이름)은 절대 로그에 남기지 않음 — 오류 메시지만 남김
export function handler(methods, fn) {
  return async (req, res) => {
    if (methods.indexOf(req.method) < 0) return fail(res, 405, '허용되지 않은 요청');
    try { await fn(req, res); }
    catch (e) { console.error('[address-survey]', req.url, e && e.message); fail(res, 500, '서버 오류가 났음. 잠시 뒤 다시 시도해 주세요.'); }
  };
}
