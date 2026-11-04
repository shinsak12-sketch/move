// 화면에 필요한 설정 (동의서 · 사유 구분값 · 사택 기준). 직원 토큰이 있으면 센터 목록도 줌
import { db, ensure } from '../lib/db.js';
import { handler, send, auth } from '../lib/http.js';
import { getSettings, CONTACT } from '../lib/settings.js';

export default handler(['GET'], async (req, res) => {
  await ensure();
  const st = await getSettings();
  const out = { open: st.open, houseKm: st.houseKm, reasons: st.reasons, consentText: st.consentText, consentVersion: st.consentVersion, title: st.surveyTitle, contact: CONTACT };
  if (auth(req, ['emp'])) out.orgs = await db()`SELECT code, dept, name FROM orgs ORDER BY sort, code`;
  send(res, 200, out);
});
