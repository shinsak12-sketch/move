// 명단 업로드 (양식: 본부 · 부서 · 센터 · 이름 · 생년월일)
// 이름 · 생년월일은 해시(로그인 조회용) + 공개키 암호문(관리자 열람용)으로만 저장. 본부 · 부서 · 센터는 그대로 저장
import { db, ensure, audit } from '../../lib/db.js';
import { handler, body, fail, send, auth } from '../../lib/http.js';
import { idKey, seal } from '../../lib/sec.js';

export default handler(['POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const b = body(req);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return fail(res, 400, '명단이 비어 있음.');
  if (rows.length > 5000) return fail(res, 400, '한 번에 5,000명까지 올릴 수 있음.');

  const bad = [], seen = {}, dup = [];
  const keys = [], encs = [], hqs = [], depts = [], centers = [];
  rows.forEach((r, i) => {
    const name = String(r.name || '').trim(), birth = String(r.birth || '').trim();
    const hq = String(r.hq || '').trim().slice(0, 50), dept = String(r.dept || '').trim().slice(0, 50), center = String(r.center || '').trim().slice(0, 50);
    if (name.length < 2 || !/^\d{6}$/.test(birth)) { bad.push(i + 2); return; }
    const k = idKey(name, birth);
    if (seen[k]) { dup.push(i + 2); return; }
    seen[k] = 1;
    keys.push(k); encs.push(seal({ name, birth })); hqs.push(hq || null); depts.push(dept || null); centers.push(center || null);
  });
  if (bad.length || dup.length) return fail(res, 400, '명단 확인 필요', { badRows: bad.slice(0, 50), dupRows: dup.slice(0, 50) });

  await sql`INSERT INTO roster (key_hmac, enc_identity, hq, dept, center)
            SELECT k, e, h, d, c FROM UNNEST(${keys}::text[], ${encs}::text[], ${hqs}::text[], ${depts}::text[], ${centers}::text[]) AS x(k, e, h, d, c)
            ON CONFLICT (key_hmac) DO UPDATE SET enc_identity = EXCLUDED.enc_identity, hq = EXCLUDED.hq, dept = EXCLUDED.dept, center = EXCLUDED.center`;
  let removed = 0;
  if (b.removeMissing) {
    const r = await sql`DELETE FROM roster WHERE NOT (key_hmac = ANY(${keys}::text[])) RETURNING id`;
    removed = r.length;
  }
  const total = (await sql`SELECT COUNT(*)::int AS n FROM roster`)[0].n;
  await audit('roster_upload');
  send(res, 200, { ok: true, uploaded: keys.length, removed, total });
});
