// 전체 파기 — 서버(Neon)의 조사 자료를 모두 지움
import { db, ensure } from '../../lib/db.js';
import { handler, body, fail, send, auth } from '../../lib/http.js';

export default handler(['POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  const b = body(req);
  if (String(b.confirm || '').trim() !== '파기') return fail(res, 400, '확인 문구가 맞지 않음.');
  await ensure();
  const sql = db();
  await sql`DELETE FROM distances`;
  await sql`DELETE FROM responses`;
  await sql`DELETE FROM roster`;
  await sql`DELETE FROM login_attempts`;
  await sql`DELETE FROM audit`;
  if (!b.keepOrgs) { await sql`DELETE FROM orgs`; await sql`DELETE FROM org_sites`; }
  if (!b.keepSettings) await sql`DELETE FROM settings`;
  send(res, 200, { ok: true, at: new Date().toISOString() });
});
