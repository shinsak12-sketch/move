// 최종 제출 — 주소 · 이전 주소 · 이사 예정지 · 사유 서술은 직원 브라우저에서 공개키로 암호화돼서 옴(서버도 못 풂). 제출 후 수정 불가
import { db, ensure, audit, member } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings, CONTACT } from '../lib/settings.js';
import { addrKey, isSealed } from '../lib/sec.js';

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

  // 거리 산출한 주소와 같은지만 해시로 확인 (현 주소는 거리 계산 때 이미 서버를 거쳐 네이버로 감)
  const road = s(b.road, 200);
  if (!road) return fail(res, 400, '현 거주지 주소를 골라 주세요.');
  if (cur.addr_hash !== addrKey(road)) return fail(res, 409, '주소가 바뀌었음. 거리를 다시 산출해 주세요.');
  if (!isSealed(b.enc)) return fail(res, 400, '암호화된 응답이 아님. 새로고침 후 다시 제출해 주세요.');

  const prevChanged = !!b.prevChanged;
  const movePlanned = !!b.movePlanned;
  const moveMonth = String(b.moveMonth || '');
  if (movePlanned && !/^\d{4}-\d{2}$/.test(moveMonth)) return fail(res, 400, '이사 예정월을 골라 주세요.');

  // 지망: 1지망 필수(부서 또는 'NONE' = 발령 희망하지 않음), 2 · 3지망 선택, 부서마다 센터 최대 3곳
  const orgs = await sql`SELECT code, kind, dept FROM orgs`;
  const byCode = {}; orgs.forEach(o => { byCode[o.code] = o; });
  const raw = Array.isArray(b.wishes) ? b.wishes.slice(0, 3) : [];
  if (!raw.length || !raw[0] || !raw[0].dept) return fail(res, 400, '1지망을 골라 주세요.');
  const wishes = [], usedDept = {};
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i] || {}, code = String(w.dept || '');
    if (!code) break;
    if (code === 'NONE') { if (i !== 0) return fail(res, 400, '발령 희망하지 않음은 1지망에서만 고를 수 있음.'); wishes.push({ dept: 'NONE', centers: [] }); continue; }
    const d = byCode[code];
    if (!d || d.kind !== '부서' || usedDept[code]) return fail(res, 400, (i + 1) + '지망 부서를 다시 골라 주세요.');
    usedDept[code] = 1;
    const cs = (Array.isArray(w.centers) ? w.centers : []).map(String).filter(Boolean).slice(0, 3);
    if (new Set(cs).size !== cs.length || cs.some(c => !byCode[c] || byCode[c].kind !== '센터' || byCode[c].dept !== d.dept)) return fail(res, 400, (i + 1) + '지망 센터를 다시 골라 주세요.');
    wishes.push({ dept: code, centers: cs });
  }
  const wish = wishes[0].dept === 'NONE' ? 'N' : 'Y';
  let reasonCode = null;
  if (wish === 'Y') {
    reasonCode = s(b.reasonCode, 30);
    if (st.reasons.indexOf(reasonCode) < 0) return fail(res, 400, '사유 구분을 골라 주세요.');
  }

  const enc = b.enc;
  // 지망 · 사유 구분 · 이사 예정월 등은 위에서 형식만 확인하고 평문으로는 저장하지 않음 (암호문 안에 들어 있음)
  const done = await sql`UPDATE responses SET status = 'submitted', enc_payload = ${enc},
      prev_changed = NULL, move_planned = NULL, move_month = NULL, move_as_base = NULL, wish = NULL, reason_code = NULL,
      wish1 = NULL, wish2 = NULL, wish3 = NULL, wishes = NULL, submitted_at = NOW()
    WHERE roster_id = ${t.sub} AND status <> 'submitted' RETURNING submitted_at`;
  if (!done[0]) return fail(res, 409, '이미 제출했음.');
  await audit('submit', t.sub);
  send(res, 200, { ok: true, submittedAt: done[0].submitted_at, contact: CONTACT });
});
