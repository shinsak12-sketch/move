// 화면에 필요한 설정 (동의서 · 사유 구분값 · 사택 기준). 직원 토큰이 있으면 센터 목록도 줌
import { db, ensure, member } from '../lib/db.js';
import { handler, send, auth } from '../lib/http.js';
import { getSettings, CONTACT } from '../lib/settings.js';
import { publicKeyPem } from '../lib/sec.js';

export default handler(['GET'], async (req, res) => {
  await ensure();
  const st = await getSettings();
  const out = { open: st.open, houseKm: st.houseKm, reasons: st.reasons, consentText: st.consentText, consentVersion: st.consentVersion, title: st.surveyTitle, contact: CONTACT };
  const t = auth(req, ['emp']);
  if (t && (await member(t.sub))) {
    out.orgs = await db()`SELECT code, kind, region, dept, name FROM orgs ORDER BY sort, code`;
    out.publicKey = publicKeyPem(); // 직원 브라우저에서 응답을 암호화할 공개키 (공개돼도 되는 값)
  }
  send(res, 200, out);
});
