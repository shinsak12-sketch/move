// 진행 현황 — 이름은 암호문으로만 내려감(관리자 브라우저에서 개인키로 풂)
import { db, ensure } from '../../lib/db.js';
import { handler, fail, send, auth } from '../../lib/http.js';
import { getSettings } from '../../lib/settings.js';

export default handler(['GET'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const rows = await sql`SELECT r.id, r.enc_identity, r.hq, r.dept, r.center, r.pw_hash IS NOT NULL AS has_pw, r.locked, r.fail_count,
                                r.last_login, s.status, s.calc_at, s.submitted_at, COALESCE(s.calc_count, 0) AS calc_count
                         FROM roster r LEFT JOIN responses s ON s.roster_id = r.id ORDER BY r.hq NULLS LAST, r.dept NULLS LAST, r.center NULLS LAST, r.id`;
  const orgs = (await sql`SELECT COUNT(*)::int AS n FROM orgs`)[0].n;
  const st = await getSettings();
  send(res, 200, { rows, orgs, settings: { open: st.open, consentVersion: st.consentVersion }, at: new Date().toISOString() });
});
