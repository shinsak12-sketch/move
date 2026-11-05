// 직원 상태 (다시 들어왔을 때 거리 결과를 다시 보여주기 위함)
import { db, ensure, member, distList } from '../lib/db.js';
import { handler, fail, send, auth } from '../lib/http.js';

export default handler(['GET'], async (req, res) => {
  const t = auth(req, ['emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (!(await member(t.sub))) return fail(res, 401, '명단에 없거나 잠긴 계정임. 다시 로그인해 주세요.');
  const sql = db();
  const r = await sql`SELECT status, calc_at, submitted_at, calc_count, enc_dist FROM responses WHERE roster_id = ${t.sub}`;
  const s = r[0] || {};
  let list = [];
  if (s.calc_at && s.enc_dist) list = await distList(s.enc_dist);
  send(res, 200, { status: s.status || 'none', calcAt: s.calc_at || null, submittedAt: s.submitted_at || null, calcCount: s.calc_count || 0, calcLimit: 2, list });
});
