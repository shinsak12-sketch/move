// 직원 본인 확인 · 로그인 (성명 + 생년월일 6자리 [+ 비밀번호])
import bcrypt from 'bcryptjs';
import { db, ensure, tooMany, noteFail, audit } from '../lib/db.js';
import { idKey, ipKey, sign } from '../lib/sec.js';
import { handler, body, fail, send, clientIp } from '../lib/http.js';
import { getSettings, CONTACT } from '../lib/settings.js';

const MAX_FAIL = 5;

export default handler(['POST'], async (req, res) => {
  await ensure();
  const sql = db();
  const b = body(req);
  const name = String(b.name || '').trim(), birth = String(b.birth || '').trim(), pw = String(b.password || '');
  const ip = ipKey(clientIp(req));
  if (await tooMany(ip, 30, 15)) return fail(res, 429, '시도가 너무 많음. 15분 뒤 다시 시도해 주세요.');
  if (name.length < 2 || !/^\d{6}$/.test(birth)) return fail(res, 400, '성명과 생년월일 6자리를 확인해 주세요.');

  const st = await getSettings();
  const rows = await sql`SELECT r.*, s.status, s.submitted_at FROM roster r LEFT JOIN responses s ON s.roster_id = r.id WHERE r.key_hmac = ${idKey(name, birth)}`;
  const u = rows[0];
  if (!u) { await noteFail(ip); return fail(res, 401, '명단에서 찾을 수 없음. 성명과 생년월일을 확인해 주세요.'); }
  if (u.locked) return fail(res, 423, '잠긴 계정임. ' + CONTACT + '에게 연락해 주세요.');

  // 처음 접속: 동의 → 비밀번호 설정
  if (!u.pw_hash) {
    if (!st.open) return fail(res, 403, '지금은 접수 기간이 아님.');
    const stage = u.consent_version === st.consentVersion ? 'password' : 'consent';
    return send(res, 200, { stage, token: sign({ sub: u.id, scope: 'setup' }, 30) });
  }
  if (!pw) return send(res, 200, { stage: 'password_required' });

  const ok = await bcrypt.compare(pw, u.pw_hash);
  if (!ok) {
    await noteFail(ip);
    const n = (u.fail_count || 0) + 1;
    await sql`UPDATE roster SET fail_count = ${n}, locked = ${n >= MAX_FAIL} WHERE id = ${u.id}`;
    if (n >= MAX_FAIL) { await audit('lock', u.id); return fail(res, 423, '비밀번호를 5회 틀려 잠김. ' + CONTACT + '에게 연락해 주세요.'); }
    return fail(res, 401, '비밀번호가 맞지 않음. (' + n + '/' + MAX_FAIL + '회)');
  }
  await sql`UPDATE roster SET fail_count = 0, last_login = NOW() WHERE id = ${u.id}`;
  if (u.status === 'submitted') return send(res, 200, { stage: 'submitted', submittedAt: u.submitted_at, contact: CONTACT });
  if (!st.open) return fail(res, 403, '지금은 접수 기간이 아님.');
  const needConsent = u.consent_version !== st.consentVersion;
  return send(res, 200, { stage: needConsent ? 'consent' : 'survey', token: sign({ sub: u.id, scope: 'emp' }, 120) });
});
