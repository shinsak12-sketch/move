import { ensure, audit } from '../../lib/db.js';
import { handler, body, fail, send, auth } from '../../lib/http.js';
import { getSettings, saveSettings } from '../../lib/settings.js';

export default handler(['GET', 'POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  await ensure();
  if (req.method === 'GET') return send(res, 200, await getSettings());
  const b = body(req), patch = {};
  if (b.open !== undefined) patch.open = !!b.open;
  if (b.houseKm !== undefined) { const n = Number(b.houseKm); if (!(n > 0 && n < 1000)) return fail(res, 400, '사택 기준 거리를 확인해 주세요.'); patch.houseKm = n; }
  if (Array.isArray(b.reasons)) { const r = b.reasons.map(x => String(x).trim().slice(0, 30)).filter(Boolean); if (!r.length) return fail(res, 400, '사유 구분값이 1개 이상 필요함.'); patch.reasons = r; }
  if (typeof b.consentText === 'string') { if (b.consentText.trim().length < 20) return fail(res, 400, '동의서 문구가 너무 짧음.'); patch.consentText = b.consentText.trim(); }
  const next = await saveSettings(patch);
  await audit('settings');
  send(res, 200, next);
});
