// 개인정보 동의 기록 (동의 시각 + 문구 버전)
import { db, ensure, audit, member } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';

export default handler(['POST'], async (req, res) => {
  const t = auth(req, ['setup', 'emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (!(await member(t.sub))) return fail(res, 401, '명단에 없거나 잠긴 계정임. 다시 로그인해 주세요.');
  const b = body(req), st = await getSettings();
  if (!(b.agree && b.agree.collect && b.agree.overseas && b.agree.entrust)) return fail(res, 400, '필수 항목에 모두 동의해야 함.');
  if (Number(b.version) !== st.consentVersion) return fail(res, 409, '동의서가 바뀌었음. 새로고침해 주세요.');
  await db()`UPDATE roster SET consent_version = ${st.consentVersion}, consent_at = NOW() WHERE id = ${t.sub}`;
  await audit('consent', t.sub);
  const r = await db()`SELECT pw_hash IS NOT NULL AS has_pw FROM roster WHERE id = ${t.sub}`;
  send(res, 200, { ok: true, next: r[0] && r[0].has_pw ? 'survey' : 'password' });
});
