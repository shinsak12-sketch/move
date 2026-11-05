/* 주소 취합 관리자 화면
   개인키는 이 창의 메모리에만 있음(새로고침 · 창 닫기 하면 사라짐). 서버로 보내지 않음. */
(function () {
  'use strict';
  var root = document.getElementById('admin');
  var A = { token: sessionStorage.getItem('addr-admin.token') || '', otpOn: !!sessionStorage.getItem('addr-admin.otp'), otp: null, view: 'dash', key: null, status: null, names: {}, filter: 'pending', q: '', orgs: null, settings: null, roster: null, add: { hq: '', dept: '', center: '', name: '', birth: '' }, addList: [], busy: false, pub: '' };
  var NAV = [['dash', '진행 현황'], ['roster', '명단'], ['orgs', '조직 주소'], ['export', '내려받기'], ['settings', '설정'], ['key', '키 관리'], ['wipe', '전체 파기']];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, err) { var d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = m; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4200); }
  function api(path, body, method) {
    return fetch('/api/' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A.token }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path.indexOf('admin/login') < 0) { A.token = ''; sessionStorage.removeItem('addr-admin.token'); render(); }
        if (!r.ok) { var e = new Error(j.error || '요청 실패'); e.data = j; throw e; } return j; }); });
  }
  function fail(e) { A.busy = false; var d = e && e.data; var more = d && (d.badRows || d.dupRows) ? ' (행: ' + [].concat(d.badRows || [], d.dupRows || []).slice(0, 20).join(', ') + ')' : ''; toast(((e && e.message) || '오류') + more, true); render(); }
  function fmt(iso) { if (!iso) return ''; var d = new Date(iso), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  /* ---------- 암호 ---------- */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function toB64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function pem(buf, label) { return '-----BEGIN ' + label + '-----\n' + toB64(buf).match(/.{1,64}/g).join('\n') + '\n-----END ' + label + '-----'; }
  function passKey(pass, salt) {
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function openBox(json) {
    var o = JSON.parse(json);
    return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, A.key, b64(o.k)).then(function (raw) {
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    }).then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(o.iv) }, k, b64(o.ct)); })
      .then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }
  function genKey(pass) {
    var kp, priv, salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])
      .then(function (k) { kp = k; return crypto.subtle.exportKey('pkcs8', k.privateKey); })
      .then(function (p) { priv = p; return passKey(pass, salt); })
      .then(function (pk) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, pk, priv); })
      .then(function (ct) {
        var file = JSON.stringify({ kind: 'address-survey-private-key', v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), created: new Date().toISOString() });
        download(new Blob([file], { type: 'application/json' }), '주소취합_개인키_' + new Date().toISOString().slice(0, 10) + '.json');
        return crypto.subtle.exportKey('spki', kp.publicKey);
      }).then(function (spki) { A.pub = pem(spki, 'PUBLIC KEY'); });
  }
  function loadKey(file, pass) {
    return file.text().then(function (t) {
      var o = JSON.parse(t); if (o.kind !== 'address-survey-private-key') throw new Error('개인키 파일이 아님');
      return passKey(pass, b64(o.salt)).then(function (pk) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(o.iv) }, pk, b64(o.ct)); })
        .catch(function () { throw new Error('키 비밀번호가 맞지 않음'); });
    }).then(function (p8) { return crypto.subtle.importKey('pkcs8', p8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']); })
      .then(function (k) { A.key = k; A.names = {}; return decodeNames(); });
  }
  function decodeNames() {
    if (!A.key || !A.status) return Promise.resolve();
    var todo = A.status.rows.filter(function (r) { return !A.names[r.id]; });
    return Promise.all(todo.map(function (r) { return openBox(r.enc_identity).then(function (x) { A.names[r.id] = x; }).catch(function () { A.names[r.id] = { name: '(해독 실패)', birth: '' }; }); }));
  }
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

  /* ---------- 엑셀 읽기 ---------- */
  function readSheet(file) {
    var isCsv = /\.csv$/i.test(file.name);
    var read = isCsv ? file.text().then(function (t) { return XLSX.read(t.replace(/^﻿/, ''), { type: 'string', raw: true }); })
                     : file.arrayBuffer().then(function (buf) { return XLSX.read(buf, { type: 'array', cellDates: false }); });
    return read.then(function (wb) { return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true }); });
  }
  function pick(row, names) { var ks = Object.keys(row); for (var i = 0; i < names.length; i++) for (var j = 0; j < ks.length; j++) if (ks[j].replace(/\s/g, '') === names[i]) return row[ks[j]]; return ''; }
  function birth6(v) {
    if (typeof v === 'number' && v > 10000 && v < 80000) { var d = XLSX.SSF.parse_date_code(v); return String(d.y).slice(2) + ('0' + d.m).slice(-2) + ('0' + d.d).slice(-2); }
    var s = String(v).replace(/\D/g, '');
    if (s.length === 8) return s.slice(2);
    if (s.length === 5) return '0' + s;
    return s;
  }

  /* ---------- 데이터 ---------- */
  function loadStatus() { return api('admin/status').then(function (s) { A.status = s; return decodeNames(); }).then(render).catch(fail); }
  function stOf(r) { return r.status === 'submitted' ? 'done' : r.locked ? 'lock' : (r.status || r.has_pw) ? 'ing' : 'no'; }
  var ST = { done: ['제출', 'p-done'], ing: ['작성 중', 'p-ing'], no: ['미접속', 'p-no'], lock: ['잠김', 'p-lock'] };

  /* ---------- 화면 ---------- */
  function vLogin() {
    return '<form class="login" id="lf"><b style="font-size:18px">주소 취합 관리</b><label class="muted" for="aid">아이디</label><input id="aid" class="inp" autocomplete="username"><label class="muted" for="apw">비밀번호</label><input id="apw" class="inp" type="password" autocomplete="current-password"><label class="muted" for="aotp">Google OTP 6자리</label><input id="aotp" class="inp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="OTP 등록 전이면 비워 둠"><button class="btn pri" type="submit">로그인</button></form>';
  }
  function keyBox() {
    if (A.key) return '';
    return '<div class="lock"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4B5563" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      '<div style="flex:1;min-width:220px" class="muted">서버에는 이름 · 주소가 암호문으로만 있음.<br>개인키 파일을 불러오면 <b style="color:#111827">이 창에서만</b> 이름이 보임.</div>' +
      '<label class="btn pri" style="display:inline-flex;align-items:center">개인키 불러오기<input type="file" id="kf" accept=".json,application/json" style="display:none"></label></div>';
  }
  function vDash() {
    var s = A.status; if (!s) return '<h1>진행 현황</h1><div class="card muted">불러오는 중…</div>';
    var rows = s.rows, n = rows.length, c = { done: 0, ing: 0, no: 0, lock: 0 };
    rows.forEach(function (r) { c[stOf(r)]++; });
    var by = {}; rows.forEach(function (r) { var d = (r.hq ? r.hq + ' › ' : '') + (r.dept || '(부서 없음)'); by[d] = by[d] || { n: 0, done: 0, ing: 0 }; by[d].n++; var x = stOf(r); if (x === 'done') by[d].done++; else if (x === 'ing') by[d].ing++; });
    var h = '<div class="row" style="justify-content:space-between"><h1>진행 현황</h1><span class="row"><span class="muted">' + fmt(s.at) + ' 기준</span><button class="btn sm" type="button" data-act="reload">새로고침</button></span></div>' +
      '<div class="kpis"><div class="card kpi"><span>명단</span><b>' + n + '</b></div><div class="card kpi"><span>제출</span><b style="color:#2B55D9">' + c.done + '</b></div><div class="card kpi"><span>작성 중</span><b>' + c.ing + '</b></div><div class="card kpi"><span>미접속 · 잠김</span><b>' + (c.no + c.lock) + '</b></div><div class="card kpi"><span>제출률</span><b>' + (n ? (c.done / n * 100).toFixed(1) : '0') + '%</b></div></div>';
    h += '<div class="row" style="align-items:flex-start;gap:16px"><div class="card" style="flex:1 1 420px;min-width:0"><div class="row" style="justify-content:space-between;margin-bottom:8px"><b style="font-size:15px">부서별</b><span><span class="lg"><i class="s1"></i>제출</span><span class="lg"><i class="s2"></i>작성 중</span></span></div>' +
      Object.keys(by).sort().map(function (d) { var x = by[d]; return '<div class="dbar"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(d) + '">' + esc(d) + '</b><div class="stack"><i class="s1" style="width:' + (x.done / x.n * 100) + '%"></i><i class="s2" style="width:' + (x.ing / x.n * 100) + '%"></i></div><span class="muted" style="text-align:right">' + x.done + ' / ' + x.n + ' · ' + Math.round(x.done / x.n * 100) + '%</span></div>'; }).join('') + '</div>';
    h += '<div class="card" style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:12px"><div class="row" style="justify-content:space-between"><b style="font-size:15px">대상자</b>' +
      (A.key ? '<span class="row"><input class="inp" id="nq" placeholder="이름 검색" value="' + esc(A.q) + '" style="height:32px;width:140px"><button class="btn sm" type="button" data-act="copy">미제출 명단 복사</button></span>' : '') + '</div>' + keyBox();
    if (A.key) {
      h += '<div class="seg">' + [['pending', '미제출'], ['done', '제출'], ['lock', '잠김'], ['all', '전체']].map(function (f) { return '<button type="button" class="' + (A.filter === f[0] ? 'on' : '') + '" data-act="filter" data-k="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>';
      var list = rows.filter(function (r) { var x = stOf(r); return A.filter === 'all' || (A.filter === 'pending' ? x !== 'done' : x === A.filter); })
        .filter(function (r) { return !A.q || ((A.names[r.id] || {}).name || '').indexOf(A.q) >= 0; });
      h += '<div class="tbox"><table class="t"><thead><tr><th>이름</th><th>생년월일</th><th>본부</th><th>부서</th><th>센터</th><th>상태</th><th>산출</th><th>최근 접속</th><th></th></tr></thead><tbody>' +
        list.slice(0, 500).map(function (r) {
          var p = A.names[r.id] || {}, x = stOf(r);
          var acts = (r.locked ? '<button class="btn sm" data-act="acc" data-k="unlock" data-id="' + r.id + '">잠금 해제</button> ' : '') +
            (r.has_pw ? '<button class="btn sm" data-act="acc" data-k="reset" data-id="' + r.id + '">비번 초기화</button> ' : '') +
            (r.status === 'submitted' ? '<button class="btn sm" data-act="acc" data-k="reopen" data-id="' + r.id + '">재작성 허용</button>' : '') +
            (r.status !== 'submitted' && r.calc_count >= 2 ? '<button class="btn sm" data-act="acc" data-k="calcReset" data-id="' + r.id + '">산출 횟수 초기화</button> ' : '') +
            '<button class="btn sm" data-act="acc" data-k="delete" data-id="' + r.id + '" style="color:#DC2626">삭제</button>';
          return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.birth) + '</td><td>' + esc(r.hq) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.center) + '</td><td><span class="pill ' + ST[x][1] + '">' + ST[x][0] + '</span></td><td class="muted">' + (r.calc_count ? r.calc_count + '/2' : '') + '</td><td class="muted">' + fmt(r.submitted_at || r.last_login) + '</td><td style="text-align:right">' + acts + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="muted">' + list.length + '명' + (list.length > 500 ? ' (앞 500명만 표시 · 검색으로 좁히기)' : '') + '</div>';
    }
    return h + '</div></div>';
  }
  function vRoster() {
    var p = A.roster;
    var h = '<div class="row" style="justify-content:space-between"><h1>명단</h1><button class="btn" type="button" data-act="template">양식 내려받기</button></div><div class="card" style="display:flex;flex-direction:column;gap:14px"><label class="drop"><b style="color:#111827">엑셀 파일 선택 (.xlsx · .csv)</b><br>첫 시트 · 머리글: <b>본부 · 부서 · 센터 · 이름 · 생년월일</b><br>생년월일은 6자리 · 8자리 · 날짜 모두 됨 → 6자리로 바꿔 저장<input type="file" id="rf" accept=".xlsx,.xls,.csv"></label>';
    if (p) {
      var hqN = {}; p.rows.forEach(function (r) { hqN[r.hq || '(본부 없음)'] = (hqN[r.hq || '(본부 없음)'] || 0) + 1; });
      h += '<div class="row" style="gap:22px"><span>파일 <b>' + esc(p.file) + '</b></span><span>읽은 행 <b>' + p.rows.length + '</b></span><span class="muted">' + Object.keys(hqN).map(function (k) { return esc(k) + ' ' + hqN[k]; }).join(' · ') + '</span>' + (p.bad.length ? '<span class="bad">형식 오류 ' + p.bad.length + '행 (' + p.bad.slice(0, 15).join(', ') + ')</span>' : '<span class="ok">✓ 형식 오류 0</span>') + (p.dup.length ? '<span class="bad">중복 ' + p.dup.length + '행 (' + p.dup.slice(0, 15).join(', ') + ')</span>' : '<span class="ok">✓ 중복 0</span>') + '</div>' +
        '<label class="cb"><input type="checkbox" id="rm"> 이 파일에 없는 사람은 서버 명단에서 지움 (응답도 함께 지워짐)</label>' +
        '<div><button class="btn pri" type="button" data-act="uploadRoster"' + (p.bad.length || p.dup.length || A.busy ? ' disabled' : '') + '>' + (A.busy ? '올리는 중…' : '서버에 올리기') + '</button></div>';
    }
    h += '</div>' + addCard();
    return h + '<div class="muted">서버에는 성명 · 생년월일이 해시(로그인 확인용)와 암호문(관리자 열람용)으로만 저장됨. <b>먼저 [키 관리]에서 키를 만들고, 공개키를 Vercel 환경변수 ENC_PUBLIC_KEY 에 넣고 다시 배포한 뒤</b> 올려야 함.</div></div>';
  }
  function opt(list, cur, first) { return '<option value="">' + first + '</option>' + list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); }
  function uniq(a) { var o = {}; return a.filter(function (v) { if (!v || o[v]) return false; o[v] = 1; return true; }); }
  function addCard() {
    var f = A.add, ol = (A.orgs && A.orgs.list) || [], rl = (A.status && A.status.rows) || [];
    var hqs = uniq(rl.map(function (r) { return r.hq; })).sort();
    var depts = uniq(ol.filter(function (o) { return o.kind === '부서'; }).map(function (o) { return o.dept; }).concat(rl.map(function (r) { return r.dept; })));
    var cens = uniq(ol.filter(function (o) { return o.kind === '센터' && (!f.dept || o.dept === f.dept); }).map(function (o) { return o.name; }).concat(rl.filter(function (r) { return !f.dept || r.dept === f.dept; }).map(function (r) { return r.center; })));
    var ss = 'class="inp" style="flex:1 1 150px;min-width:0"';
    var h = '<div class="card" style="display:flex;flex-direction:column;gap:12px;margin-top:16px"><b style="font-size:15px">사람 추가</b><div class="muted">지금 서버 명단은 그대로 두고 담은 사람만 더함 · 같은 이름 + 생년월일이 이미 있으면 본부 · 부서 · 센터만 바뀜</div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      '<select ' + ss + ' data-add="hq">' + opt(hqs, f.hq, '본부 선택') + '</select>' +
      '<select ' + ss + ' data-add="dept">' + opt(depts, f.dept, '부서 선택') + '</select>' +
      '<select ' + ss + ' data-add="center">' + opt(cens, f.center, '센터 선택') + '</select></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><input ' + ss + ' id="an" placeholder="이름" value="' + esc(f.name) + '"><input ' + ss + ' id="ab" placeholder="생년월일 6자리 (900101)" inputmode="numeric" maxlength="8" value="' + esc(f.birth) + '"><button class="btn" type="button" data-act="addPut" style="flex:0 0 auto">담기</button></div>';
    if (A.addList.length) {
      h += '<div class="tbox"><table class="t"><thead><tr><th>이름</th><th>생년월일</th><th>본부</th><th>부서</th><th>센터</th><th></th></tr></thead><tbody>' + A.addList.map(function (r, i) {
        return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + r.birth + '</td><td>' + esc(r.hq) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.center) + '</td><td style="text-align:right"><button class="btn sm" type="button" data-act="addDel" data-k="' + i + '">빼기</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    return h + '<div><button class="btn pri" type="button" data-act="addPeople"' + (!A.addList.length || A.busy ? ' disabled' : '') + '>' + (A.busy ? '추가 중…' : '명단에 추가 (' + A.addList.length + '명)') + '</button></div></div>';
  }
  function vOrgs() {
    var o = A.orgs;
    var h = '<div class="row" style="justify-content:space-between"><h1>조직 주소</h1><span class="row"><button class="btn" type="button" data-act="orgTemplate">양식 내려받기</button><label class="btn pri" style="display:inline-flex;align-items:center">' + (A.busy ? '좌표 변환 중…' : '엑셀 업로드') + '<input type="file" id="of" accept=".xlsx,.xls,.csv" style="display:none"></label></span></div>' +
      '<div class="muted">머리글: <b>조직코드</b>, <b>구분</b>(부서/센터), <b>권역</b>(수도권/지방), <b>부서</b>, <b>센터명</b>, <b>주소</b> · 올리면 기존 조직 목록을 통째로 바꿈 · 주소는 층 · 호수 · 건물명을 떼고 <b>도로명 + 건물번호</b>까지만 써서, 같은 건물(층만 다른 경우 포함)은 한 위치로 묶어 거리를 한 번만 계산함</div>';
    if (!o) return h + '<div class="card muted">불러오는 중…</div>';
    h += '<div class="card row" style="gap:26px"><span>조직 <b>' + o.list.length + '곳</b></span><span>실제 위치 <b>' + o.sites + '곳</b></span>' + (o.failed.length ? '<span class="bad">좌표 실패 ' + o.failed.length + '곳: ' + esc(o.failed.join(', ')) + ' — 주소를 고쳐 다시 올릴 것</span>' : '<span class="ok">✓ 좌표 변환 완료</span>') + '</div>';
    return h + '<div class="card" style="padding:0"><div class="tbox" style="border:0"><table class="t"><thead><tr><th>조직코드</th><th>구분</th><th>권역</th><th>부서</th><th>이름</th><th>원본 주소</th><th>계산 위치</th><th>같은 위치</th><th>좌표</th></tr></thead><tbody>' +
      o.list.map(function (x) { return '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.kind) + '</td><td>' + esc(x.region || '') + '</td><td>' + esc(x.dept) + '</td><td><b>' + esc(x.name) + '</b></td><td class="muted">' + esc(x.addr_raw || '') + '</td><td>' + esc(x.addr) + '</td><td class="muted">' + (x.same_n > 1 ? x.same_n + '곳 공유' : '') + '</td><td>' + (x.geo_ok ? '<span class="ok">✓</span>' : '<span class="bad">실패</span>') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function vExport() {
    return '<h1>내려받기</h1><div class="card" style="display:flex;flex-direction:column;gap:12px"><b style="font-size:15px">보안망 반입용 엑셀</b>' +
      '<div class="muted">시트: 정보 · 조직 · 응답 · 거리(km) · 소요시간(분) · 사택대상 · 미제출<br>복호화와 엑셀 생성은 이 브라우저 안에서만 함. 개인키는 서버로 보내지 않음.</div>' + keyBox() +
      '<div><button class="btn pri" type="button" data-act="export"' + (!A.key || A.busy ? ' disabled' : '') + '>' + (A.busy ? '만드는 중…' : '엑셀 내려받기') + '</button></div></div>';
  }
  function vSettings() {
    var s = A.settings; if (!s) return '<h1>설정</h1><div class="card muted">불러오는 중…</div>';
    return '<h1>설정</h1><div class="card" style="display:flex;flex-direction:column;gap:14px">' +
      '<label class="cb"><input type="checkbox" id="sOpen"' + (s.open ? ' checked' : '') + '> <b>접수 열기</b> <span class="muted">끄면 직원이 새로 입력 · 제출할 수 없음 (제출한 사람은 제출 완료 화면만 봄)</span></label>' +
      '<div class="row"><b style="font-size:14px">사택 기준 거리</b><input class="inp" id="sKm" value="' + esc(s.houseKm) + '" style="width:90px"> km 이상</div>' +
      '<div><b style="font-size:14px">희망 사유 구분값</b> <span class="muted">(한 줄에 하나)</span><textarea class="ta" id="sReasons" style="min-height:150px">' + esc(s.reasons.join('\n')) + '</textarea></div>' +
      '<div><b style="font-size:14px">개인정보 동의서</b> <span class="muted">현재 v' + s.consentVersion + ' · 고치면 버전이 올라가고 직원은 다음 접속 때 다시 동의함</span><textarea class="ta" id="sConsent">' + esc(s.consentText) + '</textarea></div>' +
      '<div><button class="btn pri" type="button" data-act="saveSettings">저장</button></div></div>';
  }
  function otpCard() {
    var o = A.otp, h = '<div class="card" style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px"><b style="font-size:15px">관리자 2차 인증 (Google OTP)</b>';
    if (A.otpOn) return h + '<div class="ok">✓ 켜져 있음 — 로그인할 때마다 OTP 6자리가 필요함</div><div class="muted">휴대폰을 바꾸거나 잃어버리면: Vercel 환경변수 ADMIN_TOTP_SECRET 을 지우고 다시 배포 → 여기서 새로 등록</div></div>';
    if (!o) return h + '<div class="muted">켜면 아이디 · 비밀번호가 새도 휴대폰 없이는 관리자 화면에 못 들어옴</div><div><button class="btn pri" type="button" data-act="otpStart">등록 시작</button></div></div>';
    h += '<div class="muted">① 휴대폰 <b>Google Authenticator</b> 앱 → [+] → QR 코드 스캔 (안 되면 설정 키 직접 입력)</div>' +
      '<div class="row" style="gap:18px;align-items:flex-start;flex-wrap:wrap"><div style="width:180px;height:180px;background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:6px">' + o.svg + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;flex:1 1 260px"><span class="muted">설정 키</span><div class="pem" id="otpsec" style="letter-spacing:1px">' + esc(o.secret.replace(/(.{4})/g, '$1 ').trim()) + '</div>' +
      '<span class="muted">② 앱에 뜬 6자리로 확인</span><div class="row"><input class="inp" id="otpchk" inputmode="numeric" maxlength="6" placeholder="6자리" style="width:120px"><button class="btn" type="button" data-act="otpCheck">확인</button>' + (o.ok ? ' <b class="ok">✓ 맞음</b>' : '') + '</div></div></div>';
    if (o.ok) h += '<div class="muted" style="color:#111827">③ Vercel → 프로젝트 → Settings → Environment Variables 에 <b>ADMIN_TOTP_SECRET</b> = 아래 값 (Sensitive 체크) → <b>Redeploy</b><br>④ 다시 배포된 뒤부터 로그인할 때 OTP 필수. 이 화면을 벗어나면 값이 사라지니 먼저 넣을 것</div><div class="pem">' + esc(o.secret) + '</div><div><button class="btn sm" type="button" data-act="otpCopy">값 복사</button></div>';
    return h + '</div>';
  }
  function vKey() {
    return '<h1>키 관리</h1>' + otpCard() + '<div class="card" style="display:flex;flex-direction:column;gap:12px"><b style="font-size:15px">처음 한 번: 키 만들기</b>' +
      '<div class="muted">① 키 비밀번호를 정하고 [키 만들기] → 개인키 파일이 내려받아짐 (담당자만 보관 · 잃어버리면 자료를 못 엶)<br>② 아래 공개키를 Vercel 환경변수 <b>ENC_PUBLIC_KEY</b> 에 넣고 다시 배포<br>③ 그다음 명단을 올릴 것 (키를 바꾸면 이전 자료는 열 수 없음)</div>' +
      '<div class="row"><input class="inp" id="kp1" type="password" placeholder="키 비밀번호 (8자 이상)" autocomplete="new-password"><input class="inp" id="kp2" type="password" placeholder="한 번 더" autocomplete="new-password"><button class="btn pri" type="button" data-act="genKey">키 만들기</button></div>' +
      (A.pub ? '<b style="font-size:13.5px">공개키 (ENC_PUBLIC_KEY 값)</b><div class="pem" id="pubpem">' + esc(A.pub) + '</div><div><button class="btn sm" type="button" data-act="copyPub">공개키 복사</button></div>' : '') +
      '</div><div class="card" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:15px">개인키 불러오기</b><div class="muted">상태: <b style="color:#111827">' + (A.key ? '불러옴 (이 창을 닫으면 지워짐)' : '안 불러옴') + '</b></div>' + keyBox() + '</div>';
  }
  function vWipe() {
    return '<h1 style="color:#B42318">전체 파기</h1><div class="card danger" style="display:flex;flex-direction:column;gap:12px"><b style="font-size:15px">서버(Neon)의 조사 자료를 모두 지움 · 되돌릴 수 없음</b>' +
      '<div class="muted" style="color:#374151">지워지는 것: 명단 · 계정 · 동의 기록 · 응답(암호문) · 거리 결과 · 접속 기록<br>먼저 [내려받기]로 엑셀을 받아 보안망으로 옮겼는지 확인할 것</div>' +
      '<label class="cb"><input type="checkbox" id="wOrg" checked> 조직 주소는 남겨 둠 (다음 조사 때 재사용)</label><label class="cb"><input type="checkbox" id="wSet" checked> 설정 · 동의서 문구는 남겨 둠</label>' +
      '<div class="row"><label for="wTxt" style="font-size:13.5px">확인을 위해 <b>파기</b>를 입력</label><input id="wTxt" class="inp" style="width:140px"><button class="btn red" type="button" data-act="wipe">전체 파기 실행</button></div></div>';
  }
  function render() {
    if (!A.token) { root.innerHTML = vLogin(); return; }
    var body = { dash: vDash, roster: vRoster, orgs: vOrgs, export: vExport, settings: vSettings, key: vKey, wipe: vWipe }[A.view]();
    if (!A.otpOn) body = '<div class="card" style="border-color:#F59E0B;background:#FFFBEB;margin-bottom:14px"><b style="color:#92400E">관리자 2차 인증(Google OTP)이 아직 꺼져 있음</b> · <button class="btn sm" type="button" data-nav="key">[키 관리]에서 등록</button></div>' + body;
    root.innerHTML = '<div class="wrap"><nav class="nav" aria-label="관리 메뉴"><div style="padding:4px 12px 18px"><b style="font-size:15px">주소 취합 관리</b><div class="muted">접수 ' + (A.status ? (A.status.settings.open ? '<b class="ok">열림</b>' : '<b class="bad">닫힘</b>') : '') + '</div></div>' +
      NAV.map(function (n) { return '<button class="ni' + (A.view === n[0] ? ' on' : '') + (n[0] === 'wipe' ? ' danger' : '') + '" type="button" data-nav="' + n[0] + '">' + n[1] + '</button>'; }).join('') +
      '<div style="margin-top:auto;padding:12px;border-radius:10px;background:#F9FAFB" class="muted">개인키 <b style="color:#111827">' + (A.key ? '불러옴' : '안 불러옴') + '</b><br><button class="btn sm" type="button" data-act="logout" style="margin-top:8px">로그아웃</button></div></nav><main class="main">' + body + '</main></div>';
  }
  var orgSeq = 0;
  function setView(v) {
    A.view = v; render();
    if (v === 'dash') loadStatus();
    if (v === 'orgs') { var my = ++orgSeq; api('admin/orgs').then(function (o) { if (my === orgSeq) { A.orgs = o; render(); } }).catch(fail); }
    if (v === 'roster') { if (!A.status) api('admin/status').then(function (x) { A.status = x; render(); }).catch(fail); api('admin/orgs').then(function (o) { A.orgs = o; render(); }).catch(fail); }
    if (v === 'settings') api('admin/settings').then(function (s) { A.settings = s; render(); }).catch(fail);
  }

  /* ---------- 내려받기 ---------- */
  function doExport() {
    A.busy = true; render();
    api('admin/export').then(function (x) {
      var idOpen = x.roster.map(function (r) { return openBox(r.enc_identity).catch(function () { return { name: '(해독 실패)', birth: '' }; }); });
      var resp = {}; x.responses.forEach(function (r) { resp[r.roster_id] = r; });
      var payOpen = x.roster.map(function (r) { var s = resp[r.id]; return s && s.enc_payload ? openBox(s.enc_payload).catch(function () { return null; }) : Promise.resolve(null); });
      return Promise.all([Promise.all(idOpen), Promise.all(payOpen)]).then(function (z) { build(x, resp, z[0], z[1]); });
    }).then(function () { A.busy = false; render(); toast('엑셀을 내려받았음'); }).catch(fail);
  }
  function build(x, resp, ids, pays) {
    var orgs = x.orgs, K = x.houseKm, byCode = {}; orgs.forEach(function (o) { byCode[o.code] = o; });
    var dist = {}; x.distances.forEach(function (d) { (dist[d.roster_id] = dist[d.roster_id] || {})[d.site_id] = d; });
    var stName = function (r) { return !r ? '미접속' : r.status === 'submitted' ? '제출' : r.status === 'reopened' ? '재작성 허용' : '작성 중'; };
    var oname = function (c) { return c && byCode[c] ? byCode[c].name : ''; };
    var info = [['항목', '값'], ['생성일시', fmt(x.at)], ['거리 기준', '네이버 길찾기 ' + x.option + ' (현 거주지 기준)'], ['사택 기준', K + 'km 이상'], ['동의서 버전', x.consentVersion], ['형식버전', 1], ['인원', x.roster.length]];
    var org = [['조직코드', '구분', '권역', '부서', '이름', '원본 주소', '계산 위치']].concat(orgs.map(function (o) { return [o.code, o.kind, o.region || '', o.dept, o.name, o.addr_raw || '', o.addr]; }));
    var ans = [['본부', '부서', '센터', '이름', '생년월일', '상태', '제출일시', '현 주소', '지번', '우편번호', '2025 주소 변경', '이전 주소', '이사 예정', '이사 예정월', '이사 예정지(동)', '발령 기준지로', '발령 희망', '1지망 부서', '1지망 센터', '2지망 부서', '2지망 센터', '3지망 부서', '3지망 센터', '사유 구분', '사유', '거리 산출일시', '가장 가까운 센터', '최단 거리(km)', '사택 대상 센터 수']];
    var dHead = ['본부', '부서', '센터', '이름', '생년월일'].concat(orgs.map(function (o) { return (o.kind === '부서' ? '[부서] ' : '') + o.name + ' (' + o.code + ')'; }));
    var dK = [dHead], dM = [dHead], house = [['본부', '부서', '센터', '이름', '생년월일', '조직코드', '대상 센터명', '거리(km)', '소요(분)']], pend = [['본부', '부서', '센터', '이름', '생년월일', '상태']];
    x.roster.forEach(function (r, i) {
      var id = ids[i] || {}, s = resp[r.id], p = pays[i] || {}, dm = dist[r.id] || {};
      var vals = orgs.map(function (o) { return dm[o.site_id] || null; });
      var best = null, bi = -1, nHouse = 0;
      vals.forEach(function (v, j) { if (v && orgs[j].kind !== '부서') { if (best === null || v.km < best) { best = v.km; bi = j; } if (v.km >= K) { nHouse++; house.push([r.hq || '', r.dept || '', r.center || '', id.name, id.birth, orgs[j].code, orgs[j].name, v.km, v.min]); } } });
      var sub = s && s.status === 'submitted';
      var h = p.home || {}, pv = p.prev || {};
      // 지망 · 사유 구분 등은 암호문(meta) 안에 있음. 예전 방식으로 저장된 응답은 평문 칸을 씀
      var m = p.meta || (s ? { prevChanged: s.prev_changed, movePlanned: s.move_planned, moveMonth: s.move_month, moveBase: s.move_as_base, wish: s.wish, wishes: s.wishes, reasonCode: s.reason_code } : {});
      var ws = m.wishes || [], wcol = [];
      for (var wi = 0; wi < 3; wi++) { var w = ws[wi]; wcol.push(!w ? '' : w.dept === 'NONE' ? '발령 희망하지 않음' : oname(w.dept)); wcol.push(!w || w.dept === 'NONE' ? '' : (w.centers || []).map(oname).join(', ')); }
      ans.push([r.hq || '', r.dept || '', r.center || '', id.name, id.birth, stName(s), sub ? fmt(s.submitted_at) : '', h.road || '', h.jibun || '', h.zip || '',
        sub ? (m.prevChanged ? '달라짐' : '같음') : '', pv.road || '',
        sub ? (m.movePlanned ? '있음' : '없음') : '', m.moveMonth || '', p.move ? p.move.area : '', m.moveBase ? '예' : '',
        sub ? (m.wish === 'Y' ? '희망' : '희망 안 함') : ''].concat(wcol, [m.reasonCode || '', p.reasonText || '',
        s && s.calc_at ? fmt(s.calc_at) : '', bi >= 0 ? orgs[bi].name : '', best == null ? '' : best, bi >= 0 ? nHouse : '']));
      dK.push([r.hq || '', r.dept || '', r.center || '', id.name, id.birth].concat(vals.map(function (v) { return v ? v.km : ''; })));
      dM.push([r.hq || '', r.dept || '', r.center || '', id.name, id.birth].concat(vals.map(function (v) { return v ? v.min : ''; })));
      if (!sub) pend.push([r.hq || '', r.dept || '', r.center || '', id.name, id.birth, stName(s)]);
    });
    var wb = XLSX.utils.book_new();
    [['정보', info], ['조직', org], ['응답', ans], ['거리', dK], ['소요시간', dM], ['사택대상', house], ['미제출', pend]].forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s[1]), s[0]); });
    XLSX.writeFile(wb, '주소취합_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx');
  }

  /* ---------- 이벤트 ---------- */
  root.addEventListener('submit', function (e) {
    if (e.target.id !== 'lf') return; e.preventDefault();
    api('admin/login', { id: document.getElementById('aid').value, password: document.getElementById('apw').value, otp: document.getElementById('aotp').value }).then(function (r) { A.token = r.token; A.otpOn = !!r.otp; sessionStorage.setItem('addr-admin.token', r.token); sessionStorage.setItem('addr-admin.otp', r.otp ? '1' : ''); setView('dash'); }).catch(fail);
  });
  root.addEventListener('click', function (e) {
    var n = e.target.closest('[data-nav]'); if (n) return setView(n.getAttribute('data-nav'));
    var t = e.target.closest('[data-act]'); if (!t || t.disabled) return;
    var a = t.getAttribute('data-act'), k = t.getAttribute('data-k');
    if (a === 'reload') return loadStatus();
    if (a === 'logout') { A.token = ''; A.key = null; A.names = {}; A.otp = null; sessionStorage.removeItem('addr-admin.otp'); sessionStorage.removeItem('addr-admin.token'); return render(); }
    if (a === 'filter') { A.filter = k; return render(); }
    if (a === 'copy') {
      var list = A.status.rows.filter(function (r) { return stOf(r) !== 'done'; }).map(function (r) { var p = A.names[r.id] || {}; return [r.hq || '', r.dept || '', r.center || '', p.name, p.birth, ST[stOf(r)][0]].join('\t'); });
      return navigator.clipboard.writeText(['본부\t부서\t센터\t이름\t생년월일\t상태'].concat(list).join('\n')).then(function () { toast('미제출 ' + list.length + '명 복사함 (엑셀에 붙여넣기 가능)'); });
    }
    if (a === 'acc') {
      var label = { reset: '비밀번호를 초기화', unlock: '잠금을 해제', reopen: '제출을 풀어 재작성을 허용', calcReset: '거리 산출 횟수를 0으로 초기화', delete: '이 사람을 명단에서 삭제(응답 · 거리도 함께 삭제)' }[k];
      if (!confirm(label + '할까요?')) return;
      return api('admin/account', { id: Number(t.getAttribute('data-id')), action: k }).then(function () { toast('처리했음'); loadStatus(); }).catch(fail);
    }
    if (a === 'otpStart') return api('admin/otp').then(function (r) { if (r.enabled) { A.otpOn = true; sessionStorage.setItem('addr-admin.otp', '1'); } else A.otp = r; render(); }).catch(fail);
    if (a === 'otpCheck') return api('admin/otp', { secret: A.otp.secret, otp: document.getElementById('otpchk').value }).then(function (r) { A.otp.ok = r.ok; if (!r.ok) toast('코드가 맞지 않음 — 휴대폰 시간이 맞는지 확인', true); render(); }).catch(fail);
    if (a === 'otpCopy') { navigator.clipboard.writeText(A.otp.secret).then(function () { toast('복사했음'); }); return; }
    if (a === 'addPut') {
      var f = A.add; f.name = document.getElementById('an').value.trim(); f.birth = document.getElementById('ab').value.trim();
      var b6 = birth6(f.birth);
      if (!f.name) return toast('이름을 입력해 주세요', true);
      if (!/^\d{6}$/.test(b6)) return toast('생년월일 6자리를 확인해 주세요', true);
      if (A.addList.some(function (r) { return r.name === f.name && r.birth === b6; })) return toast('이미 담은 사람', true);
      A.addList.push({ hq: f.hq, dept: f.dept, center: f.center, name: f.name, birth: b6 }); f.name = ''; render();
      var n = document.getElementById('an'); if (n) n.focus(); return;
    }
    if (a === 'addDel') { A.addList.splice(Number(k), 1); return render(); }
    if (a === 'addPeople') {
      A.busy = true; render();
      return api('admin/roster', { rows: A.addList, removeMissing: false }).then(function (r) { A.busy = false; A.addList = []; toast(r.uploaded + '명 추가 · 서버 명단 ' + r.total + '명'); loadStatus(); }).catch(fail);
    }
    if (a === 'uploadRoster') {
      A.busy = true; render();
      return api('admin/roster', { rows: A.roster.rows, removeMissing: document.getElementById('rm') && document.getElementById('rm').checked }).then(function (r) { A.busy = false; A.roster = null; toast('올림 ' + r.uploaded + '명 · 서버 명단 ' + r.total + '명' + (r.removed ? ' · 삭제 ' + r.removed + '명' : '')); setView('dash'); }).catch(fail);
    }
    if (a === 'export') return doExport();
    if (a === 'orgTemplate') {
      var wb1 = XLSX.utils.book_new(), ws1 = XLSX.utils.aoa_to_sheet([['조직코드', '구분', '권역', '부서', '센터명', '주소'], ['5021', '부서', '수도권', '강북부', '강북부', '서울특별시 동대문구 장안동 415-12'], ['5021-01', '센터', '수도권', '강북부', '의정부보상센터', '경기도 의정부시 둔야로17번길 34 (층 · 호수는 있어도 됨)']]);
      ws1['!cols'] = [{ wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 48 }];
      XLSX.utils.book_append_sheet(wb1, ws1, '조직'); XLSX.writeFile(wb1, '조직주소_양식.xlsx'); return;
    }
    if (a === 'template') {
      var wb0 = XLSX.utils.book_new(), ws0 = XLSX.utils.aoa_to_sheet([['본부', '부서', '센터', '이름', '생년월일'], ['예) 수도권본부', '강북부서', '강북1센터', '홍길동', '900101']]);
      ws0['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
      for (var ci = 0; ci < 5; ci++) { var ad0 = XLSX.utils.encode_cell({ r: 1, c: ci }); if (ws0[ad0]) ws0[ad0].t = 's'; }
      XLSX.utils.book_append_sheet(wb0, ws0, '명단'); XLSX.writeFile(wb0, '명단_양식.xlsx'); return;
    }
    if (a === 'saveSettings') {
      var body = { open: document.getElementById('sOpen').checked, houseKm: Number(document.getElementById('sKm').value), reasons: document.getElementById('sReasons').value.split('\n'), consentText: document.getElementById('sConsent').value };
      return api('admin/settings', body).then(function (s) { A.settings = s; toast('저장했음'); render(); }).catch(fail);
    }
    if (a === 'genKey') {
      var p1 = document.getElementById('kp1').value, p2 = document.getElementById('kp2').value;
      if (p1.length < 8) return toast('키 비밀번호는 8자 이상', true);
      if (p1 !== p2) return toast('두 비밀번호가 다름', true);
      return genKey(p1).then(function () { toast('개인키 파일을 내려받았음. 아래 공개키를 ENC_PUBLIC_KEY 에 넣을 것'); render(); }).catch(fail);
    }
    if (a === 'copyPub') return navigator.clipboard.writeText(A.pub).then(function () { toast('공개키 복사함'); });
    if (a === 'wipe') {
      var txt = document.getElementById('wTxt').value.trim();
      if (txt !== '파기') return toast('"파기"를 정확히 입력해 주세요', true);
      if (!confirm('서버 자료를 모두 지움. 되돌릴 수 없음. 진행할까요?')) return;
      return api('admin/wipe', { confirm: txt, keepOrgs: document.getElementById('wOrg').checked, keepSettings: document.getElementById('wSet').checked }).then(function () { A.status = null; A.names = {}; toast('파기 완료'); setView('dash'); }).catch(fail);
    }
  });
  root.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.target.id === 'an' || e.target.id === 'ab')) { e.preventDefault(); var b = document.querySelector('[data-act=addPut]'); if (b) b.click(); } });
  root.addEventListener('input', function (e) { if (e.target.id === 'nq') { A.q = e.target.value; var pos = e.target.selectionStart; render(); var q = document.getElementById('nq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
  root.addEventListener('change', function (e) {
    var ak = e.target.getAttribute && e.target.getAttribute('data-add');
    if (ak) {
      var an = document.getElementById('an'), ab = document.getElementById('ab'); if (an) A.add.name = an.value; if (ab) A.add.birth = ab.value;
      A.add[ak] = e.target.value;
      if (ak === 'dept') A.add.center = '';
      if (ak === 'center' && e.target.value && !A.add.dept) { var o = ((A.orgs && A.orgs.list) || []).filter(function (x) { return x.kind === '센터' && x.name === e.target.value; })[0]; if (o) A.add.dept = o.dept; }
      return render();
    }
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (e.target.id === 'kf') {
      var pass = prompt('개인키 비밀번호'); if (!pass) return;
      loadKey(f, pass).then(function () { toast('개인키를 불러왔음'); render(); }).catch(fail);
    }
    if (e.target.id === 'rf') {
      readSheet(f).then(function (rows) {
        var out = [], bad = [], dup = [], seen = {};
        rows.forEach(function (r, i) {
          var name = String(pick(r, ['이름', '성명', 'name'])).trim(), b = birth6(pick(r, ['생년월일', '생일', 'birth']));
          var hq = String(pick(r, ['본부', 'hq'])).trim(), dept = String(pick(r, ['부서', '소속', 'dept'])).trim(), center = String(pick(r, ['센터', '센터명', 'center'])).trim();
          if (!name && !b) return;
          if (!name || !/^\d{6}$/.test(b)) { bad.push(i + 2); return; }
          var key = name.replace(/\s/g, '') + '|' + b; if (seen[key]) { dup.push(i + 2); return; } seen[key] = 1;
          out.push({ hq: hq, dept: dept, center: center, name: name, birth: b });
        });
        A.roster = { file: f.name, rows: out, bad: bad, dup: dup }; render();
      }).catch(fail);
    }
    if (e.target.id === 'of') {
      readSheet(f).then(function (rows) {
        var list = rows.map(function (r) { return { kind: String(pick(r, ['구분', 'kind'])).trim(), region: String(pick(r, ['권역', '수도/지방', 'region'])).trim(), code: String(pick(r, ['조직코드', '코드', 'code'])).trim(), dept: String(pick(r, ['부서', 'dept'])).trim(), name: String(pick(r, ['센터명', '센터', '조직명', 'name'])).trim(), addr: String(pick(r, ['주소', 'addr'])).trim() }; })
          .filter(function (r) { return r.code || r.name || r.addr; });
        A.busy = true; var my = ++orgSeq; render();
        return api('admin/orgs', { rows: list }).then(function (o) { A.busy = false; if (my === orgSeq) A.orgs = o; toast('조직 ' + o.list.length + '곳 등록 · 위치 ' + o.sites + '곳'); render(); });
      }).catch(fail);
    }
  });

  if (A.token) setView('dash'); else render();
})();
