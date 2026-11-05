// 관리자 로그인 (계정 1개 · 환경변수 ADMIN_ID / ADMIN_PASSWORD + Google OTP ADMIN_TOTP_SECRET)
import { db, ensure, tooMany, noteFail, audit } from '../../lib/db.js';
import { handler, body, fail, send, clientIp } from '../../lib/http.js';
import { env, ipKey, sameText, sign, totpCheck } from '../../lib/sec.js';

export const ADMIN_MINUTES = 60;

export default handler(['POST'], async (req, res) => {
  await ensure();
  const ip = ipKey('admin|' + clientIp(req));
  if (await tooMany(ip, 10, 15)) return fail(res, 429, '시도가 너무 많음. 15분 뒤 다시 시도해 주세요.');
  const b = body(req);
  const ok = sameText(b.id, env('ADMIN_ID')) && sameText(b.password, env('ADMIN_PASSWORD'));
  if (!ok) { await noteFail(ip); return fail(res, 401, '아이디 또는 비밀번호가 맞지 않음.'); }

  const secret = process.env.ADMIN_TOTP_SECRET;
  if (secret) {
    const step = totpCheck(secret, b.otp);
    if (step < 0) { await noteFail(ip); return fail(res, 401, 'OTP 인증 코드가 맞지 않음.', { needOtp: true }); }
    // 같은 코드 재사용 막기
    const sql = db();
    const used = await sql`INSERT INTO settings (key, val) VALUES ('otp_last', ${JSON.stringify(step)}::jsonb)
                           ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val WHERE (settings.val)::text::bigint < ${step}
                           RETURNING key`;
    if (!used[0]) { await noteFail(ip); return fail(res, 401, '이미 쓴 OTP 코드임. 다음 코드로 다시 해 주세요.', { needOtp: true }); }
  }
  await audit('admin_login');
  send(res, 200, { token: sign({ sub: 'admin', scope: 'admin' }, ADMIN_MINUTES), otp: !!secret, minutes: ADMIN_MINUTES });
});
