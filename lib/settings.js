import { db } from './db.js';

export const CONTACT = '손사지원파트 신이삭 수석';

export const DEFAULT_CONSENT = [
  '1. 수집 항목: 성명, 생년월일, 현 거주지 주소(도로명 주소까지 · 동 · 호수 등 상세주소는 받지 않음), 2025년 주소(변경 시, 도로명까지), 이사 예정월 · 예정지(동 단위), 희망 지망(부서 · 센터), 발령 희망 사유',
  '2. 이용 목적: 정기 인사발령 및 사택 배정 검토',
  '3. 처리 위치: 입력 정보는 해외 클라우드 서버(Neon, 국외 리전)에 암호화하여 저장됨. 국내 리전이 없어 국외에 저장됨',
  '4. 처리 위탁: 주소 검색(카카오 우편번호), 좌표 변환 · 거리 계산(네이버)',
  '5. 보유 및 파기: 조사 완료 후 서버의 자료는 즉시 파기함. 자료는 회사 보안망 안으로 옮겨 인사 업무에만 사용함',
  '6. 동의 거부: 동의하지 않을 수 있음. 이 경우 거리 자동 산출과 희망 접수가 어려움'
].join('\n');

export const DEFAULTS = {
  open: true,
  houseKm: 50,
  reasons: ['육아', '간병', '통근 거리', '이사', '건강', '배우자 근무지', '경력 개발', '기타'],
  consentText: DEFAULT_CONSENT,
  consentVersion: 1,
  surveyTitle: '거주지 · 발령 희망 조사'
};

export async function getSettings() {
  const r = await db()`SELECT val FROM settings WHERE key = 'main'`;
  return Object.assign({}, DEFAULTS, r[0] ? r[0].val : {});
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch);
  if (patch.consentText !== undefined && patch.consentText !== cur.consentText) next.consentVersion = (cur.consentVersion || 1) + 1;
  await db()`INSERT INTO settings (key, val) VALUES ('main', ${JSON.stringify(next)}::jsonb)
             ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`;
  return next;
}
