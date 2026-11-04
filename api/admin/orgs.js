// 조직(센터) 주소 — 층 · 호수 · 건물명을 떼고 같은 건물은 한 위치로 묶어 좌표 · 거리를 한 번만 계산
import { db, ensure, audit } from '../../lib/db.js';
import { handler, body, fail, send, auth } from '../../lib/http.js';
import { baseAddr } from '../../lib/addr.js';
import { geocode, pool } from '../../lib/geo.js';

export default handler(['GET', 'POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();

  if (req.method === 'POST') {
    const rows = Array.isArray(body(req).rows) ? body(req).rows : [];
    if (!rows.length) return fail(res, 400, '조직 목록이 비어 있음.');
    const clean = [], bad = [], seen = {};
    rows.forEach((r, i) => {
      const code = String(r.code || '').trim(), dept = String(r.dept || '').trim(), name = String(r.name || '').trim(), addr = String(r.addr || '').trim();
      if (!code || !dept || !name || !addr || seen[code]) { bad.push(i + 2); return; }
      seen[code] = 1;
      const b = baseAddr(addr);
      clean.push({ code, dept, name, addr, base: b.base, an: b.key, sort: i });
    });
    if (bad.length) return fail(res, 400, '조직 목록 확인 필요 (빈 칸 또는 코드 중복)', { badRows: bad.slice(0, 50) });

    const uniq = {}, rawOf = {}; clean.forEach(o => { if (!uniq[o.an]) { uniq[o.an] = o.base; rawOf[o.an] = o.addr; } });
    const ans = Object.keys(uniq), addrs = ans.map(a => uniq[a]);
    await sql`INSERT INTO org_sites (addr_norm, addr) SELECT a, b FROM UNNEST(${ans}::text[], ${addrs}::text[]) AS x(a, b)
              ON CONFLICT (addr_norm) DO NOTHING`;
    const sites = await sql`SELECT id, addr_norm, addr, geo_ok FROM org_sites WHERE addr_norm = ANY(${ans}::text[])`;
    const todo = sites.filter(s => !s.geo_ok);
    // 정리한 주소로 먼저 찾고, 못 찾으면 원본 주소로 한 번 더
    const got = await pool(todo, 6, async s => (await geocode(s.addr)) || (await geocode(rawOf[s.addr_norm])));
    for (let i = 0; i < todo.length; i++) {
      const g = got[i];
      if (g) await sql`UPDATE org_sites SET lng = ${g.lng}, lat = ${g.lat}, geo_ok = TRUE WHERE id = ${todo[i].id}`;
    }
    const idOf = {}; sites.forEach(s => { idOf[s.addr_norm] = s.id; });
    await sql`DELETE FROM orgs`;
    await sql`INSERT INTO orgs (code, dept, name, site_id, sort, addr_raw)
              SELECT c, d, n, s, o, r FROM UNNEST(${clean.map(o => o.code)}::text[], ${clean.map(o => o.dept)}::text[], ${clean.map(o => o.name)}::text[],
                                               ${clean.map(o => idOf[o.an])}::int[], ${clean.map(o => o.sort)}::int[], ${clean.map(o => o.addr)}::text[]) AS x(c, d, n, s, o, r)`;
    await audit('orgs_upload');
  }

  const list = await sql`SELECT o.code, o.dept, o.name, o.addr_raw, s.addr, s.geo_ok, o.site_id,
                                (SELECT COUNT(*)::int FROM orgs o2 WHERE o2.site_id = o.site_id) AS same_n
                         FROM orgs o LEFT JOIN org_sites s ON s.id = o.site_id ORDER BY o.sort, o.code`;
  const sitesN = new Set(list.map(o => o.site_id)).size;
  send(res, 200, { list, sites: sitesN, failed: list.filter(o => !o.geo_ok).map(o => o.code) });
});
