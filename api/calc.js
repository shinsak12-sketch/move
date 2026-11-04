// 거리 산출 — 현 거주지 주소를 받아 좌표로 바꾸고, 주소가 다른 조직 위치마다 1번씩 경로 거리를 구함
// 주소 원문과 좌표는 저장하지 않음. 남기는 것: 주소 해시(제출 때 같은 주소인지 확인용) + 거리값
import { db, ensure, audit } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { addrKey } from '../lib/sec.js';
import { geocode, drive, pool, OPTION } from '../lib/geo.js';
import { CONTACT } from '../lib/settings.js';

export const CALC_LIMIT = 2; // 처음 1번 + 재산출 1번

export default handler(['POST'], async (req, res) => {
  const t = auth(req, ['emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  const sql = db();
  const st = await getSettings();
  if (!st.open) return fail(res, 403, '지금은 접수 기간이 아님.');
  const b = body(req);
  const road = String(b.road || '').trim(), jibun = String(b.jibun || '').trim();
  if (!road) return fail(res, 400, '현 거주지 주소가 필요함.');

  const cur = await sql`SELECT status, calc_count FROM responses WHERE roster_id = ${t.sub}`;
  if (cur[0] && cur[0].status === 'submitted') return fail(res, 409, '이미 제출했음.');
  const used = cur[0] ? cur[0].calc_count : 0;
  if (used >= CALC_LIMIT) return fail(res, 429, '거리 산출은 재산출 포함 2번까지만 가능함. ' + CONTACT + '에게 연락해 주세요.', { calcCount: used, calcLimit: CALC_LIMIT });

  // 좌표를 못 찾으면 횟수를 쓰지 않음
  const home = (await geocode(road)) || (await geocode(jibun));
  if (!home) return fail(res, 422, '주소 위치를 찾지 못했음. 주소를 다시 검색해 주세요.');

  const sites = await sql`SELECT id, lng, lat FROM org_sites WHERE geo_ok AND id IN (SELECT DISTINCT site_id FROM orgs WHERE site_id IS NOT NULL)`;
  if (!sites.length) return fail(res, 503, '센터 주소가 아직 등록되지 않았음. 담당자에게 문의해 주세요.');
  const got = await pool(sites, 8, s => drive(home, { lng: s.lng, lat: s.lat }));

  const ids = [], kms = [], mins = [];
  sites.forEach((s, i) => { if (got[i]) { ids.push(s.id); kms.push(got[i].km); mins.push(got[i].min); } });
  await sql`DELETE FROM distances WHERE roster_id = ${t.sub}`;
  if (ids.length) {
    await sql`INSERT INTO distances (roster_id, site_id, km, min, option, calc_at)
              SELECT ${t.sub}, s, k, m, ${OPTION}, NOW() FROM UNNEST(${ids}::int[], ${kms}::numeric[], ${mins}::int[]) AS x(s, k, m)`;
  }
  const up = await sql`INSERT INTO responses (roster_id, status, addr_hash, calc_at, calc_count) VALUES (${t.sub}, 'draft', ${addrKey(road)}, NOW(), 1)
            ON CONFLICT (roster_id) DO UPDATE SET addr_hash = EXCLUDED.addr_hash, calc_at = EXCLUDED.calc_at,
            calc_count = responses.calc_count + 1,
            status = CASE WHEN responses.status = 'submitted' THEN responses.status ELSE 'draft' END
            RETURNING calc_count`;
  await audit('calc', t.sub);

  const list = await sql`SELECT o.code, o.dept, o.name, d.km::float AS km, d.min FROM orgs o
                         LEFT JOIN distances d ON d.site_id = o.site_id AND d.roster_id = ${t.sub}
                         ORDER BY d.km NULLS LAST, o.sort, o.code`;
  send(res, 200, { list, failed: sites.length - ids.length, houseKm: st.houseKm, calcAt: new Date().toISOString(), calcCount: up[0].calc_count, calcLimit: CALC_LIMIT });
});
