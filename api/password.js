// 첫 접속 비밀번호 설정
import bcrypt from 'bcryptjs';
import { db, ensure, audit, member } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { sign } from '../lib/sec.js';

export default handler(['POST'], async (req, res) => {
  const t = auth(req, ['setup']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (!(await member(t.sub))) return fail(res, 401, '명단에 없거나 잠긴 계정임. 다시 로그인해 주세요.');
  const pw = String(body(req).password || '');
  if (pw.length < 6 || pw.length > 64) return fail(res, 400, '비밀번호는 6자 이상으로 해 주세요.');
  const st = await getSettings();
  const r = await db()`SELECT consent_version, pw_hash FROM roster WHERE id = ${t.sub}`;
  if (!r[0]) return fail(res, 401, '다시 로그인해 주세요.');
  if (r[0].consent_version !== st.consentVersion) return fail(res, 400, '개인정보 동의가 먼저 필요함.');
  if (r[0].pw_hash) return fail(res, 409, '이미 비밀번호가 있음. 다시 로그인해 주세요.');
  const hash = await bcrypt.hash(pw, 10);
  await db()`UPDATE roster SET pw_hash = ${hash}, fail_count = 0, last_login = NOW() WHERE id = ${t.sub}`;
  await audit('password_set', t.sub);
  send(res, 200, { token: sign({ sub: t.sub, scope: 'emp' }, 120) });
});
