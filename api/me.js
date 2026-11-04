// 직원 상태 (다시 들어왔을 때 거리 결과를 다시 보여주기 위함)
import { db, ensure } from '../lib/db.js';
import { handler, fail, send, auth } from '../lib/http.js';

export default handler(['GET'], async (req, res) => {
  const t = auth(req, ['emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const r = await sql`SELECT status, calc_at, submitted_at, calc_count FROM responses WHERE roster_id = ${t.sub}`;
  const s = r[0] || {};
  let list = [];
  if (s.calc_at) list = await sql`SELECT o.code, o.dept, o.name, d.km::float AS km, d.min FROM orgs o
                                  LEFT JOIN distances d ON d.site_id = o.site_id AND d.roster_id = ${t.sub}
                                  ORDER BY d.km NULLS LAST, o.sort, o.code`;
  send(res, 200, { status: s.status || 'none', calcAt: s.calc_at || null, submittedAt: s.submitted_at || null, calcCount: s.calc_count || 0, calcLimit: 2, list });
});
