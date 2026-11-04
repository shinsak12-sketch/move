/* 거주지 · 발령 희망 조사 — 직원 화면
   입력 중인 내용은 이 기기의 sessionStorage 에만 임시로 둠(탭을 닫으면 사라짐).
   서버에는 [거리 산출] 때 주소를 잠깐 보내 거리만 남기고, [최종 제출] 때 암호화해서 저장함. */
(function () {
  'use strict';

  var POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  var SKEY = 'addr-survey.v1';
  var TITLES = ['본인 확인', '개인정보 동의', '비밀번호', '현 거주지', '이전 주소', '이사 예정', '거리 산출', '발령 희망', '희망 센터', '확인 · 제출', '완료'];
  var ICON_CHECK = '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5"/></svg>';
  var ICON_SEARCH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  var ICON_BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var app = document.getElementById('app');
  var S = fresh();
  var cfg = null;          // 서버 설정 (동의서 · 사유 · 사택 기준 · 센터 목록)
  var toastTimer = null;
  var lastStep = -1;

  function fresh() {
    return {
      step: 0, maxStep: 0, token: '', name: '', birth: '', needPw: false, loginPw: '',
      agree: { collect: false, overseas: false, entrust: false }, pw1: '', pw2: '',
      home: null, homeDetail: '', prevChanged: false, prev: null, prevDetail: '',
      movePlanned: false, moveMonth: '', moveArea: '', moveBase: false,
      calc: { state: 'idle', list: [], at: null, road: '' }, filter: 'all',
      wish: '', reasonCode: '', reasonText: '', ranks: ['', '', ''],
      sheet: null, slot: 0, q: '', confirm: false, busy: false, submittedAt: null, contact: '손사지원파트 신이삭 수석'
    };
  }

  /* ---------- 저장(이 기기 세션에만) ---------- */
  function save() {
    try {
      var keep = {}; Object.keys(S).forEach(function (k) { if (['sheet', 'q', 'confirm', 'busy', 'loginPw', 'pw1', 'pw2'].indexOf(k) < 0) keep[k] = S[k]; });
      sessionStorage.setItem(SKEY, JSON.stringify(keep));
    } catch (e) {}
  }
  function load() {
    try { var v = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); if (v) Object.assign(S, v, { sheet: null, confirm: false, busy: false }); } catch (e) {}
    if (S.calc && S.calc.state === 'run') S.calc.state = 'idle';
  }
  function clearAll() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }

  /* ---------- 공통 ---------- */
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (S.token) h.Authorization = 'Bearer ' + S.token;
    return fetch('/api/' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || '요청이 실패했음'); e.status = r.status; e.data = j; throw e; } return j; }); });
  }
  function toast(msg, isErr) {
    var old = document.querySelector('.toast'); if (old) old.remove();
    var d = document.createElement('div'); d.className = 'toast' + (isErr ? ' err' : ''); d.setAttribute('role', 'status'); d.textContent = msg;
    app.appendChild(d); clearTimeout(toastTimer); toastTimer = setTimeout(function () { d.remove(); }, 3800);
  }
  function onErr(e) {
    S.busy = false;
    if (e && e.status === 401 && S.step > 0) { toast('접속 시간이 지났음. 다시 본인 확인을 해 주세요.', true); S.token = ''; S.step = 0; S.needPw = true; render(); return; }
    toast((e && e.message) || '오류가 났음', true); render();
  }
  function months() {
    var out = [], d = new Date(); d.setDate(1);
    for (var i = 1; i <= 18; i++) { var x = new Date(d.getFullYear(), d.getMonth() + i, 1); out.push({ v: x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), t: x.getFullYear() + '년 ' + (x.getMonth() + 1) + '월' }); }
    return out;
  }
  function monthLabel(v) { if (!v) return ''; var p = v.split('-'); return p[0] + '년 ' + Number(p[1]) + '월'; }
  function fmtTime(iso) { if (!iso) return ''; var d = new Date(iso), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function houseKm() { return (cfg && cfg.houseKm) || 50; }
  function orgByCode(c) { var l = S.calc.list || []; for (var i = 0; i < l.length; i++) if (l[i].code === c) return l[i]; return null; }

  /* ---------- 단계 이동 ---------- */
  function valid(s) {
    switch (s) {
      case 0: return S.name.trim().length >= 2 && /^\d{6}$/.test(S.birth) && (!S.needPw || S.loginPw.length >= 6);
      case 1: return S.agree.collect && S.agree.overseas && S.agree.entrust;
      case 2: return S.pw1.length >= 6 && S.pw1 === S.pw2;
      case 3: return !!S.home && S.homeDetail.trim().length > 0;
      case 4: return !S.prevChanged || (!!S.prev && S.prevDetail.trim().length > 0);
      case 5: return !S.movePlanned || (!!S.moveMonth && !!S.moveArea);
      case 6: return S.calc.state === 'done' && S.calc.road === (S.home && S.home.road);
      case 7: return S.wish === 'N' || (S.wish === 'Y' && !!S.reasonCode && S.reasonText.trim().length >= 5);
      case 8: return !!S.ranks[0];
      default: return true;
    }
  }
  function go(n) { S.step = n; if (n > S.maxStep && n <= 9) S.maxStep = n; save(); render(); var b = document.querySelector('.bd'); if (b) b.scrollTop = 0; }
  function prevOf(s) { if (s === 9 && S.wish === 'N') return 7; return s - 1; }
  function nextOf(s) { if (s === 7 && S.wish === 'N') return 9; return s + 1; }

  function primary() {
    var s = S.step;
    if (S.busy) return;
    if (s === 0) return doLogin();
    if (s === 1) return doConsent();
    if (s === 2) return doPassword();
    if (s === 6 && !valid(6)) return doCalc();
    if (s === 9) { S.confirm = true; return render(); }
    if (!valid(s)) return;
    go(nextOf(s));
  }

  /* ---------- 서버 호출 ---------- */
  function doLogin() {
    if (!valid(0)) return;
    S.busy = true; render();
    api('login', { body: { name: S.name.trim(), birth: S.birth, password: S.needPw ? S.loginPw : '' } }).then(function (r) {
      S.busy = false; S.loginPw = '';
      if (r.stage === 'password_required') { S.needPw = true; render(); var p = document.getElementById('lpw'); if (p) p.focus(); return; }
      if (r.stage === 'submitted') { S.submittedAt = r.submittedAt; S.contact = r.contact || S.contact; clearAll(); S.step = 10; render(); return; }
      S.token = r.token;
      if (r.stage === 'consent') return go(1);
      if (r.stage === 'password') return go(2);
      return enterSurvey();
    }).catch(onErr);
  }
  function doConsent() {
    if (!valid(1)) return;
    S.busy = true; render();
    api('consent', { body: { version: cfg.consentVersion, agree: S.agree } }).then(function (r) {
      S.busy = false;
      if (r.next === 'password') return go(2);
      enterSurvey();
    }).catch(onErr);
  }
  function doPassword() {
    if (!valid(2)) return;
    S.busy = true; render();
    api('password', { body: { password: S.pw1 } }).then(function (r) { S.busy = false; S.token = r.token; S.pw1 = S.pw2 = ''; enterSurvey(); }).catch(onErr);
  }
  function enterSurvey() {
    S.busy = true; render();
    Promise.all([api('public'), api('me')]).then(function (x) {
      cfg = x[0]; var me = x[1]; S.busy = false;
      if (me.status === 'submitted') { S.submittedAt = me.submittedAt; clearAll(); S.step = 10; return render(); }
      if (me.calcAt && me.list && me.list.length && S.home && S.calc.road === S.home.road) { S.calc.list = me.list; S.calc.at = me.calcAt; S.calc.state = 'done'; }
      go(S.maxStep >= 3 ? Math.min(S.maxStep, 9) : 3);
    }).catch(onErr);
  }
  function doCalc() {
    if (!S.home) return;
    S.busy = true; S.calc.state = 'run'; render();
    api('calc', { body: { road: S.home.road, jibun: S.home.jibun } }).then(function (r) {
      S.busy = false; S.calc = { state: 'done', list: r.list, at: r.calcAt, road: S.home.road };
      if (r.houseKm && cfg) cfg.houseKm = r.houseKm;
      if (r.failed) toast(r.failed + '곳은 경로를 찾지 못했음. 나머지 결과로 진행해도 됨.');
      save(); render();
    }).catch(function (e) { S.calc.state = 'idle'; onErr(e); });
  }
  function doSubmit() {
    S.busy = true; S.confirm = false; render();
    api('submit', { body: {
      home: { road: S.home.road, jibun: S.home.jibun, zip: S.home.zip, detail: S.homeDetail.trim() },
      prevChanged: S.prevChanged, prev: S.prevChanged ? { road: S.prev.road, jibun: S.prev.jibun, detail: S.prevDetail.trim() } : null,
      movePlanned: S.movePlanned, move: S.movePlanned ? { month: S.moveMonth, area: S.moveArea, base: S.moveBase } : null,
      wish: S.wish, reasonCode: S.wish === 'Y' ? S.reasonCode : '', reasonText: S.wish === 'Y' ? S.reasonText.trim() : '',
      ranks: S.wish === 'Y' ? S.ranks : []
    } }).then(function (r) {
      S.busy = false; S.submittedAt = r.submittedAt; S.contact = r.contact || S.contact; clearAll();
      var keep = { submittedAt: S.submittedAt, contact: S.contact }; S = Object.assign(fresh(), keep, { step: 10 }); render();
    }).catch(onErr);
  }

  /* ---------- 카카오 우편번호 (주소 검색) ---------- */
  var pcLoading = null;
  function loadPostcode() {
    if (window.daum && window.daum.Postcode) return Promise.resolve();
    if (!pcLoading) pcLoading = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = POSTCODE_SRC; s.onload = ok; s.onerror = function () { pcLoading = null; no(new Error('주소 검색을 불러오지 못했음. 인터넷 연결을 확인해 주세요.')); }; document.head.appendChild(s); });
    return pcLoading;
  }
  function openPostcode(kind) {
    S.sheet = kind; render();
    loadPostcode().then(function () {
      var el = document.getElementById('pc'); if (!el) return;
      new window.daum.Postcode({
        width: '100%', height: '100%',
        oncomplete: function (d) {
          if (kind === 'move') {
            S.moveArea = [d.sido, d.sigungu, d.bname1 || d.bname].filter(Boolean).join(' ');
          } else {
            var a = { road: d.roadAddress || d.autoRoadAddress || d.address, jibun: d.jibunAddress || d.autoJibunAddress || '', zip: d.zonecode || '' };
            if (kind === 'home') { if (!S.home || S.home.road !== a.road) S.calc = { state: 'idle', list: [], at: null, road: '' }; S.home = a; }
            else S.prev = a;
          }
          S.sheet = null; save(); render();
        }
      }).embed(el, { autoClose: false });
    }).catch(function (e) { S.sheet = null; onErr(e); });
  }

  /* ---------- 화면 ---------- */
  function sw(on, label, act, light) { return '<button class="tg' + (on ? ' on' : '') + (light ? ' light' : '') + '" type="button" data-act="' + act + '" aria-pressed="' + on + '"><span>' + label + '</span><span class="sw"><i></i></span></button>'; }
  function search(label, act) { return '<button class="srch" type="button" data-act="' + act + '">' + ICON_SEARCH + esc(label) + '</button>'; }

  function head() {
    var s = S.step, h = '<div class="hd"><div class="hrow">';
    var canBack = (s >= 1 && s <= 2) || (s >= 4 && s <= 9);
    h += canBack ? '<button class="back" type="button" data-act="back" aria-label="이전 단계">' + ICON_BACK + '</button>' : '<span class="brand">' + esc((cfg && cfg.title) || '거주지 · 발령 희망 조사') + '</span>';
    if (s >= 3 && s <= 9) h += '<span class="cnt">' + (s - 2) + ' / 7</span>';
    h += '</div>';
    if (s >= 3 && s <= 9) {
      h += '<div class="segs" role="group" aria-label="단계">';
      for (var i = 3; i <= 9; i++) {
        var skip = i === 8 && S.wish === 'N';
        var dis = i > S.maxStep || i === s || skip || S.busy;
        h += '<button class="sg' + (i === s ? ' cur' : i < s || i <= S.maxStep ? ' done' : '') + '" type="button" data-go="' + i + '"' + (dis ? ' disabled' : '') + ' title="' + TITLES[i] + '" aria-label="' + (i - 2) + '. ' + TITLES[i] + '"></button>';
      }
      h += '</div><div class="stitle">' + TITLES[s] + '</div>';
    }
    return h + '</div>';
  }

  var V = [];
  V[0] = function () {
    return '<h1 class="t">본인 확인</h1><p class="sub">인사 명단에 등록된 성명과 생년월일로 확인함.</p>' +
      '<div class="fld"><label class="lbl" for="nm">성명</label><input id="nm" class="inp" data-f="name" type="text" autocomplete="name" placeholder="홍길동" value="' + esc(S.name) + '"></div>' +
      '<div class="fld"><label class="lbl" for="bd">생년월일 6자리</label><input id="bd" class="inp" data-f="birth" type="text" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="900101" value="' + esc(S.birth) + '"><div class="hint">예: 1990년 1월 1일생 → 900101</div></div>' +
      (S.needPw ? '<div class="fld step"><label class="lbl" for="lpw">비밀번호</label><input id="lpw" class="inp" data-f="loginPw" type="password" autocomplete="current-password" placeholder="설정한 비밀번호" value=""></div>' : '') +
      '<div class="hint" style="margin-top:14px">처음이면 개인정보 동의와 비밀번호 설정으로 이어짐. 비밀번호를 잊었거나 5회 틀려 잠기면 ' + esc(S.contact) + '에게 연락해 주세요.</div>';
  };
  V[1] = function () {
    var A = [['collect', '개인정보 수집 · 이용'], ['overseas', '국외 서버 저장(Neon)'], ['entrust', '처리 위탁(카카오 · 네이버)']];
    var all = S.agree.collect && S.agree.overseas && S.agree.entrust;
    var h = '<h1 class="t">개인정보 수집 · 이용 동의</h1><p class="sub">정기 인사발령과 사택 배정 검토에만 사용함.</p>' +
      '<div class="terms">' + esc(cfg ? cfg.consentText : '') + '</div><div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">' +
      '<button class="agree all' + (all ? ' on' : '') + '" type="button" data-act="agreeAll" aria-pressed="' + all + '"><span class="ck">' + ICON_CHECK + '</span>전체 동의</button>';
    A.forEach(function (a) { var on = S.agree[a[0]]; h += '<button class="agree' + (on ? ' on' : '') + '" type="button" data-act="agree" data-k="' + a[0] + '" aria-pressed="' + on + '"><span class="ck">' + ICON_CHECK + '</span><span><span class="req">[필수]</span>' + a[1] + '</span></button>'; });
    return h + '</div>';
  };
  V[2] = function () {
    return '<h1 class="t">비밀번호 만들기</h1><p class="sub">다음에 들어올 때 성명 · 생년월일과 함께 입력함.</p>' +
      '<div class="fld"><label class="lbl" for="p1">비밀번호</label><input id="p1" class="inp" data-f="pw1" type="password" autocomplete="new-password" placeholder="6자리 이상" value="' + esc(S.pw1) + '"></div>' +
      '<div class="fld"><label class="lbl" for="p2">비밀번호 확인</label><input id="p2" class="inp" data-f="pw2" type="password" autocomplete="new-password" placeholder="한 번 더" value="' + esc(S.pw2) + '"></div>' +
      '<div id="rules" style="display:flex;flex-direction:column;gap:6px">' + rules() + '</div>';
  };
  function rules() {
    return [[S.pw1.length >= 6, '6자리 이상'], [S.pw1.length > 0 && S.pw1 === S.pw2, '두 번 입력한 비밀번호가 같음']].map(function (r) { return '<div class="rule' + (r[0] ? ' ok' : '') + '">' + (r[0] ? '✓' : '·') + ' ' + r[1] + '</div>'; }).join('');
  }
  V[3] = function () {
    var h = '<h1 class="t">지금 사는 곳을<br>알려주세요</h1><p class="sub">거리 계산과 사택 대상 판단에 쓰임.</p>';
    if (!S.home) return h + search('도로명, 건물명, 지번으로 검색', 'pcHome');
    return h + '<div class="picked"><span class="r">' + esc(S.home.road) + '</span><span class="j">[지번] ' + esc(S.home.jibun) + (S.home.zip ? ' · 우편번호 ' + esc(S.home.zip) : '') + '</span><button class="chg" type="button" data-act="pcHome">주소 다시 찾기</button></div>' +
      '<div class="fld" style="margin-top:16px"><label class="lbl" for="dt">상세주소</label><input id="dt" class="inp" data-f="homeDetail" type="text" placeholder="동 · 호수 (예: 101동 1203호)" value="' + esc(S.homeDetail) + '"></div>';
  };
  V[4] = function () {
    var h = '<h1 class="t">2025년 주소와<br>달라졌나요?</h1><p class="sub">작년 조사 이후 이사했다면 이전 주소를 알려주세요.</p>' + sw(S.prevChanged, '2025년 주소와 달라졌어요', 'togglePrev');
    if (!S.prevChanged) return h + '<div class="hint" style="margin-top:12px">달라진 게 없으면 그대로 다음으로 넘어가면 됨.</div>';
    h += '<div class="open"><span class="lbl" style="margin:0">이전(2025년) 주소</span>';
    if (!S.prev) h += search('이전 주소 검색', 'pcPrev');
    else h += '<div class="picked"><span class="r">' + esc(S.prev.road) + '</span><span class="j">[지번] ' + esc(S.prev.jibun) + '</span><button class="chg" type="button" data-act="pcPrev">다시 찾기</button></div>' +
      '<input class="inp" data-f="prevDetail" type="text" aria-label="이전 주소 상세" placeholder="상세주소 (동 · 호수)" value="' + esc(S.prevDetail) + '">';
    return h + '</div>';
  };
  V[5] = function () {
    var h = '<h1 class="t">이사 계획이 있나요?</h1><p class="sub">아직 상세주소가 없어도 괜찮음. 동까지만 알려주세요.</p>' + sw(S.movePlanned, '이사 예정이 있어요', 'toggleMove');
    if (!S.movePlanned) return h;
    h += '<div class="open"><div><label class="lbl" for="mm">이사 예정월</label><select id="mm" class="sel" data-f="moveMonth"><option value="">선택</option>' +
      months().map(function (m) { return '<option value="' + m.v + '"' + (m.v === S.moveMonth ? ' selected' : '') + '>' + m.t + '</option>'; }).join('') + '</select></div>' +
      '<div><span class="lbl">이사 예정지 (동까지)</span>' +
      (S.moveArea ? '<div class="picked"><span class="r">' + esc(S.moveArea) + '</span><span class="j">상세주소는 저장하지 않고 동까지만 저장함</span><button class="chg" type="button" data-act="pcMove">다시 찾기</button></div>' : search('아무 주소나 검색하면 동까지만 저장됨', 'pcMove')) + '</div>' +
      sw(S.moveBase, '이사 예정지를 <b>발령 기준지</b>로 삼아 주세요', 'toggleBase', true);
    if (S.moveBase) h += '<div class="note"><span>거리 산출은 <b>현 거주지 기준</b>으로 함. 이사 예정지는 발령 때 참고됨.</span></div>';
    return h + '</div>';
  };
  V[6] = function () {
    var h = '<h1 class="t">전국 센터까지<br>거리를 계산해요</h1><p class="sub">현 거주지 기준 · 네이버 길찾기 최적 경로</p>', c = S.calc;
    var fresh6 = c.state === 'done' && S.home && c.road === S.home.road;
    if (c.state === 'run') return h + '<div class="calcbox"><div class="spin" aria-hidden="true"></div><b style="font-size:17px">센터까지 길을 찾고 있어요</b><span style="font-size:13.5px;color:#4B5563;line-height:1.6">' + ((cfg && cfg.orgs && cfg.orgs.length) || '') + '곳 · 주소가 같은 센터는 한 번만 계산함<br>10~20초 정도 걸림</span></div>';
    if (!fresh6) {
      h += '<div class="card" style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12.5px;color:#4B5563">출발지</span><b style="font-size:15.5px">' + esc(S.home ? S.home.road : '') + '</b><span style="font-size:13px;color:#4B5563">' + esc(S.homeDetail) + '</span></div>';
      if (S.movePlanned && S.moveBase) h += '<div class="note" style="margin-top:12px"><span>이사 예정지를 발령 기준지로 선택했음. 거리는 <b>현 거주지 기준</b>으로 계산하고, 이사 예정지(' + esc(S.moveArea) + ')는 발령 때 참고됨.</span></div>';
      return h;
    }
    var L = c.list || [], K = houseKm(), ok = L.filter(function (x) { return x.km != null; });
    var inN = ok.filter(function (x) { return x.km < K; }).length, outN = ok.length - inN, near = ok[0];
    h += '<div class="sum"><div><span>가장 가까운 곳</span><b style="font-size:14px">' + esc(near ? near.name : '-') + '</b><span>' + (near ? near.km.toFixed(1) + 'km' : '') + '</span></div><div><span>' + K + 'km 미만</span><b>' + inN + '곳</b></div><div><span>사택 대상</span><b style="color:#92400E">' + outN + '곳</b></div></div>';
    h += '<div class="chips">' + [['all', '전체 ' + L.length], ['in', K + 'km 미만 ' + inN], ['out', '사택 대상 ' + outN]].map(function (x) { return '<button class="chip' + (S.filter === x[0] ? ' on' : '') + '" type="button" data-act="filter" data-k="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var rows = L.filter(function (x) { return S.filter === 'all' || (x.km != null && (S.filter === 'in' ? x.km < K : x.km >= K)); });
    h += '<div class="card" style="padding:4px 12px">' + rows.map(function (x) {
      var no = L.indexOf(x) + 1;
      return '<div class="row"><span class="n">' + no + '</span><div><span class="nm">' + esc(x.name) + '</span>' + (x.km != null && x.km >= K ? '<span class="house">사택 대상</span>' : '') + '<div class="dp">' + esc(x.dept) + '</div></div>' +
        '<div class="km">' + (x.km == null ? '<span style="margin:0">산출 실패</span>' : '<b>' + x.km.toFixed(1) + '</b>km<span>약 ' + x.min + '분</span>') + '</div></div>';
    }).join('') + '</div><div class="hint" style="margin-top:10px">산출 ' + fmtTime(c.at) + ' · ' + K + 'km 이상이면 사택 대상</div>';
    return h;
  };
  V[7] = function () {
    var h = '<h1 class="t">이번 발령에서<br>이동을 희망하나요?</h1><p class="sub">희망하면 사유를 알려주세요. 발령 검토에 참고함.</p>' +
      '<div class="seg2"><button class="' + (S.wish === 'Y' ? 'on' : '') + '" type="button" data-act="wish" data-k="Y">희망해요</button><button class="' + (S.wish === 'N' ? 'on' : '') + '" type="button" data-act="wish" data-k="N">희망 안 해요</button></div>';
    if (S.wish !== 'Y') return h;
    return h + '<div class="open"><div><label class="lbl" for="rc">사유 구분</label><select id="rc" class="sel" data-f="reasonCode"><option value="">선택해 주세요</option>' +
      ((cfg && cfg.reasons) || []).map(function (r) { return '<option' + (r === S.reasonCode ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="lbl" for="rt">자세한 사유</label><textarea id="rt" class="ta" data-f="reasonText" maxlength="300" placeholder="상황을 간단히 적어 주세요 (5자 이상)">' + esc(S.reasonText) + '</textarea><div class="hint" style="text-align:right"><span id="rlen">' + S.reasonText.length + '</span> / 300자</div></div></div>';
  };
  V[8] = function () {
    var h = '<h1 class="t">희망 센터를<br>순서대로 골라 주세요</h1><p class="sub">1순위는 꼭 골라 주세요. 2·3순위는 없으면 비워도 됨.</p>';
    S.ranks.forEach(function (code, i) {
      var o = orgByCode(code);
      h += '<button class="rk' + (o ? ' set' : '') + '" type="button" data-act="rank" data-k="' + i + '"><span class="no">' + (i + 1) + '</span><span>' +
        (o ? '<b style="font-size:15px">' + esc(o.name) + '</b><br><span style="font-size:12.5px;color:#4B5563">' + esc(o.dept) + (o.km != null ? ' · ' + o.km.toFixed(1) + 'km' : '') + '</span>' : '<span class="em">' + (i === 0 ? '1순위 센터 고르기 (필수)' : (i + 1) + '순위 센터 고르기 (선택)') + '</span>') +
        '</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA3B2" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
        (o && i > 0 ? '<button class="clr" type="button" data-act="rankClear" data-k="' + i + '">' + (i + 1) + '순위 비우기</button>' : '');
    });
    return h;
  };
  V[9] = function () {
    var near = (S.calc.list || []).filter(function (x) { return x.km != null; })[0], K = houseKm();
    var out = (S.calc.list || []).filter(function (x) { return x.km != null && x.km >= K; }).length;
    var rk = S.ranks.map(function (c, i) { var o = orgByCode(c); return o ? (i + 1) + '. ' + o.name : ''; }).filter(Boolean).join('  ');
    return '<h1 class="t">마지막으로 확인해 주세요</h1><p class="sub">제출하면 수정할 수 없음.</p>' +
      '<div class="sec"><h3>거주지<button type="button" data-go="3">수정</button></h3><div class="kv"><span>현 거주지</span><span><b>' + esc(S.home.road) + ' ' + esc(S.homeDetail) + '</b></span>' +
      '<span>2025년 대비</span><span>' + (S.prevChanged ? '달라짐 · 이전 ' + esc(S.prev.road) + ' ' + esc(S.prevDetail) : '변경 없음') + '</span>' +
      '<span>이사 예정</span><span>' + (S.movePlanned ? esc(monthLabel(S.moveMonth)) + ' · ' + esc(S.moveArea) + (S.moveBase ? ' · 발령 기준지' : '') : '없음') + '</span></div></div>' +
      '<div class="sec"><h3>거리 산출</h3><div class="kv"><span>가장 가까운 곳</span><span>' + esc(near ? near.name + ' ' + near.km.toFixed(1) + 'km' : '-') + '</span><span>사택 대상</span><span>' + out + '곳 (' + K + 'km 이상)</span></div></div>' +
      '<div class="sec"><h3>발령 희망<button type="button" data-go="7">수정</button></h3><div class="kv"><span>희망</span><span>' + (S.wish === 'Y' ? '희망함' : '희망 안 함') + '</span>' +
      (S.wish === 'Y' ? '<span>사유</span><span>' + esc(S.reasonCode) + ' · ' + esc(S.reasonText) + '</span><span>희망 센터</span><span>' + esc(rk) + '</span>' : '') + '</div></div>';
  };
  V[10] = function () {
    return '<div class="done"><svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="44" fill="#2B55D9"/><path d="M27 45l12 12 23-25" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<h1 class="t" style="margin-top:10px">제출했어요</h1><p class="sub" style="margin:0">' + (S.submittedAt ? fmtTime(S.submittedAt) + ' 제출 · ' : '') + '응답해 주셔서 감사해요.</p>' +
      '<div class="contact"><b style="font-size:14.5px">수정이 필요하면</b><span style="font-size:13.5px;color:#4B5563;line-height:1.6">제출한 내용은 직접 고칠 수 없음.<br><b style="color:#111827">' + esc(S.contact) + '</b>에게 연락해 주세요.</span></div></div>';
  };

  function ctaText() {
    var s = S.step;
    if (S.busy) return s === 6 ? '계산 중…' : '처리 중…';
    if (s === 0) return S.needPw ? '들어가기' : '확인';
    if (s === 1) return '동의하고 계속';
    if (s === 6 && !valid(6)) return '거리 산출하기';
    if (s === 9) return '최종 제출';
    return '다음';
  }
  function ctaOn() { return !S.busy && (valid(S.step) || (S.step === 6 && !!S.home)); }

  function sheet() {
    if (!S.sheet) return '';
    var pc = S.sheet === 'home' || S.sheet === 'prev' || S.sheet === 'move';
    var title = { home: '주소 검색', prev: '이전 주소 검색', move: '이사 예정지 (동까지)', rank: (S.slot + 1) + '순위 센터 선택' }[S.sheet];
    var h = '<div class="ov"><button class="shade" type="button" data-act="closeSheet" aria-label="닫기"></button><div class="sheet' + (pc ? '' : ' short') + '"><div class="grab"></div><div class="shd"><b style="font-size:17px">' + title + '</b><button class="back" type="button" data-act="closeSheet" aria-label="닫기" style="margin:0">' + ICON_X + '</button></div>';
    if (pc) return h + (S.sheet === 'move' ? '<div class="hint" style="margin:0 0 8px">어떤 주소를 골라도 시 · 군 · 구와 동까지만 저장됨</div>' : '') + '<div id="pc" class="pc"></div></div></div>';
    h += '<input class="inp" id="q" data-f="q" type="search" aria-label="센터 검색" placeholder="센터 이름 검색" value="' + esc(S.q) + '" style="margin-bottom:6px"><div id="rlist" style="overflow-y:auto;flex:1">' + rankList() + '</div><div class="hint" style="text-align:center">가까운 순 · 현 거주지 기준 거리</div></div></div>';
    return h;
  }
  function rankList() {
    var q = S.q.trim(), K = houseKm();
    return (S.calc.list || []).filter(function (o) { return !q || o.name.indexOf(q) >= 0 || o.dept.indexOf(q) >= 0; }).map(function (o) {
      var used = S.ranks.indexOf(o.code) >= 0 && S.ranks[S.slot] !== o.code;
      return '<button class="res" type="button" data-act="pickRank" data-k="' + esc(o.code) + '"' + (used ? ' disabled' : '') + '><b>' + esc(o.name) + '</b><span>' + esc(o.dept) + (o.km != null ? ' · ' + o.km.toFixed(1) + 'km · 약 ' + o.min + '분' + (o.km >= K ? ' · 사택 대상' : '') : '') + (used ? ' · 이미 선택함' : '') + '</span></button>';
    }).join('') || '<div class="hint" style="padding:20px 0;text-align:center">검색 결과 없음</div>';
  }
  function modal() {
    if (!S.confirm) return '';
    return '<div class="ov" style="justify-content:center"><div class="modal" role="dialog" aria-modal="true" aria-label="제출 확인"><b style="font-size:18px">제출할까요?</b><p style="font-size:14px;line-height:1.65;color:#4B5563;margin:10px 0 18px">제출 후에는 수정할 수 없음. 수정이 필요하면 <b style="color:#111827">' + esc(S.contact) + '</b>에게 연락해 주세요.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px"><button class="cta ghost" type="button" data-act="closeConfirm" style="height:50px">다시 볼게요</button><button class="cta" type="button" data-act="submit" style="height:50px">제출</button></div></div></div>';
  }

  function render() {
    if (cfg && cfg.open === false && S.step < 10 && S.step > 0) { app.innerHTML = '<div class="bd"><div class="closed"><h1 class="t">지금은 접수 기간이 아님</h1><p class="sub">문의: ' + esc(S.contact) + '</p></div></div>'; return; }
    var s = S.step, ob = app.querySelector('.bd'), keepTop = ob && lastStep === s ? ob.scrollTop : 0;
    app.innerHTML = head() + '<div class="bd"><div class="' + (lastStep === s ? '' : 'step') + '">' + V[s]() + '</div></div>' +
      (s < 10 ? '<div class="ft"><button id="cta" class="cta' + (ctaOn() ? '' : ' off') + '" type="button" data-act="primary"' + (S.busy ? ' disabled' : '') + '>' + ctaText() + '</button></div>' : '') + sheet() + modal();
    var nb = app.querySelector('.bd'); if (nb && keepTop) nb.scrollTop = keepTop;
    lastStep = s;
  }
  function refreshCta() { var b = document.getElementById('cta'); if (b) { b.className = 'cta' + (ctaOn() ? '' : ' off'); b.textContent = ctaText(); } }

  /* ---------- 이벤트 ---------- */
  app.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g && !g.disabled) { var n = Number(g.getAttribute('data-go')); return go(n); }
    var t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    var a = t.getAttribute('data-act'), k = t.getAttribute('data-k');
    switch (a) {
      case 'primary': return primary();
      case 'back': if (S.step <= 2) { S = fresh(); S.name = ''; clearAll(); return render(); } return go(prevOf(S.step));
      case 'agreeAll': var all = !(S.agree.collect && S.agree.overseas && S.agree.entrust); S.agree = { collect: all, overseas: all, entrust: all }; return render();
      case 'agree': S.agree[k] = !S.agree[k]; return render();
      case 'pcHome': return openPostcode('home');
      case 'pcPrev': return openPostcode('prev');
      case 'pcMove': return openPostcode('move');
      case 'togglePrev': S.prevChanged = !S.prevChanged; save(); return render();
      case 'toggleMove': S.movePlanned = !S.movePlanned; if (!S.movePlanned) S.moveBase = false; save(); return render();
      case 'toggleBase': S.moveBase = !S.moveBase; save(); return render();
      case 'filter': S.filter = k; return render();
      case 'wish': S.wish = k; if (k === 'N' && S.maxStep === 8) S.maxStep = 7; save(); return render();
      case 'rank': S.sheet = 'rank'; S.slot = Number(k); S.q = ''; render(); return;
      case 'rankClear': S.ranks[Number(k)] = ''; save(); return render();
      case 'pickRank': S.ranks[S.slot] = k; S.sheet = null; save(); return render();
      case 'closeSheet': S.sheet = null; return render();
      case 'closeConfirm': S.confirm = false; return render();
      case 'submit': return doSubmit();
    }
  });
  app.addEventListener('input', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-f'); if (!f) return;
    var v = e.target.value;
    if (f === 'birth') { v = v.replace(/\D/g, '').slice(0, 6); if (v !== e.target.value) e.target.value = v; }
    if (f === 'reasonText') { v = v.slice(0, 300); var l = document.getElementById('rlen'); if (l) l.textContent = v.length; }
    S[f] = v;
    if (f === 'pw1' || f === 'pw2') { var r = document.getElementById('rules'); if (r) r.innerHTML = rules(); }
    if (f === 'q') { var rl = document.getElementById('rlist'); if (rl) rl.innerHTML = rankList(); return; }
    if (['name', 'birth', 'loginPw', 'pw1', 'pw2'].indexOf(f) < 0) save();
    refreshCta();
  });
  app.addEventListener('change', function (e) { var f = e.target.getAttribute && e.target.getAttribute('data-f'); if (f === 'moveMonth' || f === 'reasonCode') { S[f] = e.target.value; save(); refreshCta(); } });
  app.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && S.step <= 2 && !S.sheet) { e.preventDefault(); primary(); } });

  /* ---------- 시작 ---------- */
  load();
  if (S.step === 10) S = fresh();
  if (!S.token) S.step = 0;
  render();
  api('public').then(function (c) {
    cfg = c; if (c.contact) S.contact = c.contact;
    if (S.token && S.step >= 3) return enterSurvey();
    render();
  }).catch(function () { toast('서버에 연결하지 못했음. 잠시 뒤 다시 열어 주세요.', true); });
})();
