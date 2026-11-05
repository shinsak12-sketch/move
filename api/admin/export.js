// 내려받기용 원자료 — 개인정보는 암호문 그대로. 엑셀 생성 · 복호화는 관리자 브라우저에서 함
import { db, ensure, audit } from '../../lib/db.js';
import { handler, fail, send, auth } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';
import { OPTION } from '../../lib/geo.js';
import { openBox } from '../../lib/sec.js';

export default handler(['GET'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const st = await getSettings();
  const orgs = await sql`SELECT o.code, o.kind, o.region, o.dept, o.name, o.site_id, o.addr_raw, s.addr FROM orgs o LEFT JOIN org_sites s ON s.id = o.site_id ORDER BY o.sort, o.code`;
  const roster = await sql`SELECT id, enc_identity, hq, dept, center, consent_version, consent_at FROM roster ORDER BY hq NULLS LAST, dept NULLS LAST, center NULLS LAST, id`;
  const responses = await sql`SELECT roster_id, status, calc_at, enc_payload, enc_dist, prev_changed, move_planned, move_month, move_as_base,
                                     wish, reason_code, wish1, wish2, wish3, wishes, submitted_at FROM responses`;
  // 거리값은 서버 키로 풀어서 관리자에게만 내려줌
  const distances = [];
  responses.forEach(r => { const d = openBox(r.enc_dist) || {}; Object.keys(d).forEach(k => distances.push({ roster_id: r.roster_id, site_id: Number(k), km: d[k][0], min: d[k][1] })); delete r.enc_dist; });
  await audit('export');
  send(res, 200, { at: new Date().toISOString(), option: OPTION, houseKm: st.houseKm, consentVersion: st.consentVersion, orgs, roster, responses, distances });
});
