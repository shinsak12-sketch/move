// Google OTP 등록용 — 새 비밀값과 QR 을 만들어 줌. 서버에 저장하지 않음.
// 관리자가 앱에 등록한 뒤 Vercel 환경변수 ADMIN_TOTP_SECRET 에 넣고 다시 배포하면 그때부터 OTP 필수.
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { handler, fail, send, auth, body } from '../../lib/http.js';
import { b32encode, totpCheck } from '../../lib/sec.js';

export default handler(['GET', 'POST'], async (req, res) => {
  if (!auth(req, ['admin'])) return fail(res, 401, '다시 로그인해 주세요.');
  if (process.env.ADMIN_TOTP_SECRET) return send(res, 200, { enabled: true });
  if (req.method === 'POST') { // 앱에 잘 등록됐는지 코드로 확인만 함
    const b = body(req);
    return send(res, 200, { ok: totpCheck(String(b.secret || ''), b.otp) >= 0 });
  }
  const secret = b32encode(crypto.randomBytes(20));
  const uri = 'otpauth://totp/' + encodeURIComponent('주소취합 관리자') + '?secret=' + secret + '&issuer=' + encodeURIComponent('주소취합') + '&algorithm=SHA1&digits=6&period=30';
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  send(res, 200, { enabled: false, secret, svg });
});
