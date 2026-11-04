// 개별 처리: 비밀번호 초기화 · 잠금 해제 · 재작성 허용
import { db, ensure, audit } from '../../lib/db.js';
import { handler, body, fail, send, auth } from '../../lib/http.js';

export default handler(['POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const b = body(req), id = Number(b.id);
  if (!id) return fail(res, 400, '대상이 없음.');
  if (b.action === 'reset') await sql`UPDATE roster SET pw_hash = NULL, fail_count = 0, locked = FALSE WHERE id = ${id}`;
  else if (b.action === 'unlock') await sql`UPDATE roster SET fail_count = 0, locked = FALSE WHERE id = ${id}`;
  else if (b.action === 'reopen') await sql`UPDATE responses SET status = 'reopened' WHERE roster_id = ${id}`;
  else if (b.action === 'calcReset') await sql`UPDATE responses SET calc_count = 0 WHERE roster_id = ${id}`;
  else return fail(res, 400, '알 수 없는 처리');
  await audit('admin_' + b.action, id);
  send(res, 200, { ok: true });
});
