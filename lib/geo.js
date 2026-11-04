// 주소 → 좌표 (네이버 Geocoding), 좌표 → 자동차 경로 거리 (네이버 Directions 5 · 최적 경로)
// HR노트 사택 신청(backend/routes/housing.js)과 같은 네이버 클라우드 키를 씀
import { env } from './sec.js';

const NCP = () => ({ 'x-ncp-apigw-api-key-id': env('NAVER_CLIENT_ID'), 'x-ncp-apigw-api-key': env('NAVER_CLIENT_SECRET') });

export async function geocode(addr) {
  if (!addr) return null;
  const base = process.env.NAVER_GEOCODE_URL || 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
  const r = await fetch(base + '?query=' + encodeURIComponent(addr), { headers: NCP() });
  if (!r.ok) throw new Error('네이버 좌표 변환 실패 ' + r.status);
  const j = await r.json();
  const d = j.addresses && j.addresses[0];
  if (!d) return null;
  return { lng: Number(d.x), lat: Number(d.y) };
}

export const OPTION = 'traoptimal';

export async function drive(from, to) {
  const base = process.env.NAVER_DIRECTIONS_URL || 'https://maps.apigw.ntruss.com/map-direction/v1/driving';
  const u = base + '?start=' + from.lng + ',' + from.lat + '&goal=' + to.lng + ',' + to.lat + '&option=' + OPTION;
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    const r = await fetch(u, { headers: NCP() });
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 400)); continue; }
    if (!r.ok) return null;
    const j = await r.json();
    if (j.code === 1) return { km: 0, min: 0 };               // 출발지 = 도착지
    if (j.code !== 0 || !j.route || !j.route[OPTION]) return null;
    const s = j.route[OPTION][0].summary;
    return { km: Math.round(s.distance / 100) / 10, min: Math.round(s.duration / 60000) };
  }
  return null;
}

// 동시에 n 개씩 처리
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => null); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
