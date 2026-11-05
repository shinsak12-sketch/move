// 거리 산출 — 현 거주지 주소를 받아 좌표로 바꾸고, 주소가 다른 조직 위치마다 1번씩 경로 거리를 구함
// 주소 원문과 좌표는 저장하지 않음. 남기는 것: 주소 해시(제출 때 같은 주소인지 확인용) + 거리값(암호문)
import { db, ensure, audit, member, distList } from '../lib/db.js';
import { handler, body, fail, send, auth } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { addrKey, lockBox } from '../lib/sec.js';
import { geocode, drive, pool, OPTION } from '../lib/geo.js';
import { CONTACT } from '../lib/settings.js';

export const CALC_LIMIT = 2; // 처음 1번 + 재산출 1번

export default handler(['POST'], async (req, res) => {
  const t = auth(req, ['emp']);
  if (!t) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (!(await member(t.sub))) return fail(res, 401, '명단에 없거나 잠긴 계정임. 다시 로그인해 주세요.');
  const sql = db();
  const st = await getSettings();
  if (!st.open) return fail(res, 403, '지금은 접수 기간이 아님.');
  const b = body(req);
  const road = String(b.road || '').trim(), jibun = String(b.jibun || '').trim();
  if (!road) return fail(res, 400, '현 거주지 주소가 필요함.');

  const cur = await sql`SELECT status FROM responses WHERE roster_id = ${t.sub}`;
  if (cur[0] && cur[0].status === 'submitted') return fail(res, 409, '이미 제출했음.');

  // 좌표를 못 찾으면 횟수를 쓰지 않음
  const home = (await geocode(road)) || (await geocode(jibun));
  if (!home) return fail(res, 422, '주소 위치를 찾지 못했음. 주소를 다시 검색해 주세요.');
  const sites = await sql`SELECT id, lng, lat FROM org_sites WHERE geo_ok AND id IN (SELECT DISTINCT site_id FROM orgs WHERE site_id IS NOT NULL)`;
  if (!sites.length) return fail(res, 503, '센터 주소가 아직 등록되지 않았음. 담당자에게 문의해 주세요.');

  // 횟수를 먼저 1 올려 자리를 잡음 (동시에 여러 번 눌러도 한도를 못 넘게 한 문장으로 처리)
  const seat = await sql`INSERT INTO responses (roster_id, status, calc_count) VALUES (${t.sub}, 'draft', 1)
            ON CONFLICT (roster_id) DO UPDATE SET calc_count = responses.calc_count + 1
            WHERE responses.calc_count < ${CALC_LIMIT} AND responses.status <> 'submitted'
            RETURNING calc_count`;
  if (!seat[0]) return fail(res, 429, '거리 산출은 재산출 포함 2번까지만 가능함. ' + CONTACT + '에게 연락해 주세요.', { calcCount: CALC_LIMIT, calcLimit: CALC_LIMIT });

  let got;
  try { got = await pool(sites, 8, s => drive(home, { lng: s.lng, lat: s.lat })); }
  catch (e) { await sql`UPDATE responses SET calc_count = GREATEST(calc_count - 1, 0) WHERE roster_id = ${t.sub}`; throw e; }
  const box = {}; let n = 0;
  sites.forEach((s, i) => { if (got[i]) { box[s.id] = [got[i].km, got[i].min]; n++; } });
  if (!n) { await sql`UPDATE responses SET calc_count = GREATEST(calc_count - 1, 0) WHERE roster_id = ${t.sub}`; return fail(res, 502, '경로 계산에 실패했음. 잠시 뒤 다시 시도해 주세요. (횟수는 차감하지 않음)'); }

  const enc = lockBox(box);
  await sql`UPDATE responses SET enc_dist = ${enc}, addr_hash = ${addrKey(road)}, calc_at = NOW() WHERE roster_id = ${t.sub}`;
  await audit('calc', t.sub);
  const list = await distList(enc);
  send(res, 200, { list, failed: sites.length - n, houseKm: st.houseKm, calcAt: new Date().toISOString(), calcCount: seat[0].calc_count, calcLimit: CALC_LIMIT });
});
