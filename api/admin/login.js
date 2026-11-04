// 관리자 로그인 (계정 1개 · 환경변수 ADMIN_ID / ADMIN_PASSWORD)
import { ensure, tooMany, noteFail, audit } from '../../lib/db.js';
import { handler, body, fail, send, clientIp } from '../../lib/http.js';
import { env, ipKey, sameText, sign } from '../../lib/sec.js';

export default handler(['POST'], async (req, res) => {
  await ensure();
  const ip = ipKey('admin|' + clientIp(req));
  if (await tooMany(ip, 10, 15)) return fail(res, 429, '시도가 너무 많음. 15분 뒤 다시 시도해 주세요.');
  const b = body(req);
  const ok = sameText(b.id, env('ADMIN_ID')) && sameText(b.password, env('ADMIN_PASSWORD'));
  if (!ok) { await noteFail(ip); return fail(res, 401, '아이디 또는 비밀번호가 맞지 않음.'); }
  await audit('admin_login');
  send(res, 200, { token: sign({ sub: 'admin', scope: 'admin' }, 240) });
});
