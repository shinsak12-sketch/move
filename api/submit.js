// 최종 제출 — 주소 · 사유 서술은 공개키로 암호화해서 저장. 제출 후 수정 불가
import { db, ensure, audit, member } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings, CONTACT } from '../lib/settings.js';
import { addrKey, seal } from '../lib/sec.js';

const s = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export default handler(['POST'], async (req, res) => {
  const t = auth(req, ['emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (!(await member(t.sub))) return fail(res, 401, '명단에 없거나 잠긴 계정임. 다시 로그인해 주세요.');
  const sql = db();
  const st = await getSettings();
  if (!st.open) return fail(res, 403, '지금은 접수 기간이 아님.');
  const b = body(req);

  const u = (await sql`SELECT consent_version FROM roster WHERE id = ${t.sub}`)[0];
  if (!u || u.consent_version !== st.consentVersion) return fail(res, 400, '개인정보 동의가 필요함.');
  const cur = (await sql`SELECT status, addr_hash FROM responses WHERE roster_id = ${t.sub}`)[0];
  if (!cur) return fail(res, 400, '거리 산출을 먼저 해 주세요.');
  if (cur.status === 'submitted') return fail(res, 409, '이미 제출했음. 수정은 ' + CONTACT + '에게 연락해 주세요.');

  const home = b.home || {};
  const road = s(home.road, 200);
  if (!road || !s(home.detail, 100)) return fail(res, 400, '현 거주지 주소와 상세주소를 입력해 주세요.');
  if (cur.addr_hash !== addrKey(road)) return fail(res, 409, '주소가 바뀌었음. 거리를 다시 산출해 주세요.');

  const prevChanged = !!b.prevChanged;
  const prev = b.prev || {};
  if (prevChanged && (!s(prev.road, 200) || !s(prev.detail, 100))) return fail(res, 400, '이전 주소를 입력해 주세요.');

  const movePlanned = !!b.movePlanned;
  const move = b.move || {};
  if (movePlanned && (!/^\d{4}-\d{2}$/.test(String(move.month || '')) || !s(move.area, 100))) return fail(res, 400, '이사 예정월과 예정지를 입력해 주세요.');

  const wish = b.wish === 'Y' ? 'Y' : b.wish === 'N' ? 'N' : '';
  if (!wish) return fail(res, 400, '발령 희망 여부를 골라 주세요.');
  let reasonCode = null, ranks = [null, null, null];
  if (wish === 'Y') {
    reasonCode = s(b.reasonCode, 30);
    if (st.reasons.indexOf(reasonCode) < 0) return fail(res, 400, '사유 구분을 골라 주세요.');
    if (s(b.reasonText, 300).length < 5) return fail(res, 400, '사유를 5자 이상 적어 주세요.');
    const codes = (await sql`SELECT code FROM orgs WHERE kind = '센터'`).map(r => r.code);
    ranks = [0, 1, 2].map(i => (b.ranks && b.ranks[i]) ? String(b.ranks[i]) : null);
    if (!ranks[0]) return fail(res, 400, '1순위 희망 센터를 골라 주세요.');
    const picked = ranks.filter(Boolean);
    if (picked.some(c => codes.indexOf(c) < 0) || new Set(picked).size !== picked.length) return fail(res, 400, '희망 센터를 다시 골라 주세요.');
  }

  const enc = seal({
    home: { road, jibun: s(home.jibun, 200), zip: s(home.zip, 10), detail: s(home.detail, 100) },
    prev: prevChanged ? { road: s(prev.road, 200), jibun: s(prev.jibun, 200), detail: s(prev.detail, 100) } : null,
    move: movePlanned ? { area: s(move.area, 100) } : null,
    reasonText: wish === 'Y' ? s(b.reasonText, 300) : ''
  });
  const done = await sql`UPDATE responses SET status = 'submitted', enc_payload = ${enc},
      prev_changed = ${prevChanged}, move_planned = ${movePlanned}, move_month = ${movePlanned ? String(move.month) : null},
      move_as_base = ${movePlanned && !!move.base}, wish = ${wish}, reason_code = ${reasonCode},
      wish1 = ${ranks[0]}, wish2 = ${ranks[1]}, wish3 = ${ranks[2]}, submitted_at = NOW()
    WHERE roster_id = ${t.sub} AND status <> 'submitted' RETURNING submitted_at`;
  if (!done[0]) return fail(res, 409, '이미 제출했음.');
  await audit('submit', t.sub);
  send(res, 200, { ok: true, submittedAt: done[0].submitted_at, contact: CONTACT });
});
