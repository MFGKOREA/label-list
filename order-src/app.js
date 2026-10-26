(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : NaN; };
  const r1 = (v) => (Math.round(v * 10) / 10).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  const won = (v) => Math.round(v).toLocaleString("ko-KR");
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];

  // ---------- 날짜 (모두 현지 날짜 'YYYY-MM-DD') ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const dow = (s) => parseISO(s).getDay();
  const mmdd = (s) => `${s.slice(5, 7)}.${s.slice(8, 10)}`;
  const monthKey = (s) => s.slice(0, 7);
  const TODAY = iso(new Date());
  // 영업일 = 일요일 제외. 발주 후 2영업일 뒤 입고
  const addBiz = (s, n) => { let d = s; while (n > 0) { d = addDays(d, 1); if (dow(d) !== 0) n--; } return d; };
  const delivery = (orderDay) => addBiz(orderDay, 2);
  // ISO 주차 (월~일)
  function isoWeek(s) {
    const d = parseISO(s); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3);
    const y = d.getFullYear(); const jan4 = new Date(y, 0, 4);
    return { y, w: 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7) };
  }
  const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));

  // ---------- 저장소: localStorage 캐시 + 구글 시트(Apps Script) ----------
  const LS = "order-calc-db", LS_API = "order-calc-api";
  let db = {};
  try { db = JSON.parse(localStorage.getItem(LS)) || {}; } catch { db = {}; }
  // 구글 시트 주소(Apps Script 웹앱 /exec). 배포를 새로 만들면 이 주소만 바꾸면 됩니다. 앱에서 바꾼 주소가 있으면 그게 우선.
  const DEFAULT_API = "https://script.google.com/macros/s/AKfycbw56Q_Q3m0ZyZSHlAlRru2MZZ4-Lqj4tvfXFOfhH_YLi4HOiLn9Cj2yEbARK9LTk00t5Q/exec";
  let API = DEFAULT_API; try { const v = localStorage.getItem(LS_API); if (v !== null) API = v; } catch {}
  let online = false, pulled = false, trackT = null, lastVer = null; // pulled: 이번에 켠 뒤 시트 전체를 한 번이라도 받았나
  const lsSave = () => { try { localStorage.setItem(LS, JSON.stringify(db)); } catch {} };
  // 가게 키: 시트가 잠겨 있으면(Apps Script 스크립트 속성 APP_KEY) 모든 읽기·쓰기에 필요. 이 기기에만 저장
  const LS_KEY = "order-calc-key";
  let appKey = ""; try { appKey = localStorage.getItem(LS_KEY) || ""; } catch {}
  const setAppKey = (v) => { appKey = String(v || "").trim(); try { localStorage.setItem(LS_KEY, appKey); } catch {} };
  let askingKey = null;
  // 시트가 키를 요구하면 한 번만 물어봄 (여러 요청이 동시에 거절돼도 창은 하나)
  const askKey = () => askingKey || (askingKey = new Promise((ok) => setTimeout(() => { const v = prompt("가게 키를 입력해 주세요 (점장·KM에게 받은 키)"); askingKey = null; if (v && v.trim()) { setAppKey(v); ok(true); } else ok(false); }, 0)));
  const withKey = (u) => u + (appKey ? (u.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(appKey) : "");
  async function apiCall(body, retried) {
    const res = body
      ? await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(appKey ? { ...body, k: appKey } : body) })
      : await fetch(withKey(API + "?api=1&t=" + Date.now()));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (!j.ok && j.auth && !retried && (await askKey())) return apiCall(body, true);
    if (!j.ok) throw new Error(j.error || "응답 오류");
    if (j.ver && !body) lastVer = j.ver; // 저장 응답은 바꾼 키만 오므로 버전은 전체를 받을 때만 맞춤 (다른 기기 변경을 놓치지 않게)
    return j.data;
  }
  // 시트 저장이 실패한 값은 기억해 두고(이 기기 localStorage), 다음에 시트에서 받아올 때 덮어쓰지 않고 다시 보냄
  const LS_PEND = "order-calc-pending";
  let pend = { set: {}, add: {}, base: {} };
  try { pend = { set: {}, add: {}, base: {}, ...(JSON.parse(localStorage.getItem(LS_PEND)) || {}) }; } catch {}
  // 두 기기 동시 입력: 객체 값(날짜별 재고·발주, Forecast, 설정)은 통째로 덮지 않고 바뀐 칸만 보냄(merge)
  //  syncBase = 마지막으로 시트에서 받은 값, pend.base = 아직 못 보낸 값의 기준 (새로고침해도 남게)
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function diffObj(base, now) {
    const out = {};
    Object.keys(base).forEach((k) => { if (!(k in now)) out[k] = null; });
    Object.keys(now).forEach((k) => {
      const a = base[k], b = now[k];
      if (isObj(a) && isObj(b)) { const d = diffObj(a, b); if (Object.keys(d).length) out[k] = d; }
      else if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
    });
    return out;
  }
  function mergeObj(cur, patch) {
    const out = isObj(cur) ? { ...cur } : {};
    Object.keys(patch).forEach((k) => { const v = patch[k]; if (v === null) delete out[k]; else if (isObj(v) && isObj(out[k])) out[k] = mergeObj(out[k], v); else out[k] = v; });
    return out;
  }
  let syncBase = {}, noMerge = false;
  const baseOf = (k) => (k in pend.base ? pend.base[k] : syncBase[k]);
  // 한 키를 시트로: 기준이 있는 객체면 바뀐 칸만(merge), 아니면 통째로(set). 옛 Apps Script면 set으로
  async function pushKey(key) {
    // 기준이 없으면(시트에 아직 없는 새 날짜 키 등) 빈 객체 기준 = 이 기기 칸만 얹음 (시트에 있는 다른 칸은 안 건드림)
    const value = clone(db[key] ?? null), base = isObj(baseOf(key)) ? baseOf(key) : {};
    let data;
    if (!noMerge && isObj(value)) {
      const patch = diffObj(base, value);
      if (!Object.keys(patch).length) return;
      try { data = await apiCall({ action: "merge", key, patch }); }
      catch (e) { if (!/알 수 없는 요청/.test(e.message)) throw e; noMerge = true; }
    }
    if (!data) data = await apiCall({ action: "set", key, value });
    const srv = clone(data[key]);
    syncBase[key] = srv;
    // 보내는 동안 이 기기에서 또 고친 칸은 시트 값 위에 다시 얹음 (다른 기기가 넣은 칸은 받아 옴)
    if (isObj(srv) && isObj(db[key])) { const later = diffObj(value, db[key]); db[key] = mergeObj(srv, later); lsSave(); }
    if (JSON.stringify(db[key] ?? null) === JSON.stringify(value)) { delete pend.set[key]; delete pend.base[key]; savePend(); }
    else if (key in pend.base) { pend.base[key] = clone(srv); savePend(); } // 아직 못 보낸 칸은 시트 값을 기준으로 (다른 기기 칸을 내 옛 복사본으로 되돌리지 않게)
  }
  const savePend = () => { try { localStorage.setItem(LS_PEND, JSON.stringify(pend)); } catch {} };
  let flushing = false;
  async function flush() {
    if (!API || flushing) return; flushing = true;
    try {
      for (const k of Object.keys(pend.set)) { if (inflight[k]) continue; await pushKey(k); delete pend.set[k]; delete pend.base[k]; savePend(); }
      for (const k of Object.keys(pend.add)) { while (pend.add[k] && pend.add[k].length) { await apiCall({ action: "append", key: k, item: pend.add[k][0] }); pend.add[k].shift(); savePend(); } delete pend.add[k]; savePend(); }
      online = true;
    } catch { online = false; setTimeout(flush, 30000); } finally { flushing = false; }
  }
  // 시트에서 받아옴. 바뀐 게 있으면 true (1분마다 자동으로 받을 때는 실패 알림 없이)
  let lastSig = "";
  async function pull(quiet) {
    if (!API) { online = false; return false; }
    try {
      const remote = await apiCall();
      const sig = JSON.stringify(remote), changed = sig !== lastSig; lastSig = sig;
      const old = syncBase; syncBase = JSON.parse(sig);
      // 아직 시트에 못 보낸 값은 이 기기 값을 지킴 (객체는 이 기기에서 바꾼 칸만 시트 값 위에 얹음)
      Object.keys(pend.set).forEach((k) => {
        const loc = db[k], rem = remote[k], base = k in pend.base ? pend.base[k] : old[k];
        if (!(k in pend.base) && isObj(old[k])) pend.base[k] = clone(old[k]);
        remote[k] = isObj(loc) && isObj(rem) ? (isObj(base) ? mergeObj(rem, diffObj(base, loc)) : { ...rem, ...loc }) : loc;
        db[k] = remote[k];
      });
      savePend();
      Object.keys(pend.add).forEach((k) => { const arr = Array.isArray(remote[k]) ? remote[k].slice() : []; pend.add[k].forEach((it) => { if (!arr.some((x) => JSON.stringify(x) === JSON.stringify(it))) arr.push(it); }); remote[k] = arr; });
      db = { ...db, ...remote }; online = true; pulled = true; lsSave();
      if (Object.keys(pend.set).length || Object.keys(pend.add).length) flush();
      return changed;
    } catch (e) { online = false; if (!quiet) toast("구글 시트에 연결하지 못했어요. 이 기기에 저장해 둘게요."); return false; }
  }
  // 재고·발주·프랩 입력은 계산 모델을 통째로 다시 만들지 않고 채점만 다시 (입력할 때마다 느려지지 않게)
  function light(key) {
    if (/^(prepOnhand\.|prepLog$)/.test(key)) { if (cache) cache.plan = null; return; }
    if (/^(input\.|onhand$)/.test(key) && cache) { applyScores(cache); return; }
    invalidate();
  }
  function setKey(key, value) {
    if (value === null) delete db[key]; else db[key] = value;
    lsSave(); light(key);
    if (key !== "learnlog" && key !== "learnsnap") { clearTimeout(trackT); trackT = setTimeout(() => learnTrack(), 1500); }
    if (API) { if (!(key in pend.base) && isObj(syncBase[key])) pend.base[key] = clone(syncBase[key]); pend.set[key] = 1; savePend(); send(key); }
    if (key === "input." + TODAY || key === "misPush") setTimeout(renderMis, 0);
    if (key === "salesPush") setTimeout(renderSales, 0);
  }
  // 같은 키는 한 번에 하나씩 보냄 (먼저 보낸 옛 값이 늦게 도착해 새 값을 덮는 일 방지)
  const inflight = {};
  function send(key) {
    if (inflight[key]) { inflight[key] = 2; return; }
    inflight[key] = 1;
    pushKey(key)
      .then(() => { online = true; })
      .catch(() => { online = false; toast("시트 저장 실패 · 이 기기에 저장해 두고 다시 보낼게요"); setTimeout(flush, 15000); })
      .finally(() => { const again = inflight[key] === 2; delete inflight[key]; if (again) send(key); });
  }
  function appendKey(key, item) {
    (db[key] = Array.isArray(db[key]) ? db[key] : []).push(item);
    lsSave(); light(key);
    clearTimeout(trackT); trackT = setTimeout(() => learnTrack(), 1500);
    if (API) apiCall({ action: "append", key, item }).catch(() => { (pend.add[key] = pend.add[key] || []).push(item); savePend(); toast("시트 저장 실패 · 이 기기에 저장해 두고 다시 보낼게요"); setTimeout(flush, 15000); });
  }
  let toastT;
  function toast(msg, ms) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms || 2600); }

  // ---------- 이름 비교 ----------
  const norm = (s) => String(s || "").toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/사용중단|단위\s*발주|단위발주|발주|단발성|냉장|냉동|통합|_+/g, " ")
    .replace(/[\d.,]+\s*(kg|g|ml|l|ea|개|pk|미)?/g, " ")
    .replace(/[^a-z가-힣]/g, "")
    .replace(/수프/g, "스프").replace(/쉬/g, "시").replace(/컬/g, "콜"); // 표기 흔들림 (수프/스프, 머쉬룸/머시룸, 브로컬리/브로콜리)
  function dice(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a.includes(b) || b.includes(a) ? 0.7 : 0;
    const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const A = bg(a), B = bg(b); let inter = 0;
    A.forEach((v, k) => { inter += Math.min(v, B.get(k) || 0); });
    let sc = (2 * inter) / (a.length - 1 + b.length - 1);
    if (a.includes(b) || b.includes(a)) sc = Math.max(sc, 0.75);
    return sc;
  }
  function best(name, cands, key = (x) => x) {
    let top = null, sc = 0;
    cands.forEach((c) => { const v = dice(name, key(c)); if (v > sc) { sc = v; top = c; } });
    return { top, sc };
  }

  // 프랩 레시피는 영어 이름이라 라인 레시피의 한글 재료명과 맞추려고 단어를 한글로 바꿔 둠
  const KO = {"acai": "아사이", "bacon": "베이컨", "batter": "배터", "beef": "비프", "bell": "", "black": "블랙", "blade": "부채살", "block": "블록", "blueberry": "블루베리", "boiled": "삶은", "bouillon": "브이용", "brioche": "브리오슈", "broccoli": "브로콜리", "brussels": "방울양배추", "butter": "버터", "cake": "", "calamari": "깔라마리", "carrot": "당근", "cheese": "치즈", "cherry": "방울", "chicken": "치킨", "chop": "찹", "chunk": "", "clam": "조개살", "coating": "코팅", "cooked": "구운", "cream": "크림", "crumble": "크럼블", "cut": "", "cutting": "커팅", "deep": "딥", "dice": "다이스", "dressing": "드레싱", "egg": "에그", "eggplant": "가지", "finger": "핑거", "fish": "어묵", "fried": "튀긴", "fritto": "프리또", "frozen": "냉동", "garlic": "갈릭", "gorgonzola": "고르곤졸라", "grain": "그레인", "grana": "그라나", "grape": "포도", "green": "그린", "grilled": "구운", "herb": "허브", "honey": "허니", "jalapeno": "할라피뇨", "juice": "주스", "lasagna": "라자냐", "leek": "대파", "lemon": "레몬", "luxe": "럭스", "mad": "매드", "mandarine": "만다린", "mashed": "매쉬", "meat": "", "mix": "믹스", "mushroom": "머쉬룸", "mushrooms": "버섯", "mustard": "머스타드", "myeongran": "명란", "oil": "오일", "olive": "올리브", "onion": "양파", "oyster": "느타리", "padano": "파다노", "pan": "팬", "panini": "파니니", "paste": "페이스트", "pepper": "파프리카", "pickle": "피클", "pineapple": "파인애플", "pizza": "피자", "portion": "포션", "potato": "포테이토", "prep": "", "ragu": "라구", "rape": "라페", "rapee": "라페", "ready": "", "red": "레드", "ribs": "립", "rice": "떡", "rigatoni": "리가토니", "roasted": "로스트", "rosemary": "로즈마리", "rucola": "루꼴라", "sauce": "소스", "saute": "", "scapes": "마늘종", "seafood": "해산물", "seasoning": "시즈닝", "shrimp": "새우", "sizzling": "시즐링", "slice": "슬라이스", "sorbet": "샤베트", "sprout": "", "stock": "스톡", "sweet": "스위트", "thawing": "", "tomato": "토마토", "trimming": "", "tteokbokki": "떡볶이", "white": "화이트", "whole": "홀"};
  // 레시피에서 한글로 다르게 부르는 프랩 (Line 레시피 표기 기준)
  const PREP_KO = { "fried garlic": "튀긴 통마늘", "fried oyster mushrooms portion": "튀긴 새송이 포션", "garlic onion crumble": "갈릭 어니언 크럼블", "seafood mix portion thawing": "뉴 해산물 포션", "mushroom mix portion": "버섯 믹스 포션", "grilled leek portion": "그릴드 대파 포션", "boiled garlic": "보일드 갈릭" };
  const toKo = (en) => String(en || "").toLowerCase().replace(/[a-z]+/g, (w) => (w in KO ? KO[w] : w)).replace(/[^가-힣a-z]/g, "");

  // ---------- 수량 / 단위 ----------
  // 레시피 수량 → { g } | { ml } | { ea }
  function parseQty(w, v) {
    const g = /([\d.,]+)\s*(kg|g)\b/i.exec(w || "");
    if (g) return { g: num(g[1]) * (g[2].toLowerCase() === "kg" ? 1000 : 1) };
    const s = String(v || "");
    let m;
    if ((m = /([\d.,]+)\s*(kg|g)\b/i.exec(s))) return { g: num(m[1]) * (m[2].toLowerCase() === "kg" ? 1000 : 1) };
    if ((m = /([\d./]+)\s*(cc|ml)\b/i.exec(s))) return { ml: frac(m[1]) };
    if ((m = /([\d./]+)\s*l\b/i.exec(s))) return { ml: frac(m[1]) * 1000 };
    // 계량스푼·컵·스쿱은 부피(vol)라 가루·슬라이스처럼 가벼운 건 tbG(1TB 무게)로 g 환산
    if ((m = /([\d./]+)\s*TB\b/.exec(s))) return { ml: frac(m[1]) * 15, vol: true };
    if ((m = /([\d./]+)\s*tsp\b/i.exec(s))) return { ml: frac(m[1]) * 5, vol: true };
    if ((m = /([\d./]+)\s*cup\b/i.exec(s))) return { ml: frac(m[1]) * 240, vol: true };
    if ((m = /([\d./]+)\s*oz\b/i.exec(s))) return { g: frac(m[1]) * 28.35 };
    // 스쿱 번호: #N은 1쿼트(946ml)를 N번 뜨는 크기
    if ((m = /([\d./]+)\s*scoop\s*\(?\s*#\s*(\d+)/i.exec(s))) return { ml: frac(m[1]) * 946 / num(m[2]), vol: true };
    if ((m = /([\d./]+)\s*(ea|pc|pcs|piece|개|slice|장|pk|portion|포션)\b/i.exec(s))) return { ea: frac(m[1]) };
    // 그라나파다노 "3 바퀴" = 강판 3번 ≈ 3 g (레시피에 "3 g | 3 바퀴"로 같이 적힘)
    if ((m = /([\d./]+)\s*바퀴/.exec(s))) return { g: frac(m[1]) };
    return null;
  }
  function frac(s) { if (s.includes("/")) { const [a, b] = s.split("/").map(Number); return b ? a / b : NaN; } return num(s); }
  // 발주단위 "1PK/1kg", "1BOX/25ea" + 품목명 속 "350g" → 재고단위와 1재고단위 용량
  function parsePack(text, name) {
    const t = String(text || "");
    const out = { stock: "", order: "", mult: 1, g: null, ml: null, ea: null };
    const m = /([\d.]+)?\s*([A-Za-z가-힣]+)?\s*\/\s*([\d.,]+)\s*([A-Za-z가-힣]+)/.exec(t);
    const contentFromName = () => {
      const n = /([\d.]+)\s*(kg|g|ml|l)\b/i.exec(String(name || ""));
      if (!n) return;
      const v = num(n[1]), u = n[2].toLowerCase();
      if (u === "kg") out.g = v * 1000; else if (u === "g") out.g = v; else if (u === "l") out.ml = v * 1000; else out.ml = v;
    };
    if (m) {
      const unitOrder = (m[2] || "").toUpperCase(), q = num(m[3]), u = m[4].toLowerCase();
      if (/^(kg|g)$/.test(u)) { out.stock = unitOrder || "PK"; out.order = out.stock; out.g = q * (u === "kg" ? 1000 : 1); }
      else if (/^(l|ml|cc)$/.test(u)) { out.stock = unitOrder || "PK"; out.order = out.stock; out.ml = q * (u === "l" ? 1000 : 1); }
      else { out.stock = m[4]; out.order = unitOrder || "BOX"; out.mult = q || 1; out.ea = 1; contentFromName(); }
    } else {
      out.stock = t.trim() || "";
      out.order = out.stock;
      contentFromName();
      if (/개|ea/i.test(out.stock)) out.ea = 1;
    }
    return out;
  }
  // 발주 시트 품목: 품목환산(단위당 기준량)이 있으면 그것, 없으면 제품규격("270g*10ea/box", "1kg/pk")에서 1구매단위 용량을 읽음
  function packOf(it, cv) {
    if (!it.spec && !cv && !/구매|EA|PK|BOX/i.test(it.unit || "")) return parsePack(it.unit, it.name);
    const unit = (it.unit || "").trim();
    const m10 = /(\d+)\s*(?:개|pk|ea|병)?\s*단위/i.exec(it.name || "");
    const pk = { stock: unit, order: unit, mult: m10 ? +m10[1] : 1, g: null, ml: null, ea: null, sameUnit: true };
    if (cv) {
      const u = cv.u.toLowerCase();
      if (u === "g") pk.g = cv.q; else if (u === "kg") pk.g = cv.q * 1000; else if (/^(ml|cc)$/.test(u)) pk.ml = cv.q; else if (u === "l") pk.ml = cv.q * 1000; else pk.ea = cv.q;
      return pk;
    }
    const sp = String(it.spec || ""), U = unit.toLowerCase();
    const toG = (v, u) => { u = u.toLowerCase(); return u === "kg" ? { g: v * 1000 } : u === "g" ? { g: v } : u === "l" ? { ml: v * 1000 } : { ml: v }; };
    let m;
    if (U === "kg") { pk.g = 1000; return pk; }
    if ((m = /([\d.]+)\s*(kg|g|ml|l)\s*\*\s*([\d.]+)\s*([a-z]+)\s*\/\s*([a-z]+)/i.exec(sp))) {
      const w = toG(num(m[1]), m[2]);
      const f = m[4].toLowerCase() === U ? 1 : m[5].toLowerCase() === U ? num(m[3]) : 1;
      Object.assign(pk, { g: w.g != null ? w.g * f : null, ml: w.ml != null ? w.ml * f : null });
      return pk;
    }
    if ((m = /([\d.]+)\s*(kg|g|ml|l)\s*\/\s*([a-z]+)/i.exec(sp))) { Object.assign(pk, toG(num(m[1]), m[2])); return pk; }
    if ((m = /([\d.]+)\s*(kg|g|ml|l)\b/i.exec(sp))) { Object.assign(pk, toG(num(m[1]), m[2])); return pk; }
    // "10구/12pk"처럼 1재고단위에 든 개수
    if ((m = /^([\d.]+)\s*(구|개|ea|입)(?![a-z])/i.exec(sp))) { pk.ea = num(m[1]); return pk; }
    pk.ea = 1;
    return pk;
  }
  // 레시피 수량을 품목 재고단위로 (환산 못 하면 null)
  function toStock(q, pk) {
    if (!q) return null;
    if (q.g != null) { if (pk.g) return q.g / pk.g; if (pk.ml) return q.g / pk.ml; return null; }
    if (q.ml != null) { if (pk.ml) return q.ml / pk.ml; if (pk.g) return q.ml / pk.g; return null; }
    // "냉동_안심150g"처럼 1EA가 1인분 덩어리인 품목은 레시피 1 ea = 재고 1
    if (q.ea != null) { if (pk.ea) return q.ea / pk.ea; if ((!pk.g && !pk.ml) || (/^(ea|개)$/i.test(pk.stock || "") && (pk.g || pk.ml) <= 500)) return q.ea; return null; }
    return null;
  }

  // ---------- 엑셀 읽기 ----------
  // 모든 탭을 읽어 둠: 발주 BOH 파일처럼 첫 탭이 설명서인 경우가 있어서 머리글로 탭을 찾음
  async function readBook(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
  }
  const clean = (c) => String(c ?? "").replace(/\s/g, "").toLowerCase();
  // 머리글 줄 찾기: 필드마다 후보 단어를 앞에서부터 찾음 (예: '사용출고'가 '출고'보다 먼저)
  function findHeader(rows, fields, need) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] || [];
      const col = {};
      Object.entries(fields).forEach(([f, words]) => {
        for (const w of words) {
          const i = row.findIndex((c, j) => c != null && !Object.values(col).includes(j) && clean(c).includes(w));
          if (i >= 0) { col[f] = i; break; }
        }
      });
      if (need.every((f) => f in col)) return { r, col };
    }
    return null;
  }
  // 조건에 맞는 머리글이 있는 첫 탭 (prefer에 맞는 탭 이름을 먼저 봄)
  function findSheet(book, fields, need, prefer) {
    const order = prefer ? [...book.filter((s) => prefer.test(s.name)), ...book.filter((s) => !prefer.test(s.name))] : book;
    for (const sh of order) { const h = findHeader(sh.rows, fields, need); if (h) return { ...h, rows: sh.rows, sheet: sh.name }; }
    return null;
  }
  const cell = (row, col, f) => (f in col ? row[col[f]] : null);
  const str = (v) => String(v ?? "").trim();
  const NOT_ITEM_SHEET = /수불|메뉴|레시피|bom|환산|사용방법|매출|prep|프렙|프랩/i;

  async function parseOrderSheet(file) {
    const book = await readBook(file);
    const fields = {
      name: ["품목명칭", "품목명", "품명", "제품명"], code: ["품목코드"], spec: ["제품규격", "사양및규격", "규격"], price: ["재고단가", "단가"],
      unit: ["구매단위", "발주단위", "단위"], group: ["통합그룹"], vendor: ["업체", "거래처", "공급"], min: ["최소"], loc: ["보관", "위치"],
      active: ["사용여부", "상태"], shelf: ["쉘프", "shelf"],
    };
    const sheets = book.filter((s) => !NOT_ITEM_SHEET.test(s.name) || book.length === 1);
    const out = [], used = [];
    let cols = [];
    sheets.forEach((sh) => {
      const h = findHeader(sh.rows, fields, ["name"]);
      if (!h) return;
      used.push(sh.name); cols = Object.keys(h.col);
      // 업체 칸이 없으면 탭 이름이 업체 ("새싹농산,매장사입" → 새싹농산, "세제 발주" → 세제)
      const tabVendor = sheets.length > 1 ? sh.name.split(",")[0].replace(/\s*발주$/, "").trim() : "";
      sh.rows.slice(h.r + 1).forEach((row) => {
        const name = str(cell(row, h.col, "name"));
        if (!name || /^https?:/i.test(name)) return;
        const active = str(cell(row, h.col, "active"));
        out.push({
          name, code: str(cell(row, h.col, "code")), group: str(cell(row, h.col, "group")),
          vendor: str(cell(row, h.col, "vendor")) || tabVendor, unit: str(cell(row, h.col, "unit")), spec: str(cell(row, h.col, "spec")),
          price: num(cell(row, h.col, "price")) || null, min: num(cell(row, h.col, "min")) || 0, loc: str(cell(row, h.col, "loc")),
          off: /중단|미사용/.test(active) || /사용중단/.test(name), shelf: num(cell(row, h.col, "shelf")) || null,
        });
      });
    });
    if (!out.length) throw new Error("'품목명' 칸이 있는 탭을 찾지 못했어요");
    // 발주 BOH 파일에 들어 있는 품목환산·메뉴판매(메뉴→레시피명)·매출 입력도 함께 읽음 (레시피BOM 탭은 부정확해서 안 씀)
    const extra = {};
    const conv = findSheet(book, { code: ["품목코드"], q: ["단위당기준량"], u: ["기준단위"] }, ["code", "q", "u"], /환산/);
    if (conv) {
      extra.conv = {};
      conv.rows.slice(conv.r + 1).forEach((row) => { const c = str(cell(row, conv.col, "code")), q = num(cell(row, conv.col, "q")); if (c && q > 0) extra.conv[c] = { q, u: str(cell(row, conv.col, "u")) }; });
    }
    const mm = findSheet(book, { cat: ["중분류"], menu: ["메뉴명"], recipe: ["레시피명"], rc: ["적용레시피코드", "레시피코드"], mult: ["적용배수", "배수"] }, ["menu", "recipe"], /메뉴/);
    if (mm) {
      extra.menuMap = [];
      mm.rows.slice(mm.r + 1).forEach((row) => {
        const menu = str(cell(row, mm.col, "menu")), recipe = str(cell(row, mm.col, "recipe"));
        if (menu && recipe) extra.menuMap.push({ cat: str(cell(row, mm.col, "cat")), menu, recipe, mult: num(cell(row, mm.col, "mult")) || 1 });
      });
    }
    book.forEach((sh) => sh.rows.forEach((row, r) => (row || []).forEach((c, j) => {
      if (extra.gross == null && /당월매출/.test(clean(c))) { const v = num((sh.rows[r + 1] || [])[j]); if (v > 0) extra.gross = v; }
    })));
    return { rows: out, cols, sheets: used, ...extra };
  }
  async function parsePrepSheet(file) {
    const book = await readBook(file);
    const out = [];
    const codeRe = /^((?:\d+|시즌)\s*-\s*\d+)\s+/;
    book.forEach((sh) => {
      const rows = sh.rows;
      rows.forEach((row, r) => {
        const c = (row || []).findIndex((x) => /프랩명|프렙명|prep\s*name/i.test(str(x)));
        if (c < 0) return;
        // 이름이 머리글 바로 아래 칸이 아니라 옆 칸에 있는 양식이 있어서, 문자가 더 많이 든 칸을 이름 칸으로 씀
        const strings = (j) => rows.slice(r + 1, r + 40).filter((x) => x && typeof x[j] === "string" && x[j].trim()).length;
        const nc = strings(c + 1) > strings(c) ? c + 1 : c;
        const hdr = rows[r].map(clean);
        const sc = hdr.findIndex((x) => /shelf|쉘프|유통/.test(x)), pc = hdr.findIndex((x) => /보관/.test(x)), uc = hdr.findIndex((x) => x === "단위");
        let section = "", blank = 0;
        for (let k = r + 1; k < rows.length; k++) {
          const row2 = rows[k] || [];
          if (row2.some((x) => /프랩명|프렙명/.test(str(x)))) break;
          if (nc !== c && str(row2[c])) section = str(row2[c]);
          const raw = str(row2[nc]);
          if (!raw) { if (++blank >= 3) break; continue; }
          blank = 0;
          const m = codeRe.exec(raw);
          out.push({ name: raw.replace(codeRe, "").trim(), code: m ? m[1].replace(/\s/g, "") : "", section,
            pan: pc >= 0 ? str(row2[pc]) : "", shelf: sc >= 0 ? num(row2[sc]) || null : null, unit: uc >= 0 ? str(row2[uc]) : "" });
        }
      });
    });
    if (!out.length) throw new Error("'프랩명' 칸을 찾지 못했어요");
    const seen = new Set();
    return { rows: out.filter((x) => (seen.has(x.code + x.name) ? false : seen.add(x.code + x.name))), cols: ["name", "code", "shelf", "pan"] };
  }
  async function parseLedger(file) {
    const book = await readBook(file);
    const h = findSheet(book, {
      name: ["품목명칭", "품목명", "품명"], usage: ["사용출고", "실사출고", "출고수량", "사용량"], code: ["품목코드"], group: ["통합그룹"], unit: ["단위"], spec: ["사양및규격", "규격"],
    }, ["name", "usage"], /수불/);
    if (!h) throw new Error("'품목명'과 '사용출고(사용량)' 칸을 찾지 못했어요");
    // 사용량 후보 칸이 여럿이면 우선순위대로 보되, 값이 거의 다 0인 칸은 건너뜀 (양식마다 채우는 칸이 달라서)
    const USAGE = ["사용출고", "실사출고", "출고수량", "사용량"];
    const data = h.rows.slice(h.r + 1).filter((row) => str(cell(row, h.col, "name")));
    const filled = (j) => data.filter((row) => num(row[j]) > 0).length;
    const head = h.rows[h.r] || [];
    const cands = USAGE.flatMap((w) => head.map((c, j) => (c != null && clean(c).includes(w) && !/금액/.test(clean(c)) ? j : -1)).filter((j) => j >= 0));
    const pick = [...new Set(cands)].find((j) => filled(j) >= data.length * 0.1);
    if (pick != null) h.col.usage = pick;
    // 머리글 아래에 '수량/금액' 줄이 하나 더 있는 양식은 그 줄을 건너뜀
    const out = [];
    h.rows.slice(h.r + 1).forEach((row) => {
      const name = str(cell(row, h.col, "name"));
      const usage = num(cell(row, h.col, "usage"));
      if (!name || !isFinite(usage)) return;
      out.push({ name, usage, code: str(cell(row, h.col, "code")), group: str(cell(row, h.col, "group")), unit: str(cell(row, h.col, "unit")), spec: str(cell(row, h.col, "spec")) });
    });
    return out;
  }
  // 쿠폰은 읽어 두되(매출 없이 나가는 요리), 레시피 연결에서 직접 고른 쿠폰만 계산에 넣음
  const SKIP_CATS = /주류|음료|upcharge|^기타$|other|pet|미분류/i;
  const COUPON = /쿠폰/;
  async function parseSales(file) {
    const book = await readBook(file);
    const h = findSheet(book, { cat: ["중분류"], menu: ["소분류", "메뉴명", "메뉴"], qty: ["판매수량", "조회일기준", "수량"] }, ["menu"], /메뉴|매출/);
    const rows = h ? h.rows : book[0].rows;
    const start = h ? h.r + 1 : 0, col = h ? h.col : { cat: 0, menu: 1, qty: 2 };
    if (!("qty" in col)) col.qty = (col.menu ?? 1) + 1;
    const byCat = new Map();
    rows.slice(start).forEach((row) => {
      const cat = String(cell(row, col, "cat") ?? "").trim(), menu = String(cell(row, col, "menu") ?? "").trim(), qty = num(cell(row, col, "qty"));
      if (!menu || !isFinite(qty) || /합계|소계/.test(menu + cat)) return;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push({ cat, menu, qty });
    });
    const out = [];
    byCat.forEach((list) => {
      // 중분류 첫 줄이 소계(이름이 같거나 나머지 합과 같음)면 뺌
      const [first, ...rest] = list;
      const restSum = rest.reduce((a, x) => a + x.qty, 0);
      const isSub = rest.length && (first.menu === first.cat || Math.abs(first.qty - restSum) < 0.5);
      (isSub ? rest : list).forEach((x) => { if (!SKIP_CATS.test(x.cat) && x.qty > 0) out.push(x); });
    });
    return out;
  }

  // ---------- 레시피 PDF 읽기 (pdf.js) ----------
  async function parseRecipePdf(file) {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const recipes = [], index = new Map();
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      // 같은 높이의 글자를 한 줄로 묶음
      const lines = [];
      tc.items.forEach((it) => {
        const str = it.str; if (!str || !str.trim()) return;
        const x = it.transform[4], y = it.transform[5];
        let ln = lines.find((l) => Math.abs(l.y - y) < 3);
        if (!ln) { ln = { y, items: [] }; lines.push(ln); }
        ln.items.push({ x, str: str.trim() });
      });
      lines.sort((a, b) => b.y - a.y);
      lines.forEach((l) => { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map((i) => i.str).join(" "); });
      const pageText = lines.map((l) => l.text).join("\n");
      const shelfM = /Shelf\s*Life\s*:\s*([\d.]+)\s*Day/i.exec(pageText);
      // 쪽 아래 "Mad Oil   1-1   2026-10-06" 에서 레시피 번호를 읽음 (프랩 시트의 "1-1 매드 오일"과 연결)
      // 바닥글은 날짜가 "2026-10- 0 6"처럼 쪼개지거나 번호와 다른 줄에 있기도 해서, 쪽 맨 아래 줄들에서 번호만 찾음
      const footCode = lines.filter((l) => l.y < 60).flatMap((l) => l.items).map((i) => /^((?:\d+|시즌)\s*-\s*\d+)$/.exec(i.str)).find(Boolean);
      const before = recipes.length;
      // 앞쪽 목차("4-8 Golden Layers Signature Lasagna")의 번호가 바닥글보다 정확해서 따로 모음
      if (!/Recipe Name/i.test(pageText)) lines.forEach((l) => { const m = /((?:\d+|시즌)\s*-\s*\d+)\s+(.+)$/.exec(l.text); if (m) index.set(clean(m[2].replace(/\s+(Season|Set)$/i, "")), m[1].replace(/\s/g, "")); });
      const yieldM = /Yield\s*:\s*([^\n]+)/i.exec(pageText);
      let cur = null, hdr = null;
      for (const l of lines) {
        if (/Recipe Name\s*:/i.test(l.text)) {
          cur = { name: l.text.replace(/.*Recipe Name\s*:\s*/i, "").trim(), short: "", ing: [], shelf: shelfM ? num(shelfM[1]) : null, yield: yieldM ? yieldM[1].trim() : "" };
          recipes.push(cur); hdr = null; continue;
        }
        if (!cur) continue;
        if (/Short Name\s*:/i.test(l.text)) { cur.short = l.text.replace(/.*Short Name\s*:\s*/i, "").trim(); continue; }
        // 이름 바로 아래 한글 이름 (Short Name 표시가 없는 프랩 레시피)
        if (!cur.short && !hdr && !cur.seenHdr && /[가-힣]/.test(l.text) && !/^\d+\s*\./.test(l.text) && l.text.length <= 30) { cur.short = l.text.trim(); continue; }
        if (/WEIGHT/.test(l.text) && /INGREDIENTS/.test(l.text)) {
          const at = (w) => (l.items.find((i) => i.str.includes(w)) || {}).x;
          hdr = { w: at("WEIGHT"), v: at("VOLUME"), i: at("INGREDIENTS"), s: at("Standard") };
          cur.seenHdr = true;
          continue;
        }
        if (!hdr) continue;
        // 조리 순서 "1." 이 나오면 재료 끝 ("0.5 oz"는 재료라 첫 글자가 "숫자."만인 경우만)
        if (/^(Plate|Yield|Shelf|Critical|Container|Method)/i.test(l.text) || /^\d+\s*\.$/.test(l.items[0].str)) { hdr = null; continue; }
        const b1 = (hdr.v ?? hdr.i) - 10, b2 = hdr.i - 6, b3 = hdr.s != null ? hdr.s - 6 : Infinity;
        let w = "", v = "", n = "";
        l.items.forEach((it) => { if (it.x < b1) w += " " + it.str; else if (it.x < b2) v += " " + it.str; else if (it.x < b3) n += " " + it.str; });
        n = n.trim();
        // PDF에 재료 이름이 빠진 줄(당근 라페 330 g)은 이름 없는 재료로 남겨 두고 레시피 연결에서 고르게 함
        if (!n && /\d/.test(w + v)) n = `(이름 없음) ${cur.name}`;
        if (!n) continue;
        cur.ing.push({ w: w.trim(), v: v.trim(), n });
      }
      if (footCode) recipes.slice(before).forEach((r) => { r.code = footCode[1].replace(/\s/g, ""); });
    }
    recipes.forEach((r) => { const c = index.get(clean(r.name)); if (c) r.code = c; });
    return recipes.filter((r) => r.name).map(({ seenHdr, ...r }) => r);
  }

  // ---------- 데이터 모음 ----------
  // db 키: master.order, master.prep, month.YYYY-MM = { gross, ledger, sales, line, prep }, forecast, onhand(log), prepOnhand.YYYY-MM-DD, map
  const months = () => Object.keys(db).filter((k) => k.startsWith("month.")).map((k) => k.slice(6)).sort();
  const mget = (m) => db["month." + m] || {};
  function mset(m, patch) { setKey("month." + m, { ...mget(m), ...patch }); }
  // 최신 레시피 (가장 늦은 달에 올린 것, 같은 이름은 나중 파일이 덮음)
  function latestRecipes(kind) {
    const map = new Map();
    months().forEach((m) => { const f = mget(m)[kind]; if (f && f.recipes) f.recipes.forEach((r) => map.set(r.name, r)); });
    // PDF에 없는 메뉴(시저 샐러드 등)는 매장에서 알려준 레시피로
    ((db.customRecipes || {})[kind] || []).forEach((r) => { if (!r.months) map.set(r.name, r); });
    return [...map.values()];
  }
  // 그 달에만 쓰던 레시피 (customRecipes 항목에 months: ["2026-09"]): 브리오슈 9월 6컷 → 10월 8컷처럼 레시피가 바뀐 달의 계산·로스 비교용
  const variantOf = (kind, name, m) => (m && ((db.customRecipes || {})[kind] || []).find((r) => r.months && r.name === name && r.months.includes(m))) || null;
  const hasVariant = (m) => !!m && ["line", "prep"].some((k) => ((db.customRecipes || {})[k] || []).some((r) => r.months && r.months.includes(m)));

  let cache = null;
  let fcBiasMemo = null, dataFcMemo = new Map();
  const invalidate = () => { cache = null; fcBiasMemo = null; fcErrMemo = null; dataFcMemo = new Map(); };
  // 공휴일 (대체공휴일 포함). 시트의 holidays 키(날짜 배열)로 더 넣을 수 있음
  const HOLI = new Set([
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-05", "2026-05-25", "2026-06-03", "2026-08-17",
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-05", "2026-10-09", "2026-12-25",
    "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-05", "2027-05-13", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-04", "2027-10-09", "2027-10-11", "2027-12-27",
    "2026-10-03", "2026-03-01", "2026-05-24", "2026-06-06", "2026-08-15", "2027-02-06", "2027-02-07", "2027-06-06", "2027-08-15", "2027-10-03", "2027-12-25",
  ]);
  const isHoliday = (d) => HOLI.has(d) || (db.holidays || []).includes(d);
  // 데이터 예상 Forecast: 그날 전까지의 실제 Gross Sales로
  //  평일·주말 = 같은 요일 최근 6번 (최근일수록 비중, 행사처럼 튀는 날(중앙값의 1.25배 넘음)은 뺌)
  //  공휴일 = 지난 공휴일 실제 매출과 그 요일 평소 매출의 평균 (9~10월 실적으로 맞춰 봄)
  //  트렌드 = 그 주(월~일)에 점장님이 넣은 Forecast(보정 반영) ÷ 같은 날들 데이터 예상의 절반만 반영 (0.7~1.4배로 자름)
  //   9/14~10/20 실적으로 맞춰 보면 하루 오차 30.7% → 28.2%
  function dataForecast(d) {
    const b = dataBase(d); if (b == null) return null;
    const f = db.forecast || {}, mon = mondayOf(d);
    let a = 0, z = 0, all = 0;
    for (let i = 0; i < 7; i++) {
      const x = addDays(mon, i), fv = num((f[x] || {}).fc) * fcBias(x).k, bx = dataBase(x); if (!bx) continue; all += bx;
      if (fv >= 0.3 * bx) { a += Math.min(2 * bx, Math.max(0.5 * bx, fv)); z += bx; } // 0.3배 아래는 오타로 보고 뺌, 하루 값은 0.5~2배로 자름
    }
    // 그 주에 Forecast를 넣은 만큼만 (하루만 넣으면 조금, 한 주 다 넣으면 다)
    const R = z ? 1 + (Math.min(1.4, Math.max(0.7, a / z)) - 1) * (z / all) : 1;
    return b * (1 + 0.5 * (R - 1));
  }
  function dataBase(d) {
    if (dataFcMemo.has(d)) return dataFcMemo.get(d);
    const f = db.forecast || {};
    const pick = (ok, max, back) => { const out = []; for (let k = 1; k <= back && out.length < max; k++) { const x = addDays(d, -k), v = num((f[x] || {}).act); if (isFinite(v) && v > 0 && ok(x)) out.push(v); } return out; };
    const wmean = (vals) => {
      if (!vals.length) return null;
      const med = vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)];
      // 아래쪽(중앙값 0.6배 미만, 휴무·반쪽 영업)만 버림. 위쪽 컷(1.25배)은 행사·단체 날을 버려 늘 적게 잡았음 (9/14~10/21 오차 31.6% → 26.5%, 과소 +12.9% → +1.2%)
      const keep = vals.map((v, i) => [v, vals.length - i]).filter(([v]) => vals.length < 3 || v >= med * 0.6);
      return keep.reduce((a, [v, w]) => a + v * w, 0) / keep.reduce((a, [, w]) => a + w, 0);
    };
    const wd = dow(d);
    let v = wmean(pick((x) => dow(x) === wd && !isHoliday(x), 6, 120));
    if (isHoliday(d)) {
      const h = wmean(pick(isHoliday, 6, 400)) ?? wmean(pick((x) => dow(x) === 0 && !isHoliday(x), 6, 120));
      v = v && h ? Math.max(v, h) : v || h || null; // 공휴일은 같은 요일과 공휴일·일요일 중 큰 쪽 (평균하면 공휴일을 35% 적게 잡음)
    }
    if (v == null) { const all = pick(() => true, 28, 60); v = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null; }
    dataFcMemo.set(d, v);
    return v;
  }
  // I: Forecast 보정 — 요일 묶음(월·화 / 수·목·금 / 토·일·공휴일)마다 "실제 ÷ Forecast" 중앙값으로. 점장 Forecast가 수·목·금은 계속 10~20% 적게,
  //  월·화는 조금 많게 잡혀 왔음 (9/14~10/25, 34일). 표본이 적을수록 덜 믿음(n/(n+3)), ±5% 안은 우연으로 보고 안 함, 0.7~1.3배로 자름.
  //  되돌려 보기(그날 이전 날들만 보고 정함): 하루 오차 17.4→16.8% (10/6~), 15.4% (10/13~), 17.7% (10/19~) · 편향 +4.3→+0.5%
  const fcGroup = (d) => { const w = dow(d); return w === 0 || w === 6 || isHoliday(d) ? "we" : w <= 2 ? "mt" : "wtf"; };
  const FC_GROUP_NAME = { mt: "월·화", wtf: "수·목·금", we: "토·일" };
  // 주말 보정(10/26): 토·일·공휴일 매출만 합 [from, to). 플래터처럼 주말에 몰리는 메뉴 때문에 품목마다 주말 100만원당 사용량이 다름
  const isWE = (d) => fcGroup(d) === "we";
  const weSum = (from, to, act) => { let s = 0; for (let d = from; d < to; d = addDays(d, 1)) if (isWE(d)) s += dayGross(d, act).v; return s; };
  // 품목별 주말 배수 k: 주말 매출 몫에만 곱함 (평일은 그대로). 재고 채점으로 배움(applyScores) · itemCfg.weK로 직접 정할 수도
  //  메뉴 판매로 구한 값은 평일 배수 wdK도 같이 (한 달 합은 그대로 두고 평일·주말로 나눔: 런치 세트 재료는 평일↑ 주말↓)
  const weMix = (it, win) => { const k = it.weK || 1, kd = it.wdK || 1; if ((k === 1 && kd === 1) || !(win.gross > 0) || win.weGross == null) return 1; const we = Math.min(Math.max(0, win.weGross), win.gross); return ((win.gross - we) * kd + we * k) / win.gross; };
  function fcHist() {
    if (fcBiasMemo) return fcBiasMemo;
    const f = db.forecast || {};
    const hist = Object.keys(f).filter((d) => d < TODAY).sort().map((d) => ({ d, fc: num(f[d].fc), act: num(f[d].act) })).filter((x) => x.fc > 0 && x.act > 0);
    const groups = {};
    ["mt", "wtf", "we"].forEach((g) => {
      const r = hist.filter((x) => fcGroup(x.d) === g).slice(-12).map((x) => x.act / x.fc).sort((a, b) => a - b);
      let k = 1;
      // 시트 settings.fcBias = "off"면 보정 안 함
      if (r.length >= 3 && (db.settings || {}).fcBias !== "off") { const med = Math.min(1.3, Math.max(0.7, r[Math.floor(r.length / 2)])); k = 1 + (med - 1) * r.length / (r.length + 3); if (Math.abs(k - 1) <= 0.05) k = 1; }
      groups[g] = { k: Math.round(k * 1000) / 1000, n: r.length };
    });
    return (fcBiasMemo = { hist, groups, n: hist.length });
  }
  // fcBias(d) = 그날의 보정 배수. 날짜 없이 부르면 묶음별 배수 목록(화면 표시용)
  function fcBias(d) {
    const h = fcHist();
    if (!d) return { k: 1, n: h.n, groups: h.groups, label: Object.keys(h.groups).filter((g) => h.groups[g].k !== 1).map((g) => `${FC_GROUP_NAME[g]} ${h.groups[g].k > 1 ? "+" : ""}${Math.round((h.groups[g].k - 1) * 100)}%`).join(" · ") };
    return h.groups[fcGroup(d)];
  }
  // Forecast 하루 오차(상대값, 보정 뒤 남는 오차의 RMS): 평일과 주말을 따로 (최근 28일 기준 평일 0.24, 주말 0.11 — 주말은 점장 Forecast가 훨씬 정확).
  //  4일 미만이면 전체 값으로, 전체도 5일 미만이면 25%
  let fcErrMemo = null;
  function fcErrAll() {
    if (fcErrMemo) return fcErrMemo;
    const rms = (arr) => Math.sqrt(arr.reduce((x, e) => x + e * e, 0) / arr.length);
    const res = fcHist().hist.slice(-28).map((x) => ({ g: fcGroup(x.d) === "we" ? "we" : "wd", e: x.act / (x.fc * fcBias(x.d).k) - 1 }));
    const all = res.length >= 5 ? Math.min(0.6, Math.max(0.05, rms(res.map((x) => x.e)))) : 0.25;
    const of = (g) => { const a = res.filter((x) => x.g === g).map((x) => x.e); return a.length >= 4 ? Math.min(0.6, Math.max(0.05, rms(a))) : all; };
    return (fcErrMemo = { all, wd: of("wd"), we: of("we") });
  }
  const fcErr = (d) => (d ? fcErrAll()[fcGroup(d) === "we" ? "we" : "wd"] : fcErrAll().all);
  // 기간 Forecast 오차의 분산: 날마다 (그날 매출 × 그날 오차)²를 더함. 실제 매출이 있는 지난날은 오차 0.
  //  기간 전체의 상대 오차 = √fcVar ÷ 기간 매출 (주말이 끼면 작아지고, 평일만이면 커짐 — 전에는 하루 오차 하나를 √일수로만 나눴음)
  function fcVar(from, toExcl, preferActual, firstLeft) {
    let v = 0;
    for (let d = from; d < toExcl; d = addDays(d, 1)) { const g = dayGross(d, preferActual); if (g.src === "act") continue; const w = (d === from ? (firstLeft == null ? 1 : firstLeft) : 1) * g.v; const s = g.src === "fc" ? fcErr(d) : Math.max(fcErr(d), 0.3); v += w * w * s * s; }
    return v;
  }

  function model() {
    if (cache) return cache;
    const mapCfg = db.map || { menu: {}, ing: {} };
    mapCfg.menu = mapCfg.menu || {}; mapCfg.ing = mapCfg.ing || {};
    // 품목 목록: 발주 시트가 있으면 그것, 없으면 최근 수불현황 품목명
    let items;
    const sheet = db["master.order"];
    const allMonths = months();
    const lastLedgerMonth = [...allMonths].reverse().find((m) => mget(m).ledger);
    if (sheet && sheet.rows && sheet.rows.length) {
      // 품목코드 칸이 있는 시트에서 코드 없는 줄은 '날짜', '데일리 매출' 같은 메모 줄. 'hide'는 목록에서 뺀 품목 ("업체:소모품"이면 그 업체 전체)
      const hasCode = (sheet.cols || []).includes("code"), hide = new Set(db.hide || []);
      items = sheet.rows.filter((r) => !r.off && !(hasCode && !r.code) && !hide.has(r.name) && !hide.has("업체:" + r.vendor)).map((r) => ({ ...r }));
    } else if (lastLedgerMonth) {
      items = mget(lastLedgerMonth).ledger.rows.filter((r) => r.usage > 0).map((r) => ({ name: r.name, group: r.group, code: r.code, vendor: "", unit: "", min: 0, loc: "" }));
    } else items = [];
    // 통합그룹으로 묶기: 같은 그룹 품목은 하나의 발주 품목 (현재 쓰는 코드 이름 우선)
    const byKey = new Map();
    items.forEach((it) => {
      const key = it.group || it.name;
      const prev = byKey.get(key);
      if (!prev || (/사용중단/.test(prev.name) && !/사용중단/.test(it.name))) byKey.set(key, { ...it, key, members: [...(prev ? prev.members : []), it.name] });
      else prev.members.push(it.name);
    });
    items = [...byKey.values()];
    const conv = (sheet && sheet.conv) || {};
    // itemCfg: 매장에서 알려준 1재고단위 안 개수 (판도우 1BOX = 도우 60개, 하몽 1EA = 8장)
    const itemCfg = db.itemCfg || {};
    // itemCfg.box: 재고는 박스로 세고 발주는 팩으로 (냉동감자튀김 1박스 = 6팩)
    // itemCfg.label: 단위 이름만 바꿔 보여줌 (루토사 매쉬 1EA = 1팩 → PK) · portionG: 필요량 옆에 몇 포션인지 (리코타 1포션 = 1스쿱 50g)
    const withCfg = (it) => {
      const c = itemCfg[it.key] || itemCfg[it.name];
      if (c && c.ea) it.pk = { ...it.pk, ea: c.ea };
      if (c && c.g) it.pk = { ...it.pk, g: c.g }; // 1단위 무게를 바로잡음 (브리오슈 1PK = 380g × 3개)
      if (c && c.label) { it.pk = { ...it.pk, stock: c.label, order: c.label }; it.unit = c.label; }
      it.box = (c && c.box) || 0; it.portionG = (c && c.portionG) || 0; it.portionLabel = (c && c.portionLabel) || "포션";
      it.outStep = (c && c.outStep) || 0; // 꺼내 쓰는 단위 (버터라이스: 박스째 라인 리치인으로 → 재고가 40개씩 줄어듦)
      it.thaw = (c && c.thaw) || 0; // 냉동 품목 해동 일수: 입고 다음 날부터 쓸 수 있음 (고기·폭립·부라타·스프 등 24시간)
      it.recipeOnly = !!(c && c.recipeOnly); // 레시피에만 쓰는 품목 (파마산=라인, 설탕=프랩): 수불(A) 대신 레시피(B)로만 계산
      it.useK = (c && num(c.useK) > 0 && num(c.useK)) || 1; // KM이 정한 사용량 반영률 (라구소스 1.2 = 계산보다 20% 더)
      it.countStep = (c && num(c.countStep) > 0 && num(c.countStep)) || 0; // 재고를 박스째로만 세는 품목의 셈 단위 (없으면 최근 기록으로 짐작)
    };
    items.forEach((it) => { it.pk = packOf(it, conv[it.code]); withCfg(it); });
    const byName = new Map(); items.forEach((it) => it.members.forEach((n) => byName.set(n, it)));
    const byCode = new Map(); items.forEach((it) => { if (it.code) byCode.set(it.code, it); });

    // 수불현황 행 → 품목
    const ledgerItem = (row) => (row.code && byCode.get(row.code)) || byName.get(row.name) || (row.group && items.find((i) => i.key === row.group)) || (row.code && items.find((i) => i.code && i.code === row.code)) || (() => { const b = best(row.name, items, (i) => i.name); return b.sc >= 0.85 ? b.top : null; })();
    // 발주 시트에 없고 수불현황에만 있는 품목(구운아몬드슬라이스 등)도 계산·재료 연결에 씀. 발주 목록에는 안 보임
    if (sheet && sheet.rows && sheet.rows.length) {
      const hide = new Set(db.hide || []);
      allMonths.forEach((m) => (mget(m).ledger ? mget(m).ledger.rows : []).forEach((r) => {
        if (hide.has(r.name) || (itemCfg[r.name] || {}).as || ledgerItem(r)) return;
        const it = { name: r.name, code: r.code, group: r.group, vendor: "", unit: r.unit || "", spec: r.spec || "", min: 0, loc: "", key: r.group || r.name, members: [r.name], ledgerOnly: true };
        it.pk = packOf(it, conv[it.code]); withCfg(it);
        items.push(it); byName.set(r.name, it); if (it.code) byCode.set(it.code, it);
      }));
    }

    // 레시피
    const line = latestRecipes("line"), prep = latestRecipes("prep");
    const prepByName = new Map(prep.map((p) => [p.name, p]));
    const prepSheet = (db["master.prep"] && db["master.prep"].rows) || [];
    // 재료 → 품목 또는 프랩
    const ingCands = [
      ...items.map((i) => ({ kind: "item", id: i.key, label: i.ledgerOnly ? `${i.name} · 수불현황에만 있음` : i.name, keys: [i.name, ...i.members], lo: i.ledgerOnly })),
      ...prep.map((p) => {
        const s = prepSheet.find((x) => x.name === p.name || dice(x.name, p.name) > 0.9);
        return { kind: "prep", id: p.name, label: "프랩 · " + (s && s.alias ? s.alias : p.name), keys: [p.name, toKo(p.name), PREP_KO[p.name.toLowerCase()], p.short, s && s.alias].filter(Boolean) };
      }),
    ];
    const ingMap = new Map();
    const resolveIng = (n) => {
      if (ingMap.has(n)) return ingMap.get(n);
      let res = null;
      const fixed = mapCfg.ing[n];
      if (fixed === "skip") res = { skip: true };
      else if (fixed) res = ingCands.find((c) => `${c.kind}:${c.id}` === fixed) || null;
      if (!fixed) {
        // 자동 연결은 발주 시트 품목·프랩 먼저, 거기 없을 때만 수불현황에만 있는 품목 (0.7 이상)
        const pick = (cs, min) => { let top = null, sc = 0; cs.forEach((c) => c.keys.forEach((k) => { const v = dice(n, k); if (v > sc) { sc = v; top = c; } })); return sc >= min ? { ...top, auto: true, sc } : null; };
        res = pick(ingCands.filter((c) => !c.lo), 0.6) || pick(ingCands.filter((c) => c.lo), 0.7);
      }
      ingMap.set(n, res);
      return res;
    };
    // 메뉴 → 레시피
    const recipeCands = line.filter((r) => !/griddle|그리들/i.test(r.name + r.short));
    // 발주 시트 메뉴판매 탭의 메뉴 → LINE 레시피명 (사람이 고른 연결이라 자동 연결보다 먼저 씀)
    const sheetMenus = (sheet && sheet.menuMap) || [];
    const lineByName = (n) => { const k = clean(n); return line.find((r) => clean(r.name) === k) || line.find((r) => dice(r.name, n) > 0.9) || null; };
    const menuMap = new Map();
    const resolveMenu = (menu, cat) => {
      const mk = (cat || "") + "|" + menu;
      if (menuMap.has(mk)) return menuMap.get(mk);
      const fixed = mapCfg.menu[menu];
      const fromSheet = !fixed && (sheetMenus.find((x) => x.menu === menu && x.cat === cat) || sheetMenus.find((x) => x.menu === menu));
      const sheetRecipe = fromSheet && lineByName(fromSheet.recipe);
      let res = null;
      if (fixed === "skip") res = { skip: true };
      else if (fixed) res = line.find((r) => r.name === fixed) ? { recipe: line.find((r) => r.name === fixed) } : null;
      else if (sheetRecipe) res = { recipe: sheetRecipe, mult: fromSheet.mult, sheet: true };
      else {
        let top = null, sc = 0;
        recipeCands.forEach((r) => [r.short, r.name].forEach((k) => { const v = dice(menu, k); if (v > sc) { sc = v; top = r; } }));
        if (sc >= 0.62) res = { recipe: top, auto: true, sc };
      }
      menuMap.set(mk, res);
      return res;
    };
    // 레시피 1건이 쓰는 품목별 재고단위 (프랩은 Yield로 원재료까지 풀기)
    const yieldOf = (p) => { const s = String(p.yield || ""); const m = /([\d.,]+)\s*(kg|g|l|ml)\b/i.exec(s); if (!m) return null; const v = num(m[1]); const u = m[2].toLowerCase(); return u === "kg" || u === "l" ? v * 1000 : v; };
    const perMenuCache = new Map();
    // "22 g | 1 TB"처럼 무게와 계량(TB·tsp·cup·스쿱)이 같이 적힌 줄 → 1TB 무게 (tbG 설정이 없을 때 씀)
    let tbGMemo = null;
    const pairTbG = () => {
      if (tbGMemo) return tbGMemo;
      const m = new Map(), acc2 = new Map();
      [...line, ...prep].forEach((r) => r.ing.forEach((i) => { const t = resolveIng(i.n), q = parseQty(i.w, ""), c = parseQty("", i.v); if (t && !t.skip && q && q.g && c && c.vol && c.ml) { const k = t.kind + ":" + t.id, a = acc2.get(k) || []; a.push(q.g / (c.ml / 15)); acc2.set(k, a); } }));
      acc2.forEach((a, k) => { a.sort((x, y) => x - y); m.set(k, a[a.length >> 1]); });
      return (tbGMemo = m);
    };
    // 라인 레시피에 "25 g | 6 ea"처럼 무게와 개수가 같이 적힌 프랩 → 1개 무게
    let eaGMemo = null;
    const prepEaG = () => {
      if (eaGMemo) return eaGMemo;
      const m = new Map(), acc2 = new Map();
      line.forEach((r) => r.ing.forEach((i) => { const t = resolveIng(i.n), q = parseQty(i.w, ""), c = parseQty("", i.v); if (t && t.kind === "prep" && q && q.g && c && c.ea) { const a = acc2.get(t.id) || []; a.push(q.g / c.ea); acc2.set(t.id, a); } }));
      acc2.forEach((a, k) => m.set(k, a.reduce((x, y) => x + y, 0) / a.length));
      return (eaGMemo = m);
    };
    function expand(recipe, factor0, acc, depth, prepAcc, batchAcc, m) {
      recipe.ing.forEach((ing) => {
        // 옵션 비율(ing.share): 안맵게처럼 주문 중 일부만 다른 재료로 나가면 그 비율만큼 (inv면 나머지)
        const sv = ing.share ? shareOf(ing.share, m) : null, factor = sv == null ? factor0 : factor0 * (ing.inv ? 1 - sv : sv);
        let q = parseQty(ing.w, ing.v);
        let t = resolveIng(ing.n);
        // 프랩 레시피 재료가 자기 자신으로 적힌 경우(마늘쫑, 루꼴라 등) prepCfg.raw 품목으로
        if (t && t.kind === "prep" && t.id === recipe.name) { const raw = ((db.prepCfg || {})[recipe.name] || {}).raw; t = raw ? { kind: "item", id: raw } : null; }
        if (!t || t.skip || !q) return;
        // 매장에서 잰 1TB 무게 (itemCfg / prepCfg의 tbG): 1 TB = 15ml 기준으로 tsp·cup·스쿱도 같이 환산
        const tbG = (t.kind === "item" ? itemCfg[t.id] : (db.prepCfg || {})[t.id] || {}) || {};
        const tb = tbG.tbG || pairTbG().get(t.kind + ":" + t.id);
        if (q.vol && tb) q = { g: (q.ml / 15) * tb };
        if (t.kind === "item") {
          const it = items.find((i) => i.key === t.id); if (!it) return;
          const s = toStock(q, it.pk); if (s == null) return;
          acc.set(it.key, (acc.get(it.key) || 0) + s * factor);
        } else if (t.kind === "prep" && depth < 2) {
          const p = variantOf("prep", t.id, m) || prepByName.get(t.id); if (!p) return;
          // go: 이 프랩을 f회(1회 = 1X) 만큼 쓴다고 보고 원재료까지 풀기. batchAcc에 프랩별 X를 모음 (배치 계획용)
          const go = (f) => { if (batchAcc) batchAcc.set(p.name, (batchAcc.get(p.name) || 0) + f); expand(p, f, acc, depth + 1, prepAcc, batchAcc, m); };
          const amount = q.g ?? q.ml ?? null;
          // 프랩 사용량: g/ml은 이름 그대로, 포션·개수는 "이름|ea"로 따로 셈 (프랩 안의 프랩도 셈)
          if (prepAcc && amount != null) prepAcc.set(p.name, (prepAcc.get(p.name) || 0) + amount * factor);
          else if (prepAcc && q.ea != null) prepAcc.set(p.name + "|ea", (prepAcc.get(p.name + "|ea") || 0) + q.ea * factor);
          // "1 portion"처럼 개수로 쓴 프랩은 프랩 레시피가 N포션/오더 분량이면 그만큼 나눠 원재료까지 풀기 (어묵 포션 = 어묵 100g)
          const yc = /([\d.]+)\s*(portion|order|ea)\b/i.exec(String(p.yield || ""));
          if (amount == null && q.ea != null && yc && !/약/.test(p.yield)) { go((factor * q.ea) / num(yc[1])); return; }
          // "1,980g (약 15 Portion)"처럼 무게와 포션 수가 같이 있으면 1포션 = 무게 ÷ 포션 수
          if (amount == null && q.ea != null && yc && yieldOf(p)) { go((factor * q.ea) / num(yc[1])); return; }
          // 분량이 "1 Portion"·"약 15 Order"처럼 개수뿐이면 재료 무게 합이 그 한 번 분량 (럭스 포션 → 치킨 다이스 50 g, 소테 새우 15오더 = 새우 800g)
          // 분량이 "As needed"인데 재료 무게가 적힌 포션(버섯 믹스 포션 = 새송이 30g + 느타리 30g)은 레시피 한 번이 1포션
          if (amount == null && q.ea != null && !yc && !yieldOf(p) && p.ing.some((i) => { const q2 = parseQty(i.w, i.v); return q2 && (q2.g || q2.ml); })) { go(factor * q.ea); return; }
          const y = yieldOf(p) || (yc ? p.ing.reduce((a2, i) => { const q2 = parseQty(i.w, i.v) || {}; return a2 + (q2.g || q2.ml || 0); }, 0) : 0);
          // "새우 12 ea"처럼 개수로 쓴 건 다른 라인 레시피의 "25 g | 6 ea"로 1개 무게를 구해 g으로
          const eg = amount == null && q.ea != null ? prepEaG().get(p.name) : null;
          const amt = amount ?? (eg ? q.ea * eg : null);
          if (amt == null) return;
          if (!y) { passThrough(p, factor * amt, acc, depth + 1, prepAcc, batchAcc, m); return; }
          go((factor * amt) / y);
        }
      });
    }
    // 분량이 "As needed"인 프랩(튀긴 통마늘·루꼴라·베이컨 찹·그라나파다노 등)을 g으로 쓴 줄: 프랩 1g = 원재료 1g로 통과
    //  원재료는 prepCfg.raw, 없으면 분량 없이 적힌 첫 재료(튀긴 통마늘 → 보일드 갈릭 → 깐마늘). 양념(스테이크 시즈닝)은 무시
    function passThrough(p, grams, acc, depth, prepAcc, batchAcc, m) {
      const c = (db.prepCfg || {})[p.name] || {};
      if (!(grams > 0) || depth > 3 || c.split) return; // split(커팅비프)은 다른 레시피의 자투리라 원재료를 안 씀 (부족분은 shortOf로)
      const raw = c.raw;
      let t = raw ? { kind: "item", id: raw } : null;
      if (!t) for (const ing of p.ing) { if (parseQty(ing.w, ing.v)) continue; const r = resolveIng(ing.n); if (r && !r.skip && !(r.kind === "prep" && r.id === p.name)) { t = r; break; } }
      if (!t) return;
      if (t.kind === "item") { const it = items.find((i) => i.key === t.id); if (!it) return; const s = toStock({ g: grams }, it.pk); if (s != null) acc.set(it.key, (acc.get(it.key) || 0) + s); return; }
      const p2 = variantOf("prep", t.id, m) || prepByName.get(t.id); if (!p2) return;
      if (prepAcc) prepAcc.set(p2.name, (prepAcc.get(p2.name) || 0) + grams);
      const y2 = yieldOf(p2);
      if (y2) { if (batchAcc) batchAcc.set(p2.name, (batchAcc.get(p2.name) || 0) + grams / y2); expand(p2, grams / y2, acc, depth + 1, prepAcc, batchAcc, m); }
      else passThrough(p2, grams, acc, depth + 1, prepAcc, batchAcc, m);
    }
    function perMenu(recipe, m) {
      const mm = hasVariant(m) || (m && shareCfg.length) ? m : null, ck = recipe.name + (mm ? "|" + mm : "");
      if (perMenuCache.has(ck)) return perMenuCache.get(ck);
      const acc = new Map(), prepAcc = new Map(), batchAcc = new Map();
      expand(variantOf("line", recipe.name, mm) || recipe, 1, acc, 0, prepAcc, batchAcc, mm);
      const v = { acc, prepAcc, batchAcc }; perMenuCache.set(ck, v); return v;
    }
    // 레시피 자기 재료 중 품목만 (프랩 안의 프랩은 그 프랩 배치에서 셈): 1회(1X)당 재고단위
    const directRaw = (recipe) => {
      const m = new Map();
      recipe.ing.forEach((ing) => {
        let q = parseQty(ing.w, ing.v), t = resolveIng(ing.n);
        if (t && t.kind === "prep" && prepByName.get(t.id) === recipe) { const raw = ((db.prepCfg || {})[recipe.name] || {}).raw; t = raw ? { kind: "item", id: raw } : null; }
        if (!t || t.skip || !q || t.kind !== "item") return;
        const tbG = itemCfg[t.id] || {}; if (q.vol && tbG.tbG) q = { g: (q.ml / 15) * tbG.tbG };
        const it = items.find((i) => i.key === t.id); if (!it) return;
        const st = toStock(q, it.pk); if (st != null) m.set(it.key, (m.get(it.key) || 0) + st);
      });
      return m;
    };

    const asOfUsage = (d, it) => { let u = 0; (d.ledger.rows || []).forEach((r) => { const c = itemCfg[r.name]; const to = c && c.as ? items.find((i) => i.key === c.as) : ledgerItem(r); if (to === it && r.usage > 0) u += r.usage; }); return u; };
    // ---------- 옵션 비율 (db.shares) ----------
    // 메뉴별 매출에 안 나오는 선택(안맵게 → 버터라이스, 사이드 중 라이스·매쉬)을 그 달 수불현황으로 거꾸로 구함.
    //  레시피 재료에 share: id(inv: true면 나머지)를 달아 둠. 수불현황이 있는 달마다 따로 맞추고, 앞으로는 최근 3달 가중평균(3:2:1)
    const shareCfg = Array.isArray(db.shares) ? db.shares : [];
    const shareFit = new Map(); let shareOverride = null;
    const futureShare = (id) => {
      const fs = allMonths.filter((m) => shareFit.has(id + "|" + m)).filter((m) => { const n = Object.keys(db.forecast || {}).filter((d) => d.startsWith(m) && num(db.forecast[d].act) > 0).length; return !(n > 0 && n < 14); }).slice(-3);
      if (!fs.length) return null;
      let a = 0, w = 0; fs.forEach((m, i) => { const wi = i + 1 + (3 - fs.length); a += wi * shareFit.get(id + "|" + m); w += wi; });
      return a / w;
    };
    function shareOf(id, m) {
      if (shareOverride && id in shareOverride) return shareOverride[id];
      if (m && shareFit.has(id + "|" + m)) return shareFit.get(id + "|" + m);
      const f = futureShare(id); if (f != null) return f;
      const c = shareCfg.find((x) => x.id === id); return c && c.def != null ? c.def : 0.5;
    }
    // 그 달 메뉴 판매로 한 품목의 레시피 사용량 (캐시 없이, 비율을 바꿔 가며 계산)
    const theoItem = (m, key) => {
      const d = mget(m); if (!d.sales) return 0; const acc = new Map();
      d.sales.rows.forEach((s) => { if (COUPON.test(s.cat) && !mapCfg.menu[s.menu]) return; const r = resolveMenu(s.menu, s.cat); if (!r || r.skip) return; expand(variantOf("line", r.recipe.name, m) || r.recipe, s.qty * (r.mult || 1), acc, 0, null, null, m); });
      return acc.get(key) || 0;
    };
    shareCfg.forEach((c) => {
      const it = items.find((i) => i.key === c.item); if (!it) return;
      allMonths.forEach((m) => {
        const d = mget(m); if (!d.ledger || !d.sales) return;
        const a = asOfUsage(d, it); if (!(a > 0)) return;
        shareOverride = { [c.id]: 0 }; const t0 = theoItem(m, it.key);
        shareOverride = { [c.id]: 1 }; const t1 = theoItem(m, it.key);
        shareOverride = null;
        if (Math.abs(t1 - t0) < 1e-6) return;
        shareFit.set(c.id + "|" + m, Math.min(1, Math.max(0, (a - t0) / (t1 - t0))));
      });
    });
    perMenuCache.clear();

    // 월별 A(실사), B(레시피) 사용량
    const monthRows = allMonths.map((m) => {
      const d = mget(m);
      const gross = num(d.gross) || grossFromForecast(m);
      const actual = new Map();
      // itemCfg.as: 예전 코드의 사용량을 지금 품목으로 합침 (설도 200g → 부채살 220g, g 기준으로 환산)
      const asOf = (r) => { const c = itemCfg[r.name]; const to = c && c.as && items.find((i) => i.key === c.as); if (!to) return null; const gOf = (n) => { const m = /([\d.]+)\s*(kg|g)\b/i.exec(n); return m ? num(m[1]) * (m[2].toLowerCase() === "kg" ? 1000 : 1) : 0; }; const f = gOf(r.name) && (to.pk.g || gOf(to.name)) ? gOf(r.name) / (to.pk.g || gOf(to.name)) : 1; return { it: to, f }; };
      if (d.ledger) d.ledger.rows.forEach((r) => { const a = asOf(r); const it = a ? a.it : ledgerItem(r); if (it && r.usage > 0) actual.set(it.key, (actual.get(it.key) || 0) + r.usage * (a ? a.f : 1)); });
      let theo = null, prepUse = null, menuQty = 0, menuMapped = 0;
      const recQ = new Map(), extra = new Map();
      if (d.sales && line.length) {
        theo = new Map(); prepUse = new Map();
        d.sales.rows.forEach((s) => {
          if (COUPON.test(s.cat) && !mapCfg.menu[s.menu]) return; // 연결 안 한 쿠폰은 메뉴 수에도 안 셈
          menuQty += s.qty;
          const r = resolveMenu(s.menu, s.cat); if (!r || r.skip) return;
          menuMapped += s.qty;
          const pm = perMenu(r.recipe, m), q = s.qty * (r.mult || 1);
          pm.acc.forEach((v, k) => theo.set(k, (theo.get(k) || 0) + v * q));
          pm.prepAcc.forEach((v, k) => prepUse.set(k, (prepUse.get(k) || 0) + v * q));
          const rq = recQ.get(r.recipe.name); recQ.set(r.recipe.name, { recipe: r.recipe, q: (rq ? rq.q : 0) + q });
        });
        // 커팅비프 부족분은 부채살로: prepCfg의 shortOf 품목 사용량을 레시피 계산(B)에 더함
        Object.values(db.prepCfg || {}).forEach((c) => {
          const sp = c.shortOf && ((db.prepCfg || {})[c.shortOf] || {}).split; const it = sp && items.find((i) => i.key === c.item);
          if (!it) return;
          const n = d.sales.rows.reduce((a, r) => { const x = resolveMenu(r.menu, r.cat); return a + (x && x.recipe && x.recipe.name.startsWith(sp.from) ? r.qty * (x.mult || 1) : 0); }, 0);
          const need = (prepUse.get(c.shortOf) || 0) + (prepUse.get(c.shortOf + "|ea") || 0) * (sp.portion || 110);
          const halves = Math.max(0, need - n * sp.g) / (sp.portion || 110);
          if (halves) { theo.set(it.key, (theo.get(it.key) || 0) + halves / (c.per || 2)); extra.set(it.key, (extra.get(it.key) || 0) + halves / (c.per || 2)); }
        });
      }
      return { m, gross, days: daysInMonth(m), actual: d.ledger ? actual : null, theo, prepUse, menuQty, menuMapped, recQ, extra };
    });
    // 영업일이 14일 안 되는 달(개점한 8월 4일치)은 첫 재고를 채운 양이 섞여서 사용량·로스 계산에서 뺌 (지금 진행 중인 달은 씀). 채점에는 그대로 씀
    const lastM = monthRows.length ? monthRows[monthRows.length - 1].m : "";
    const openDays = (m) => Object.keys(db.forecast || {}).filter((d) => d.startsWith(m) && num(db.forecast[d].act) > 0).length;
    const full = (r) => r.m === lastM || !(openDays(r.m) > 0 && openDays(r.m) < 14);
    const withAAll = monthRows.filter((r) => r.actual && r.gross > 0);
    const withA = withAAll.filter(full);
    const withB = monthRows.filter((r) => r.theo && r.gross > 0 && full(r));
    // 로스 계수 = 실제 ÷ 레시피의 중앙값 (짝수 개면 가운데 둘 평균). before를 주면 그 달 전까지만 (채점할 때 그 달 실제를 미리 보지 않게)
    const lossOf = (key, before) => {
      const rs = withB.filter((r) => !before || r.m < before).map((r) => { const t = r.theo.get(key), a = r.actual && r.actual.get(key); return t && a ? a / t : null; }).filter((x) => x && x > 1 / 3 && x < 3).sort((x, y) => x - y);
      if (!rs.length) return 1;
      const h = rs.length >> 1; return rs.length % 2 ? rs[h] : (rs[h - 1] + rs[h]) / 2;
    };
    // B를 최근 3개월 메뉴 판매로 (3:2:1). 최근 달에 팔린 메뉴만, 그 메뉴가 팔린 달끼리 평균 → 10월에 새로 생긴 메뉴는 10월만, 라자냐처럼 계속 판 메뉴는 8·9월도 반영
    // blend.theo / blend.prep: Gross 100만원당 사용량
    const blend = { theo: new Map(), prep: new Map(), batchX: new Map(), recipeRate: [] };
    if (withB.length) {
      const recent = withB.slice(-3), wOf = (i) => i + 1 + (3 - recent.length);
      const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
      recent[recent.length - 1].recQ.forEach(({ recipe }, name) => {
        let wq = 0, wg = 0;
        recent.forEach((r, i) => { const x = r.recQ.get(name); if (x) { wq += wOf(i) * x.q; wg += wOf(i) * r.gross / 1e6; } });
        if (!wg) return;
        const pm = perMenu(recipe), rate = wq / wg;
        pm.acc.forEach((v, k) => add(blend.theo, k, v * rate));
        pm.prepAcc.forEach((v, k) => add(blend.prep, k, v * rate));
        pm.batchAcc.forEach((v, k) => add(blend.batchX, k, v * rate)); // 프랩별 Gross 100만원당 X
        blend.recipeRate.push({ recipe, rate });
      });
      // 커팅비프 부족분(부채살)은 달 단위라 달별 Gross 비율로
      const wsum = recent.reduce((a, r, i) => a + wOf(i) * r.gross / 1e6, 0);
      recent.forEach((r, i) => r.extra.forEach((v, k) => add(blend.theo, k, wOf(i) * v / wsum)));
    }

    // 주말 배수 (날짜별 메뉴 판매로): MIS에서 불러온 menuDay.날짜(최근 4주) → 레시피마다 주말·평일 Gross 100만원당 판매
    //  → 품목마다 (주말 100만원당 사용) ÷ (평일 100만원당 사용). 플래터·브런치처럼 주말에 몰리는 메뉴의 재료가 다 같이 올라감
    //  주말 2일·평일 3일 이상 있을 때만. 날이 적으면 1 쪽으로 당김 (주말 일수 n ÷ (n+2)), 0.8~2.0
    const weMenu = new Map();
    (() => {
      const fc = db.forecast || {}, from = addDays(TODAY, -28);
      const ds = Object.keys(db).filter((k) => k.startsWith("menuDay.")).map((k) => k.slice(8)).filter((d) => d >= from && d < TODAY && num((fc[d] || {}).act) > 0 && Array.isArray((db["menuDay." + d] || {}).rows));
      const W = ds.filter(isWE), D = ds.filter((d) => !isWE(d));
      if (W.length < 2 || D.length < 3) return;
      const g = (xs) => xs.reduce((a, d) => a + num(fc[d].act), 0) / 1e6, gW = g(W), gD = g(D);
      const q = new Map(); // 레시피 이름 → { recipe, w, d }
      ds.forEach((d) => db["menuDay." + d].rows.forEach((r) => {
        if (COUPON.test(r.c) && !mapCfg.menu[r.m]) return;
        const x = resolveMenu(r.m, r.c); if (!x || x.skip || !x.recipe) return;
        const e = q.get(x.recipe.name) || { recipe: x.recipe, w: 0, d: 0 }; e[isWE(d) ? "w" : "d"] += num(r.q) * (x.mult || 1); q.set(x.recipe.name, e);
      }));
      const uW = new Map(), uD = new Map(), add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
      // 커팅비프(부채살 반쪽)처럼 프랩 부족분을 품목으로 채우는 경우: 그 프랩 사용량을 그 품목 몫으로 (prepCfg.shortOf)
      const shortTo = Object.values(db.prepCfg || {}).filter((c) => c.shortOf && c.item).map((c) => ({ prep: c.shortOf, item: c.item, per: (((db.prepCfg || {})[c.shortOf] || {}).split || {}).portion || 110 }));
      q.forEach(({ recipe, w, d }) => {
        const pm = perMenu(recipe);
        pm.acc.forEach((v, k) => { add(uW, k, v * w / gW); add(uD, k, v * d / gD); });
        shortTo.forEach((t) => { const v = (pm.prepAcc.get(t.prep) || 0) / t.per + (pm.prepAcc.get(t.prep + "|ea") || 0); if (v) { add(uW, t.item, v * w / gW); add(uD, t.item, v * d / gD); } });
      });
      const n = W.length, wt = n / (n + 2), sh = gW / (gW + gD); // sh: 주말 매출 몫
      uW.forEach((w, k) => {
        const d = uD.get(k) || 0; if (!(w > 0 && d > 0)) return;
        const r = Math.min(2, Math.max(0.6, 1 + (w / d - 1) * wt)), base = sh * r + (1 - sh); // r = 주말÷평일
        weMenu.set(k, { we: r / base, wd: 1 / base });
      });
      weMenu.days = { we: W.length, wd: D.length };
    })();

    // 품목별 계산 재료
    items.forEach((it) => {
      // A: 최근 3개월, 최근 달 비중 3:2:1
      const recent = withA.slice(-3);
      let wu = 0, wg = 0;
      recent.forEach((r, i) => { const w = i + 1 + (3 - recent.length); const u = r.actual.get(it.key); if (u != null) { wu += w * u; wg += w * r.gross / 1e6; } });
      it.rateA = wg > 0 && wu > 0 ? wu / wg : null;
      // D: 3개월 이상이면 고정량 + 비례량 (최소제곱, 둘 다 0 이상일 때만)
      it.fixedA = 0;
      const pts = withA.slice(-6).map((r) => ({ d: r.days, g: r.gross / 1e6, u: r.actual.get(it.key) || 0 })).filter((p) => p.u > 0);
      if (pts.length >= 3) {
        let a = 0, b = 0, c = 0, e = 0, f = 0;
        pts.forEach((p) => { a += p.d * p.d; b += p.d * p.g; c += p.g * p.g; e += p.d * p.u; f += p.g * p.u; });
        const det = a * c - b * b;
        if (Math.abs(det) > 1e-9) { const fx = (e * c - b * f) / det, rt = (a * f - b * e) / det; if (fx >= 0 && rt > 0) { it.fixedA = fx; it.rateA = rt; } }
      }
      // B: 가장 최근 판매 달의 메뉴 비율 × 레시피, 이전 달들의 실제÷이론으로 로스 계수
      const lastB = withB[withB.length - 1];
      const tb = lastB && lastB.theo.get(it.key);
      it.rateB = tb ? blend.theo.get(it.key) || tb / (lastB.gross / 1e6) : null;
      it.loss = lossOf(it.key);
      if (it.rateB != null) it.rateB *= it.loss;
      it.weKm = weMenu.has(it.key) ? weMenu.get(it.key) : null; // { we, wd }
      // 최근 달 실제가 레시피의 3배 넘게 차이 나면 레시피 밖 사용(튀김기름 등)이나 단위 문제라 B를 안 씀
      const aLast = lastB && lastB.actual && lastB.actual.get(it.key);
      if (tb && aLast && (aLast / (tb * it.loss) > 3 || aLast / (tb * it.loss) < 1 / 3)) it.rateB = null;
      // 최근 달 수불현황이 아직 없으면(월 중간) A와 B를 직접 비교해서 3배 넘게 차이 나면 B를 안 씀
      if (it.rateB != null && it.rateA != null && (it.rateA / it.rateB > 3 || it.rateA / it.rateB < 1 / 3)) it.rateB = null;
      // E: 지난 달들로 A·B 채점 → 오차 제곱 역수로 비중
      const errA = [], errB = [];
      it.ledgerScores = [];
      withA.forEach((r, idx) => {
        const act = r.actual.get(it.key); if (!act) return;
        const prev = withA.slice(Math.max(0, idx - 3), idx);
        const lossB = lossOf(it.key, r.m);
        let pu = 0, pg = 0; prev.forEach((p) => { const u = p.actual.get(it.key); if (u) { pu += u; pg += p.gross / 1e6; } });
        if (pg > 0) errA.push((pu / pg * r.gross / 1e6 - act) / act);
        const t = r.theo && r.theo.get(it.key); if (t) errB.push((t * lossB - act) / act);
        // 수불현황 월 채점: 그 달 실제 사용량 vs 그 전 달까지 데이터로 했을 예상 (B는 전 달 메뉴 비율)
        const qb = monthRows.filter((x) => x.theo && x.gross > 0 && x.m < r.m).pop(), tq = qb && qb.theo.get(it.key);
        const pA = pg > 0 ? pu / pg * r.gross / 1e6 : null, pB = tq ? tq / (qb.gross / 1e6) * (r.gross / 1e6) * lossB : null;
        if (pA != null || pB != null) it.ledgerScores.push({ m: r.m, actual: act, pA, pB });
      });
      it.errA = errA; it.errB = errB;
      it.isNew = it.rateA == null && it.rateB != null;
    });
    const shares = shareCfg.map((c) => ({ ...c, now: shareOf(c.id, null), byMonth: allMonths.filter((m) => shareFit.has(c.id + "|" + m)).map((m) => ({ m, v: shareFit.get(c.id + "|" + m) })) }));
    cache = { items, line, prep, prepSheet, monthRows, withA, withB, blend, resolveMenu, resolveIng, ingCands, perMenu, directRaw, mapCfg, shares, pairTbG, yieldOf };
    applyScores(cache);
    return cache;
  }
  function daysInMonth(m) { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); }
  function grossFromForecast(m) {
    const f = db.forecast || {}; let s = 0, n = 0;
    Object.keys(f).forEach((d) => { if (d.startsWith(m)) { const a = num(f[d].act); if (isFinite(a)) { s += a; n++; } } });
    // 이번 달은 월말 전이라도 실제 Gross가 7일 넘게 있으면 그 합으로 (월 중간에 올린 메뉴별 매출현황용)
    return n >= daysInMonth(m) - 1 || (m === TODAY.slice(0, 7) && n >= 7) ? s : 0;
  }

  // ---------- Forecast 값 ----------
  function dayGross(d, preferActual) {
    const f = (db.forecast || {})[d] || {};
    if (preferActual && isFinite(num(f.act))) return { v: num(f.act), src: "act" };
    if (isFinite(num(f.fc))) return { v: num(f.fc) * fcBias(d).k, src: "fc" };
    // 없으면 데이터 예상 Forecast (같은 요일·공휴일 실적), 그것도 없으면 최근 달 평균
    const de = dataForecast(d);
    if (de) return { v: de, src: "est" };
    const ms = months().map((m) => ({ m, g: num(mget(m).gross) })).filter((x) => x.g > 0);
    if (ms.length) { const x = ms[ms.length - 1]; return { v: x.g / daysInMonth(x.m), src: "est" }; }
    return { v: 0, src: "none" };
  }
  const sumGross = (from, toExcl, preferActual) => { let s = 0, est = 0; for (let d = from; d < toExcl; d = addDays(d, 1)) { const g = dayGross(d, preferActual); s += g.v; if (g.src !== "fc" && g.src !== "act") est++; } return { s, est }; };

  // ---------- 발주 기간 ----------
  function orderWindow(today) {
    const deliv = delivery(today);
    const nextDeliv = delivery(addBiz(today, 1));
    const end = addDays(nextDeliv, 0); // 다음 입고 전날까지 → [today, nextDeliv)
    const days = Math.round((parseISO(end) - parseISO(today)) / 864e5);
    const g = sumGross(today, end, false), nEff = effDays(today, end);
    const covered = [];
    for (let d = deliv; d < nextDeliv; d = addDays(d, 1)) covered.push(DOW[dow(d)]);
    return { today, deliv, nextDeliv, end, days, nEff, gross: g.s, est: g.est, covered, wkGross: wkGross(deliv, end), weGross: weSum(today, end, false), fcVar: fcVar(today, end, false) };
  }
  // 주말 여유분: 입고 뒤 토·일 매출(이 발주가 맡는 주말)에 KM이 정한 비율만큼 사용량을 더 잡음 (settings.weekendPlus, 기본 25%)
  const wkGross = (from, toExcl) => { let s = 0; for (let d = from; d < toExcl; d = addDays(d, 1)) if (dow(d) === 0 || dow(d) === 6) s += dayGross(d, false).v; return s; };
  const weekendPlus = () => { const v = num((db.settings || {}).weekendPlus); return isFinite(v) ? Math.max(0, v) / 100 : 0.25; };
  // 매출이 며칠에 몰려 있는지 반영한 "실제 일수": (합)² ÷ 제곱합. 목~일(300·900·1700·1400만)이면 4일이 아니라 3.2일
  //  주말 하루하루 오차가 크니 안전재고가 덜 깎이게
  function effDays(from, toExcl) {
    let a = 0, b = 0; for (let d = from; d < toExcl; d = addDays(d, 1)) { const v = dayGross(d, false).v; a += v; b += v * v; }
    return b > 0 ? (a * a) / b : 1;
  }

  // 업체별 발주 요일·입고 (시트 vendorCfg): {"세제": {days:[1], lead:2, note:"택배"}} = 월요일만 발주, 2영업일 뒤 택배 도착
  const vcfg = (it) => ((db.vendorCfg || {})[it && it.vendor] || {});
  const deliveryOf = (it, x) => addBiz(x, vcfg(it).lead || 2);
  const isOrderDay = (it, d) => { const ds = vcfg(it).days; return !ds || ds.includes(dow(d)); };
  const nextOrderDay = (it, d) => { let x = d; for (let k = 0; k < 8 && !isOrderDay(it, x); k++) x = addDays(x, 1); return x; };
  // 해동이 필요한 품목은 다음 발주분도 입고 다음 날부터 쓸 수 있으니 기간을 해동 일수만큼 늘림
  function orderWindowFor(it, today) {
    const w = orderWindowBase(it, today), t = it.thaw || 0;
    if (!t) return w;
    const end = addDays(w.end, t), g = sumGross(today, end, false);
    // 주말 여유분은 이 발주분을 쓸 수 있는 날(입고 다음 날)부터: 목요일 발주 해동 품목은 토요일을 수요일 발주가 맡으니 토요일 이중 계산 방지
    return { ...w, end, days: w.days + t, gross: g.s, est: g.est, nEff: effDays(today, end), wkGross: wkGross(addDays(w.deliv, t), end), fcVar: fcVar(today, end, false) };
  }
  function orderWindowBase(it, today) {
    const c = vcfg(it);
    if (!c.days && !c.lead) return { ...orderWindow(today), orderDay: today, canOrder: true };
    // 다음 발주일 주문이 다음다음 발주일 주문 입고 전까지 버텨야 함 → [오늘, 다음다음 입고)
    const o1 = nextOrderDay(it, today), o2 = nextOrderDay(it, addDays(o1, 1));
    const deliv = deliveryOf(it, o1), nextDeliv = deliveryOf(it, o2);
    const days = Math.round((parseISO(nextDeliv) - parseISO(today)) / 864e5);
    const g = sumGross(today, nextDeliv, false);
    return { today, deliv, nextDeliv, end: nextDeliv, days, nEff: effDays(today, nextDeliv), gross: g.s, est: g.est, covered: [], orderDay: o1, canOrder: o1 === today, wkGross: wkGross(deliv, nextDeliv), weGross: weSum(today, nextDeliv, false), fcVar: fcVar(today, nextDeliv, false) };
  }

  // ---------- C: 최종 발주량 ----------
  const Z = 1.65;
  function calc(it, win, s, inc) {
    const g100 = win.gross / 1e6;
    const useA = it.rateA != null ? it.fixedA * win.days + it.rateA * g100 : null;
    const useB = it.rateB != null ? it.rateB * g100 : null;
    let use, wA = 0.5;
    if (it.recipeOnly && useB != null) { use = useB; wA = 0; }
    else if (useA != null && useB != null) {
      const mse = (arr) => arr.length >= 2 ? arr.slice(-6).reduce((a, e) => a + e * e, 0) / Math.min(arr.length, 6) : null;
      const ea = mse(it.scoreA.length ? it.scoreA : it.errA), eb = mse(it.scoreB.length ? it.scoreB : it.errB);
      if (ea != null && eb != null && ea + eb > 0) wA = Math.min(0.85, Math.max(0.15, (1 / Math.max(ea, 1e-4)) / (1 / Math.max(ea, 1e-4) + 1 / Math.max(eb, 1e-4))));
      use = wA * useA + (1 - wA) * useB;
    } else use = useA ?? useB ?? (it.rateG != null ? it.rateG * g100 : null);
    if (use == null) return { none: true };
    use *= it.useK * weMix(it, win);
    const spread = useA != null && useB != null && !it.recipeOnly ? Math.abs(useA - useB) / Math.max(useA, useB) : null;
    // F: 안전재고 = 1.65 × 상대오차 × 사용량 ÷ √일수 (하루 오차 표준편차 × √일수와 같음)
    //  상대오차 = 사용량 계산 오차와 Forecast 오차를 같이 (86 위험 범위와 같은 기준). 일수는 매출이 몰린 만큼 줄여 셈
    const errs = it.scoreF.length >= 5 ? it.scoreF : null; // 채점 5번부터 (적으면 한두 번 튄 값에 끌려감)
    // 재고는 통 단위로 세고 뜯은 건 안 세기도 해서(3개 → 2개), 채점 오차에는 셈 단위 잡음이 섞임 → 그만큼(scoreQ) 빼고 σ로
    const qs = (it.scoreQ || []).slice(-8), q = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 0;
    const sigma = errs ? Math.sqrt(Math.max(0.01, errs.slice(-8).reduce((a, e) => a + e * e, 0) / Math.min(errs.length, 8) - q)) : Math.max(0.1, (spread ?? 0.2) / 2, useA == null && useB == null ? 0.25 : 0);
    const nd = Math.max(1, Math.min(win.days, win.nEff || win.days));
    // 프랩 배치: 소스·드레싱 원재료는 프랩하는 날 통째로 나가니, 이 기간에 돌아오는 배치만큼 평균 사용량을 고쳐 잡고, 배치 시점 불확실성은 여유분에 더함
    const ba = batchAdj(it, win), useAvg = use;
    if (ba) use = Math.max(0, use + ba.delta);
    // Forecast 오차: 기간의 날별 오차 합(fcVar, 평일·주말 따로) → 상대값. 없으면 예전처럼 하루 오차 ÷ √일수
    const fcRel = win.fcVar != null && win.gross > 0 ? Math.sqrt(win.fcVar) / win.gross : fcErr() / Math.sqrt(nd);
    const relErr = Math.sqrt(sigma * sigma / nd + fcRel * fcRel); // 기간 사용량의 상대 오차 (사용량 계산 오차는 날마다 상쇄, Forecast 오차는 날별 합)
    let ss = Z * Math.sqrt((relErr * useAvg) ** 2 + (ba ? ba.varS : 0));
    const wkPlus = win.wkGross > 0 && win.gross > 0 ? weekendPlus() * useAvg * Math.min(1, win.wkGross / win.gross) : 0;
    ss += wkPlus;
    let need = use + ss;
    if (it.shelf) need = Math.min(need, (useAvg / win.days) * it.shelf);
    const short = need - s - inc;
    const mult = it.pk.mult || 1;
    // "10개단위 발주"처럼 묶음 단위면 반올림 (반올림해서 0이어도 여유분 빼고 모자라면 1묶음)
    // 묶음 단위는 반올림하되, 예상 사용량(안전재고 뺀 것)만큼은 항상 채움
    let packs = short <= 0 ? 0 : mult > 1 ? Math.max(Math.round(short / mult), Math.ceil((use - s - inc) / mult - 1e-9), 0) : Math.ceil(short - 1e-9);
    if (packs > 0 && it.min && packs < it.min) packs = it.min;
    // "10개단위 발주"처럼 단위가 같으면 배수만큼 곱해서 보여줌 (예: 20 EA)
    const orderQty = it.pk.sameUnit ? packs * mult : packs;
    // sd: 이번 기간 사용량의 예상 범위 (± 1 표준편차) = 계산 오차 + Forecast 오차 (하루하루 오차는 기간이 길수록 서로 상쇄)
    // ± 범위(카드·리포트·86 위험)는 평균 사용량 기준 예측 오차만. 프랩 배치가 이번 기간에 드는지 아닌지는 오차가 아니라 덩어리라 여유분(ss)에만 넣음
    const sd = useAvg * relErr;
    return { use, useAvg, useA, useB, wA, spread, ss, sd, need, short, packs, orderQty, batch: ba, wkPlus, fcRel, sigma };
  }

  // ---------- 프랩 배치 계획 ----------
  // 소스·드레싱·오일처럼 한 번에 만드는 프랩의 원재료는 매출에 비례해 조금씩 나가지 않고 프랩하는 날 2X·4X가 통째로 나감.
  // 프랩마다 Gross 100만원당 X(레시피 1회 분량), 배치 크기(쉘프라이프 절반 동안 쓸 양, 0.5X 단위, 최소 1X), 마지막 프랩 재고(프랩 탭 기록)로
  // 앞으로 14일 중 어느 날 몇 X 만드는지 추정 → 발주 기간에 드는 배치만큼 원재료 필요량을 고침. 프랩 재고 기록이 없으면 주기로만 봄
  const PLAN_DAYS = 14;
  function prepPlan(M) {
    if (M.plan) return M.plan;
    const yieldG = (p) => { const m = /([\d.,]+)\s*(kg|g|l|ml)\b/i.exec(String(p.yield || "")); if (!m) return null; const v = num(m[1]); return /^(kg|l)$/i.test(m[2]) ? v * 1000 : v; };
    const yn = (p) => { const m = /([\d.]+)\s*(portion|order|ea|개|인분)/i.exec(String(p.yield || "")); return m ? num(m[1]) : null; };
    // 프랩 탭 기록(prepLog·prepOnhand)의 id ↔ PDF 레시피: 프랩 탭과 같은 연결
    const pm = db.prepMap || {}, fwd = new Map();
    M.prepSheet.forEach((x) => { const mp = pm[x.name]; const pdf = (mp && M.prep.find((p) => p.name === mp)) || M.prep.find((p) => (x.code && p.code === x.code) || dice(toKo(p.name), x.name) > 0.75); if (pdf && !fwd.has(pdf.name)) fwd.set(pdf.name, { id: (x.code ? x.code + " " : "") + x.name, ko: x.name }); });
    const plan = [];
    M.prep.forEach((p) => {
      const cfg = (db.prepCfg || {})[p.name] || {};
      const raw = M.directRaw(p); if (!raw.size) return;
      if (/thawing|portion/i.test(p.name) || cfg.rate || cfg.from || /^(EA|포션|g|PK|kg|CAN|단)$/.test(cfg.unit || "")) return;
      const yg = yieldG(p), n = yn(p), y = String(p.yield || "");
      if (!(cfg.unit === "X" || cfg.batch || yg || (n > 1 && /order/i.test(y)))) return;
      const xPerM = M.blend.batchX.get(p.name) || 0; if (!(xPerM > 0)) return;
      // 주기: 쉘프라이프 절반 (prepCfg.cycle 일수로 바꿀 수 있음). 배치 크기: 주기 동안 쓸 양 (prepCfg.batchX로 "항상 2X"처럼 고정 가능)
      const shelf = p.shelf || 2, cyc = cfg.cycle > 0 ? cfg.cycle : shelf > 1 ? Math.min(3.5, shelf / 2) : 1;
      const xOf = (d) => xPerM * dayGross(d, true).v / 1e6;
      const sumX = (from, days) => { let t = 0; for (let k = 0; k < Math.ceil(days); k++) t += xOf(addDays(from, k)) * Math.min(1, days - k); return t; };
      const stepX = cfg.step && n && /order/i.test(y) ? cfg.step / n : 0.5; // 라자냐 5오더 = 0.5X, 그 밖엔 0.5X 단위
      const roundUp = (v) => Math.max(stepX, Math.ceil(v / stepX - 1e-9) * stepX);
      const batchAt = (d) => (cfg.batchX > 0 ? cfg.batchX : roundUp(Math.max(sumX(d, cyc), Math.min(1, sumX(d, shelf)))));
      // "오늘 만들어야 하는지": 오늘 쓸 양 + 내일 반나절치(내일 런치까지)가 안 되면 한 배치. 떨어지기 하루쯤 전에 미리 만드는 실제 습관에 맞춤
      const target = (d) => xOf(d) + (shelf > 1 ? 0.5 * xOf(addDays(d, 1)) : 0);
      const ordUnit = n && /order/i.test(y) && cfg.unit !== "X", unit = ordUnit ? "오더" : "X", f = ordUnit ? 1 / n : 1; // 프랩 탭이 오더로 세는 프랩은 X로
      const m = fwd.get(p.name), id = m ? m.id : p.short || p.name, ko = m ? m.ko : p.short || p.name;
      // 프랩 탭 기록(prepLog: 그날 재고 s + 만든 양 need, 단위 u): 지난 14일 것, 단위가 지금과 같은 것만 (식스·나인으로 세던 날은 뺌). 날마다 마지막 기록
      const byDay = new Map();
      (db.prepLog || []).filter((l) => l.id === id && l.u === unit && l.t.slice(0, 10) <= TODAY && l.t.slice(0, 10) >= addDays(TODAY, -PLAN_DAYS)).sort((a, b) => (a.t < b.t ? -1 : 1)).forEach((l) => byDay.set(l.t.slice(0, 10), l));
      const days = [...byDay.keys()], d0 = days[0] || null, dLast = days[days.length - 1] || null;
      // 첫 기록부터 앞으로 14일까지 하루씩: 기록이 있는 날은 그 재고(+만든 양)로 맞추고, 없는 날은 아침에 오늘 쓸 양이 모자라면 배치
      let events = null;
      if (d0) {
        events = []; let st = 0;
        for (let d = d0; d < addDays(TODAY, PLAN_DAYS); d = addDays(d, 1)) {
          const l = byDay.get(d);
          if (l) { st = num(l.s) * f; const made = (num(l.need) || 0) * f; if (made > 0) { st += made; events.push({ d, x: made }); } }
          if (st < target(d)) { const bx = batchAt(d); st += bx; events.push({ d, x: bx }); } // 모자라면 한 배치 (기록한 날도 만든 양이 모자라면)
          st = Math.max(0, st - xOf(d));
        }
      }
      const batchX = batchAt(TODAY), xd = sumX(TODAY, 7) / 7, cycEff = xd > 0 ? Math.max(1, Math.min(shelf, batchX / xd)) : cyc;
      plan.push({ p, id, ko, raw, xPerM, shelf, batchX, cycEff, events, d0, knownUntil: dLast ? addDays(dLast, shelf) : null });
    });
    return (M.plan = plan);
  }
  // 품목의 발주 기간 배치 보정: Σ (기간에 드는 배치 X − 평균 X) × 1X당 원재료
  //  프랩 재고를 아는 동안(마지막 기록 + 쉘프라이프)은 추정한 배치 날짜로, 모르면 평균대로 두고 "배치가 하나 더 들 수 있는" 만큼을 여유분 분산(varS)에 넣음
  //  배치가 기간 밖이면 사용량이 줄지만 평균의 30%는 남김 (프랩 재고 기록이 틀렸을 때 대비)
  function batchAdj(it, win) {
    const M = cache; if (!M || !win.today) return null;
    let delta = 0, varS = 0, any = false; const notes = [];
    const W = Math.max(0, win.days), end = addDays(win.today, Math.ceil(W));
    prepPlan(M).forEach((pl) => {
      const per = pl.raw.get(it.key); if (!per) return;
      any = true;
      const avgX = pl.xPerM * win.gross / 1e6, bRaw = pl.batchX * per;
      if (pl.events && pl.d0 && win.today >= pl.d0 && win.today <= pl.knownUntil) {
        let bx = 0, d = null; pl.events.forEach((e) => { if (e.d >= win.today && e.d < end) { bx += e.x; if (!d) d = e.d; } });
        delta += Math.max(-0.7 * avgX, bx - avgX) * per * (it.loss || 1); varS += (0.25 * bRaw) ** 2;
        if (bx > 0) notes.push({ ko: pl.ko, x: bx, d });
      } else { const r = W / pl.cycEff, fr = r - Math.floor(r); varS += fr * (1 - fr) * bRaw * bRaw; }
    });
    if (!any) return null;
    notes.sort((a, b) => b.x - a.x);
    return { delta, varS, notes };
  }
  // 품목이 프랩 배치로 쓰이면 한 배치 원재료 양 (채점 묶음 기준)
  const batchRawOf = (M, it) => prepPlan(M).reduce((a, pl) => Math.max(a, (pl.raw.get(it.key) || 0) * pl.batchX), 0);
  // 프랩 레시피 한 번에 들어가는 원재료 양 (재고 단위). 생새우처럼 유수해동해서 바로 프랩하는 품목은 이만큼씩 한꺼번에 줄어듦 (소테 새우 = 생새우 4PK)
  const prepRawOf = (M, it) => {
    if (!M.prepRaw) { M.prepRaw = new Map(); M.prep.forEach((pr) => pr.ing.forEach((i) => { const t = M.resolveIng(i.n), q = parseQty(i.w, i.v); if (!t || t.kind !== "item" || !q || q.vol) return; const x = M.items.find((y) => y.key === t.id); const v = x && toStock(q, x.pk); if (v > 0) M.prepRaw.set(x.key, Math.max(M.prepRaw.get(x.key) || 0, v)); })); }
    return M.prepRaw.get(it.key) || 0;
  };

  // ---------- G: 재고채점 ----------
  const hourOf = (t) => { const m = /\s(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] + +m[2] / 60 : 10; };
  // 미트카운트(10/26 KM): 영업 끝나고 센 재고를 다음 날 새벽에 적음 → 10시 전에 넣은 재고 = 전날 마감 재고(그날 입고 전)
  const MEAT_H = 10;
  const isMeat = (t) => hourOf(t) < MEAT_H; // 시각을 모르면 10시로 봄 = 미트카운트 아님
  const logOn = (it, d) => (db.onhand || []).filter((l) => l.k === it.key && l.t.startsWith(d)).pop();
  const meatOn = (it, d) => { const l = logOn(it, d); return l ? isMeat(l.t) : false; };
  // 두 재고 사이 입고: x(또는 그 전날 마감) 뒤 ~ d. 미트카운트로 센 날의 입고는 센 뒤에 들어옴
  function arrBetween(it, x, xMeat, d, dMeat) {
    let q = 0; const lo = xMeat ? addDays(x, -1) : x;
    for (let j = 0; j <= 21; j++) arrivalsOf(it, addDays(d, -j)).forEach((a) => { if (a.d > lo && (dMeat ? a.d < d : a.d <= d)) q += a.q; });
    return q;
  }
  // 그 시각에 센 재고 뒤로 그날 남은 영업 비율 (오픈 전·발주 마감 전 = 1, 마감 뒤 = 0)
  // 시간대별 매출 비율(시트 hourShare: 요일 묶음별 "N시까지 누적 비율"). 없으면 영업시간에 비례
  //  hourCum(d, hh) = 그날 매출 중 hh시까지 팔린 비율, hourAt(d, f) = 누적 비율 f에 닿는 시각
  const hourProf = (d) => { const hs = db.hourShare || {}, w = dow(d); const g = hs[w === 0 ? "sun" : w === 6 ? "sat" : "wd"]; return g && g.ends && g.cum && g.ends.length === g.cum.length ? g : null; };
  function hourCum(d, hh) {
    const g = hourProf(d);
    if (!g) return Math.min(1, Math.max(0, (hh - OPEN_H) / (CLOSE_H - OPEN_H)));
    let prev = 0, pe = OPEN_H;
    for (let k = 0; k < g.ends.length; k++) { const e = g.ends[k], c = g.cum[k]; if (hh <= e) return prev + (c - prev) * Math.max(0, hh - pe) / Math.max(0.01, e - pe); prev = c; pe = e; }
    return 1;
  }
  function hourAt(d, f) {
    const g = hourProf(d);
    if (!g) return OPEN_H + f * (CLOSE_H - OPEN_H);
    let prev = 0, pe = OPEN_H;
    for (let k = 0; k < g.ends.length; k++) { const e = g.ends[k], c = g.cum[k]; if (f <= c) return c > prev ? pe + (e - pe) * (f - prev) / (c - prev) : pe; prev = c; pe = e; }
    return CLOSE_H;
  }
  // 그 시각에 센 재고 뒤로 그날 남은 매출 비율 (발주 마감 전 입력은 아침에 센 것으로 보고 1)
  const leftOf = (hh, d) => (hh <= ORDER_CUTOFF_H ? 1 : 1 - hourCum(d || TODAY, hh));
  function applyScores(M) {
    const logs = (db.onhand || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
    // 같은 날 여러 번 고치면 그날 마지막 값만 (중간에 잘못 친 값으로 채점하지 않게)
    const byKey = new Map();
    logs.forEach((l) => { if (!byKey.has(l.k)) byKey.set(l.k, []); const a = byKey.get(l.k); if (a.length && a[a.length - 1].t.slice(0, 10) === l.t.slice(0, 10)) a[a.length - 1] = l; else a.push(l); });
    M.scores = [];
    M.items.forEach((it) => { it.scoreA = []; it.scoreB = []; it.scoreF = []; it.scoreQ = []; it.rateG = null; });
    // 발주 탭 재고(input.날짜)도 채점에 씀: 입력 기록(onhand)에 안 남은 날(시트로 바로 넣은 날 등, 하루 입력의 약 35%)을 채움
    //  발주수량 칸이 생긴 10/20부터만 (그 전 날짜는 입고를 몰라 채점 못 함). 센 시각을 모르면 아침(10시)으로
    Object.keys(db).filter((k) => k.startsWith("input.") && k.slice(6) >= "2026-10-20" && k.slice(6) <= TODAY).forEach((k) => {
      const d = k.slice(6), rows = db[k] || {};
      Object.keys(rows).forEach((key) => {
        if (!counted(rows[key])) return;
        if (!byKey.has(key)) byKey.set(key, []);
        const a = byKey.get(key);
        if (!a.some((l) => l.t.slice(0, 10) === d)) a.push({ t: d + " 10:00", k: key, s: num(rows[key].s), v: 2, src: "input" });
      });
    });
    byKey.forEach((l) => l.sort((x, y) => (x.t < y.t ? -1 : 1)));
    byKey.forEach((list, key) => {
      const it = M.items.find((i) => i.key === key); if (!it) return;
      // 그날 재고는 발주 탭에 마지막으로 남은 값으로 (44로 잘못 쳤다가 4로 고친 경우 등)
      //  박스로 세는 품목은 예전에 팩으로 넣은 날이 있어 기록 그대로 씀
      if (!it.box) list = list.map((l) => { const r = (db["input." + l.t.slice(0, 10)] || {})[key]; return r && counted(r) ? { ...l, s: num(r.s) } : l; });
      else list = list.map((l) => (l.src === "input" ? { ...l, s: l.s * it.box } : l)); // 발주 탭 재고는 박스 수 → 재고 단위(팩)로
      // 미트카운트(10시 전 입력) = 전날 마감 재고 → 전날 24시에 센 것으로 (그날 입고·매출은 다음 구간)
      list = list.map((l) => (isMeat(l.t) ? { ...l, t: addDays(l.t.slice(0, 10), -1) + " 24:00" } : l)).sort((x, y) => (x.t < y.t ? -1 : 1));
      let uG = 0, gG = 0;
      // 두 재고 사이 실제 사용량 (입고를 모르면 null)
      const pairs = [];
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const d1 = a.t.slice(0, 10), d2 = b.t.slice(0, 10);
        if (d2 < d1 || (d2 === d1 && hourOf(b.t) <= hourOf(a.t))) continue; // 같은 날 낮에 세고 밤(미트카운트)에 또 센 것도 한 구간
        let actual = null;
        if (a.v === 2) {
          // 두 재고 사이(d1 다음날 ~ d2)에 들어온 입고 = 앱에 넣은 발주의 입고일로 계산. 그 사이 발주한 날 중 앱을 안 쓴 날(일요일 제외)이 있으면 모름 → 뺌
          let arr = 0, unknown = false;
          for (let x = addDays(d1, -7); x < d2 && !unknown; x = addDays(x, 1)) {
            // 발주수량 칸이 생기기 전(10/20 전)에 한 발주는 앱이 몰라서 모름으로 (10/20 발주는 샐러드믹스 2·크림치즈 3이 전부라고 확인)
            const known = db["input." + x] && x >= "2026-10-20";
            if (isOrderDay(it, x) && deliveryOf(it, x) > d1 && deliveryOf(it, x) <= d2 && !known && dow(x) !== 0) unknown = true;
            arrivalsOf(it, x).forEach((v) => { if (v.d > d1 && v.d <= d2) arr += v.q; });
          }
          if (!unknown) actual = num(a.s) + arr - num(b.s);
        } else {
          // 예전 기록(익일 칸): 두 입력 사이에 앱이 모르는 입고일이 있으면 뺌
          //  익일 입고 칸이 비어 있으면 그날 입고를 모르는 것이라 뺌 (10/19→21 등심처럼 모르는 입고가 끼면 사용량이 틀어짐)
          let gap = 0; for (let x = addDays(d1, 2); x <= d2; x = addDays(x, 1)) if (dow(x) !== 0) gap++;
          if (!gap && num(a.i) > 0) actual = num(a.s) + num(a.i) - num(b.s);
        }
        pairs.push({ d1, d2, actual, h1: hourOf(a.t), h2: hourOf(b.t) });
      }
      // 채점 구간: 이어진 구간을 예상 사용량이 2단위 넘을 때까지 묶음 (시즈닝·고춧가루처럼 가끔 프랩에 쓰는 품목은 하루 단위로는 0 아니면 통째)
      //  재고가 그대로인 날(사용 0)도 넣고, 음수(입고 없이 늘어남)나 입고를 모르는 구간에서 끊음
      const err = (p, a) => Math.max(-1, Math.min(1, (p - a) / Math.max(a, 1e-9))); // ±100%에서 자름
      // 프랩 배치로 쓰는 품목은 한 배치(레시피 한 번 양의 1.5배), 박스째 꺼내는 품목은 1.5박스 양이 될 때까지 묶음
      const thr = Math.max(2, batchRawOf(M, it), prepRawOf(M, it) * 1.5, it.outStep * 1.5);
      // 가운데 재고가 틀린 경우(2팀 F 10/27): 이어진 두 구간이 반대로 튀고(한쪽 실제÷예상 1.8 넘게, 다른 쪽 0.55 밑) 둘을 합치면 0.6~1.6이면
      //  가운데 재고를 빼고 한 구간으로 채점 (우대갈비 10/23·새송이 10/25·루토사 10/24처럼 한 점이 앞뒤를 반대로 틀어 놓는 경우)
      const roughP = (p) => {
        const g = (sumGross(p.d1, p.d2, true).s - (1 - leftOf(p.h1, p.d1)) * dayGross(p.d1, true).v + (1 - leftOf(p.h2, p.d2)) * dayGross(p.d2, true).v) / 1e6;
        const days = Math.round((parseISO(p.d2) - parseISO(p.d1)) / 864e5), a = it.rateA != null ? it.fixedA * days + it.rateA * g : null, b = it.rateB != null ? it.rateB * g : null;
        return a != null && b != null ? (a + b) / 2 : a ?? b;
      };
      for (let i = 0; i + 1 < pairs.length; i++) {
        const x = pairs[i], y = pairs[i + 1];
        if (x.actual == null || y.actual == null || x.d2 !== y.d1 || x.h2 !== y.h1) continue;
        const px = roughP(x), py = roughP(y); if (!(px > 0 && py > 0) || px + py < thr) continue;
        const rx = x.actual / px, ry = y.actual / py, rs = (x.actual + y.actual) / (px + py);
        if (((rx > 1.8 && ry < 0.55) || (rx < 0.55 && ry > 1.8)) && rs >= 0.6 && rs <= 1.6) { pairs.splice(i, 2, { d1: x.d1, h1: x.h1, d2: y.d2, h2: y.h2, actual: x.actual + y.actual }); i--; }
      }
      let acc = null;
      const dayPairs = [];
      const flushAcc = () => {
        if (!acc) return; const { d1, d2, actual, pA, pB, pF, g } = acc; acc = null;
        if (pF == null) { if (g > 0) { uG += actual; gG += g; } return; } // 수불·레시피가 없는 품목(세제 등)은 재고로 100만원당 사용량을 배움
        if (!(pF >= thr)) return; // 예상 사용량이 기준(2단위 또는 한 배치)이 안 되면 아직 판단 못 함
        if (pA != null) it.scoreA.push(err(pA, actual));
        if (pB != null) it.scoreB.push(err(pB, actual));
        it.scoreF.push(err(pF, actual));
        it.scoreQ.push((it.outStep || 1) ** 2 / (6 * pF * pF)); // 양 끝 재고가 각각 0~1단위(박스째 꺼내면 0~1박스) 덜 세어질 수 있는 잡음의 분산 (상대값)
        M.scores.push({ key, name: it.name, start: d1, end: d2, actual, pA, pB, pF });
      };
      pairs.forEach(({ d1, d2, actual, h1, h2 }, j) => {
        const nx = pairs[j + 1];
        // 입고를 모름 / 음수 / 다음 날 입고 없이 늘어남(이 날 덜 셈) → 여기서 끊고 이 구간은 뺌
        if (actual == null || actual < 0 || (nx && nx.d1 === d2 && nx.actual != null && nx.actual < -0.5)) { flushAcc(); return; }
        if (acc && acc.d2 !== d1) { flushAcc(); }
        const days = Math.round((parseISO(d2) - parseISO(d1)) / 864e5);
        // 그 사이 실제 Gross가 다 있어야 채점 (Forecast로 채점하면 매출이 틀린 걸 사용량 탓으로 봄)
        const actOk = (d) => num(((db.forecast || {})[d] || {}).act) > 0;
        // 해동 품목도 재고는 냉동고 + 해동고를 같이 셈(10/26 KM) → 꺼내 둔 것도 재고라 매출을 뒤로 밀지 않음
        //  (냉동고만 센다고 보고 하루 밀었을 때 해동 품목 채점 오차 30% → 안 밀면 20%, 10/21~25)
        const s1 = d1, s2 = d2;
        let gapAct = false; for (let x = s1; x < s2; x = addDays(x, 1)) if (!actOk(x) && !(x === s1 && leftOf(h1, s1) === 0)) gapAct = true;
        if (leftOf(h2, s2) < 1 && !actOk(s2)) gapAct = true;
        if (gapAct) { flushAcc(); return; }
        // 센 시각만큼 그날 매출을 나눔: 저녁에 센 날은 그날 매출 대부분이 이미 빠진 뒤 (10/19 저녁 → 10/20 아침이면 하루치가 아님)
        const g = (sumGross(s1, s2, true).s - (1 - leftOf(h1, s1)) * dayGross(s1, true).v + (1 - leftOf(h2, s2)) * dayGross(s2, true).v) / 1e6;
        const bdj = (() => { const ba = batchAdj(it, { today: d1, days, gross: g * 1e6 }); return ba ? ba.delta : 0; })(); // 프랩 배치(그 사이 만든 날)
        const pA = it.rateA != null ? Math.max(0, it.fixedA * days + it.rateA * g + bdj) : null;
        const pB = it.rateB != null ? Math.max(0, it.rateB * g + bdj) : null;
        const pF = pA != null && pB != null ? (pA + pB) / 2 : pA ?? pB;
        if (pF > 0 && g > 0) { // 주말 배수 배우기: 이 구간 매출 중 주말 몫
          const gW = (weSum(s1, s2, true) - (isWE(s1) ? (1 - leftOf(h1, s1)) * dayGross(s1, true).v : 0) + (isWE(s2) ? (1 - leftOf(h2, s2)) * dayGross(s2, true).v : 0)) / 1e6;
          dayPairs.push({ we: gW / g, a: actual, p: pF });
        }
        // 재고가 그대로여도 뜯은 건 안 세는 경우가 있어 1단위까지는 뜯은 걸 쓴 것으로 봄. 2단위 넘게 쓸 만큼 예상인데 그대로면 다시 안 센 값으로 보고 뺌
        if (actual === 0 && pF != null && pF >= thr) { flushAcc(); if (nx && nx.d1 === d2 && nx.actual != null) { nx.d1 = d1; nx.h1 = h1; } return; } // 안 센 값: 다음 쌍이 이 쌍 시작부터 이어받음
        const add = (x, y) => (x == null || y == null ? null : x + y);
        acc = acc ? { ...acc, d2, actual: acc.actual + actual, pA: add(acc.pA, pA), pB: add(acc.pB, pB), pF: add(acc.pF, pF), g: acc.g + g } : { d1, d2, actual, pA, pB, pF, g };
        if (acc.pF != null && acc.pF >= thr && !(it.thaw && nx && nx.d1 === d2 && nx.actual != null && [5, 6, 0].includes(dow(d2)))) flushAcc();
      });
      if (gG > 0) it.rateG = uG / gG;
      // 주말 배수: 주말 구간 실제÷예상. 주말 구간이 적으면 1 쪽으로 당김(n÷(n+3)), 0.9~1.6. 주말 구간 2번 이상일 때만
      //  Forecast 보정과 같은 방식. 평일·주말이 섞인 구간(주말 몫 40~60%)은 안 씀
      //  (10/27: 예전엔 평일 비율로 나눴는데, 평일이 더 모자란 품목은 주말에도 모자란데 주말을 깎는 반대 보정이 됨 → 주말 값만)
      //  줄이는 쪽은 10%까지만 (주말에 다시 안 센 품목이 "안 씀"으로 보여 86 날 수 있음)
      const sumOf = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
      const W = dayPairs.filter((x) => x.we >= 0.6), D = dayPairs.filter((x) => x.we <= 0.4);
      const pW = sumOf(W, (x) => x.p), pD = sumOf(D, (x) => x.p);
      it.weK = 1; it.weN = W.length;
      if (W.length >= 2 && pW >= thr) {
        const ratio = sumOf(W, (x) => x.a) / pW;
        it.weK = Math.min(1.6, Math.max(0.9, 1 + (ratio - 1) * W.length / (W.length + 3)));
      }
      it.wdK = 1;
      if (it.weKm) { it.weK = it.weKm.we; it.wdK = it.weKm.wd; } // 날짜별 메뉴 판매로 구한 값이 있으면 그걸 (재고로 배운 값보다 품목이 많고 덜 흔들림)
      const fixK = num(((db.itemCfg || {})[it.key] || {}).weK); if (fixK > 0) { it.weK = fixK; it.wdK = 1; }
    });
    // 수불현황이 있는 달은 그 달 전체 사용량으로도 채점 (월말 날짜로)
    M.items.forEach((it) => (it.ledgerScores || []).forEach((l) => {
      const pF = l.pA != null && l.pB != null ? (l.pA + l.pB) / 2 : l.pA ?? l.pB;
      M.scores.push({ key: it.key, name: it.name, end: monthLast(l.m), actual: l.actual, pA: l.pA, pB: l.pB, pF, src: "ledger" });
    }));
  }
  const monthLast = (m) => `${m}-${String(new Date(+m.slice(0, 4), +m.slice(5), 0).getDate()).padStart(2, "0")}`;
  // 한 달 채점: 수불현황이 있으면 그 달 전체(전 품목), 없으면 재고 입력으로 한 채점
  const monthScores = (M, m) => { const all = M.scores.filter((s) => s.end.slice(0, 7) === m), led = all.filter((s) => s.src === "ledger"); return led.length ? led : all; };

  // =========================================================
  // 화면
  // =========================================================
  const views = { main: "v-main", forecast: "v-forecast", files: "v-files", report: "v-report", help: "v-help" };
  // ---------- 모션 (폰 설정에서 "동작 줄이기"면 전부 끔) ----------
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CK = '<svg class="ck" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4 4.9 9 9.8 3.4"/></svg>';
  // 필요량 칸 다시 그리기: 발주완료·충분으로 바뀌면 톡 튀어나오고(체크가 그려짐), 같은 칸에서 숫자만 바뀌면 위/아래로 굴러서 바뀜
  function swapNeed(box, html) {
    const old = box.firstElementChild, oc = old ? old.className : "";
    const ot = old ? [...old.children].filter((x) => x.tagName !== "EM").map((x) => x.textContent) : [];
    box.innerHTML = html;
    const nw = box.firstElementChild;
    if (!old || !nw || calm()) return;
    if (nw.className !== oc) { if (/\b(done|enough)\b/.test(nw.className)) nw.classList.add("m-pop"); return; }
    const kids = [...nw.children].filter((x) => x.tagName !== "EM");
    kids.forEach((el, i) => {
      if (ot[i] == null || el.textContent === ot[i]) return;
      const a = parseFloat(ot[i].replace(/[^\d.-]/g, "")), b = parseFloat(el.textContent.replace(/[^\d.-]/g, ""));
      el.classList.add(isFinite(a) && isFinite(b) && b < a ? "m-down" : "m-up");
    });
  }
  // 데이터 리포트를 열 때만 학습량 숫자가 0부터 올라가며 게이지가 참
  let xpAnim = false, xpTok = 0;
  function go(to) {
    if (to === "report") xpAnim = true;
    Object.entries(views).forEach(([k, id]) => {
      const v = $(id); v.hidden = k !== to; v.classList.remove("push", "pop");
      if (k === to) { void v.offsetWidth; v.classList.add(to === "main" ? "pop" : "push"); }
    });
    window.scrollTo(0, 0);
    if (to === "main") renderMain();
    if (to === "forecast") renderForecast();
    if (to === "files") renderFiles();
    if (to === "report") renderReport();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]"); if (!b) return;
    if (b.dataset.go === "files") { unlock().then((ok) => ok && go("files")); return; } // 데이터 파일은 버튼 비밀번호와 같은 번호
    go(b.dataset.go);
  });
  const tabs = [["tabOrder", "pOrder", "발주량 계산"], ["tabPrep", "pPrep", "프랩량 계산"]];
  tabs.forEach(([t]) => $(t).addEventListener("click", () => {
    tabs.forEach(([t2, p2, title]) => { const on = t2 === t; $(t2).setAttribute("aria-selected", on); $(p2).hidden = !on; if (on) $("mainTitle").textContent = title; });
    if (t === "tabPrep") renderPrep();
  }));

  // ---------- 메인 상단 ----------
  function renderTop() {
    // 날짜 아래 발주 상태: 일요일 발주 없음, 14:30 전 발주 가능, 지나면 발주 마감
    const nowH = new Date().getHours() + new Date().getMinutes() / 60;
    const st = dow(TODAY) === 0 ? ["off", "금일 발주 없음"] : nowH >= ORDER_CUTOFF_H ? ["closed", "금일 발주 마감"] : ["open", "금일 발주 가능"];
    $("todayPill").innerHTML = `${mmdd(TODAY)}<small>${DOW[dow(TODAY)]}</small>`;
    $("orderState").className = "ostate " + st[0]; $("orderState").textContent = st[1];
    const mon = mondayOf(TODAY), wk = isoWeek(TODAY);
    let s = 0, entered = 0;
    for (let i = 0; i < 7; i++) { const g = dayGross(addDays(mon, i), false); s += g.v; if (g.src === "fc") entered++; }
    $("tileFcWeek").textContent = `${wk.w}주차 · ${mmdd(mon)} ~ ${mmdd(addDays(mon, 6))}`;
    $("tileFcSum").textContent = !entered ? "입력 필요" : won(s) + "원" + (entered < 7 ? " (일부 추정)" : "");
    // 데이터 파일 상태: 지난달 4개 + 최신 레시피
    const last = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7);
    const d = mget(last);
    const miss = [!d.ledger && "수불현황", !d.sales && "매출현황", !(num(d.gross) || grossFromForecast(last)) && "Gross Sales"].filter(Boolean);
    const lm = +last.slice(5);
    $("tileData1").className = "s stl" + (miss.length ? " wait" : "");
    $("tileData1").innerHTML = `<i class="mk${miss.length ? " wait" : ""}"></i><span>${miss.length ? `${lm}월 ${miss[0]} 필요` : `${lm}월 데이터 반영`}</span>`;
    let rv = null; months().forEach((m) => { const x = mget(m).line; if (x && x.at) rv = x.at; });
    const label = rv ? `${mmdd(rv)} 레시피 반영` : "레시피 필요";
    $("tileData2").className = "s stl" + (rv ? "" : " wait");
    $("tileData2").innerHTML = `<i class="mk${rv ? "" : " wait"}"></i><span>${label}</span>`;
  }

  // ---------- 발주 ----------
  let cat = null;
  // 오늘(발주) → 입고일을 요일 띠 위 곡선 화살표로 잇기. 입고일이 다음 주면 오른쪽 끝으로
  function drawWeekArc(svg = $("weekArc"), strip = $("weekStrip")) {
    if (!svg || !strip) return;
    const from = strip.querySelector(".today");
    if (!from) { svg.innerHTML = ""; return; }
    const to = strip.querySelector(".deliv");
    const box = strip.getBoundingClientRect(), a = from.getBoundingClientRect();
    const W = box.width, H = 18;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
    const x1 = a.left - box.left + a.width / 2;
    const x2 = to ? to.getBoundingClientRect().left - box.left + to.getBoundingClientRect().width / 2 : W - 4;
    // 낮고 완만한 호 + 시작점 작은 점 + 끝에 작은 채운 화살촉
    const y = H - 3, top = 2, k = Math.min(Math.abs(x2 - x1) * 0.18, 18);
    const d = `M${x1} ${y} C${x1 + k} ${top}, ${x2 - k} ${top}, ${x2} ${y - 1}`;
    // 화살촉은 marker(orient=auto)라 곡선 끝 방향을 따라 함께 휨
    svg.innerHTML = `<defs><marker id="wkHead" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M1 1.5L9 5L1 8.5Z" fill="currentColor"/></marker></defs>` +
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".9"${to ? "" : ' stroke-dasharray="2 3"'} marker-end="url(#wkHead)"/>` +
      `<circle cx="${x1}" cy="${y}" r="2.2" fill="currentColor"/>`;
  }
  window.addEventListener("resize", () => { if (!$("v-main").hidden) { drawWeekArc(); drawWeekArc($("preArc"), $("preStrip")); } });
  function renderMain() {
    renderTop();
    // 사전발주 ON면 고른 발주일 기준으로 요일 띠·안내를 보여줌
    const od = preMode ? pDay() : TODAY;
    const M = model(), win = orderWindow(od);
    // 요일 띠
    // 입고일이 다음 주면 띠를 뒤로 밀어서 발주일과 입고일이 같이 보이게 (화살표가 밖으로 안 나가게)
    const mon = win.deliv > addDays(mondayOf(od), 6) ? addDays(win.deliv, -6) : mondayOf(od);
    requestAnimationFrame(() => drawWeekArc());
    $("weekStrip").innerHTML = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = addDays(mon, i);
      if (dow(d) === 0) return `<div class="off"><b>일</b><span>없음</span></div>`;
      return `<div class="${d === od ? "today" : d === win.deliv ? "deliv" : ""}"><b>${DOW[dow(d)]}</b><span>→${DOW[dow(delivery(d))]}</span></div>`;
    }).join("");
    const b = $("orderBanner");
    if (!M.items.length) { b.className = "banner warn"; b.innerHTML = "<span>데이터 파일에서 발주 시트나 수불현황을 먼저 올려 주세요.</span>"; }
    else if (dow(od) === 0) { b.className = "banner soft"; b.innerHTML = "<span>오늘은 일요일이라 발주가 없어요. 월요일 기준으로 미리 볼 수 있어요.</span>"; }
    else {
      b.className = "banner" + (win.est ? " soft" : "");
      b.innerHTML = `<span>${od === TODAY ? "오늘 발주" : `${DOW[dow(od)]} ${mmdd(od)} 사전발주`} → ${DOW[dow(win.deliv)]} ${mmdd(win.deliv)} 입고 · <em>${win.covered.join("·")}</em> 사용분${win.est ? ` · Forecast 없는 날 ${win.est}일은 추정` : ""}${fcBias().label ? ` · Forecast 보정 ${fcBias().label}` : ""}${win.wkGross > 0 && weekendPlus() > 0 ? ` · 주말 여유 +${Math.round(weekendPlus() * 100)}%` : ""}${preMode && od > TODAY ? ` · 그 사이 발주는 추천량대로 넣는다고 보고 계산` : ""}</span><span class="bsum"><small>${win.days > 1 ? `${DOW[dow(od)]}~${DOW[dow(addDays(win.end, -1))]} ${win.days}일 매출 합계` : `${DOW[dow(od)]} 매출`}</small>${won(win.gross)}원</span>`;
    }
    const vendors = [...new Set(M.items.filter((i) => !i.ledgerOnly).map((i) => i.vendor).filter(Boolean))];
    $("cats").innerHTML = vendors.map((c) => {
      const n = M.items.filter((it) => !it.ledgerOnly && it.vendor === c).length;
      return `<button type="button" data-c="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}<span class="cnt">${n}</span></button>`;
    }).join("");
    renderList();
    renderMis();
  }
  // ---------- MIS 자동입력 (폰 → PC) ----------
  // 폰에서 [보내기] → 시트 misPush = {date, status: pending} → PC의 MIS 탭(북마크 "자동 대기", mis-agent.js)이 20초 안에 받아 넣고 저장 → 결과를 misPush에 적음
  //  PC는 2분마다 misAgent.at 기록 → 3분 넘게 없으면 "PC 연결 안 됨"
  let misFastUntil = 0;
  function misItems() {
    const byName = new Map((((db["master.order"] || {}).rows) || []).map((r) => [r.name, r]));
    return Object.entries(todayInput()).filter(([k, v]) => num((v || {}).o) > 0 && (byName.get(k) || {}).code).map(([k, v]) => ({ name: k, q: num(v.o), vendor: (byName.get(k) || {}).vendor || "" }));
  }
  function renderMis() {
    const el = $("misBar"); if (!el) return;
    if (preMode || dow(TODAY) === 0 || !API) { el.hidden = true; return; }
    el.hidden = false;
    const ag = db.misAgent || {}, p = db.misPush && db.misPush.date === TODAY ? db.misPush : null, list = misItems();
    const agOn = ag.at && Date.now() - ag.at < (ag.mode === "ondemand" ? 20 * 60e3 : 180000); // 확장 1.3: 평소 10분마다 "대기 중" 기록
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    const stale = p && /pending|running/.test(p.status) && Date.now() - (p.startAt || p.at) > (ag.mode === "ondemand" ? 12 * 60e3 : 300000);
    let st, cls = "";
    if (p && p.status === "pending" && !stale) { st = agOn ? (ag.mode === "ondemand" ? "PC가 GW·MIS 여는 중… (1~2분)" : "PC가 받는 중…") : "PC가 꺼져 있어 기다리는 중 (PC에서 자동 대기를 켜 주세요)"; cls = "run"; }
    else if (p && p.status === "running" && !stale) { st = "PC에서 그룹웨어 입력 중…"; cls = "run"; }
    else if (p && p.status === "done") { st = `✓ ${hhmm(p.doneAt)} 그룹웨어 저장 완료 ${p.saved ?? ""}${p.total ? "/" + p.total : ""}개`; cls = "ok"; }
    else if (p && p.status === "error") { st = `⚠ ${hhmm(p.doneAt)} 확인 필요 · 눌러서 보기`; cls = "bad"; }
    else if (stale) { st = "⚠ PC 응답 없음 · 다시 보내 주세요"; cls = "bad"; }
    else st = agOn ? (ag.mode === "ondemand" ? `PC 대기 중 · 누르면 1~2분 안에 입력` : `PC 자동 대기 중 · ${hhmm(ag.at)} 확인${ag.grid ? "" : " · 주문등록 화면 아님"}`) : `PC 연결 안 됨${ag.at ? ` · 마지막 ${hhmm(ag.at)}` : ""}`;
    const busy = p && p.status === "running" && !stale; // 기다리는 중(pending)이어도 다시 누를 수 있게
    el.innerHTML = `<div class="mis-t"><b>그룹웨어 자동입력</b><span class="mis-s ${cls}${p && p.status === "error" ? " tap" : ""}">${esc(st)}</span></div>` +
      `<span class="mis-act">${pinBtn()}<button type="button" class="btn" id="misGo"${busy || !list.length ? " disabled" : ""}>GW 전송 ${list.length}</button></span>`;
    bindPin(el);
    el.querySelector(".mis-s.tap")?.addEventListener("click", () => alert(p.text || ""));
    el.querySelector("#misGo").addEventListener("click", async () => {
      const now = misItems();
      if (!now.length || !(await unlock())) return;
      if (!confirm(`오늘(${mmdd(TODAY)}) 발주 ${now.length}개를 PC의 그룹웨어(MIS)에 넣고 저장할까요?\n\n${now.map((w) => `${w.vendor ? "[" + w.vendor + "] " : ""}${w.name}  ${w.q}`).join("\n")}`)) return;
      setKey("misPush", { date: TODAY, id: Date.now(), at: Date.now(), status: "pending", n: now.length });
      misFastUntil = Date.now() + 180000;
      toast(agOn ? "GW 전송했어요 · 1분 안에 결과가 떠요" : "보냈어요 · PC에서 자동 대기를 켜면 바로 넣어요");
    });
  }
  const todayInput = () => { const t = db["input." + TODAY] || {}; return t; };
  // 재고를 넣었고 발주가 필요한 품목 → 목록 맨 위 "발주 필요"로
  const stockOf = (it, v) => num(v.s) * (it.box || 1); // 박스로 넣는 품목은 팩으로 바꿔 계산
  // 발주수량(o, 발주단위) → 재고단위. 예전 기록의 익일(i)은 다음 영업일 입고
  const ordToStock = (it, o) => (it.pk.sameUnit === false ? o * (it.pk.mult || 1) : o);
  const arrivalsOf = (it, x) => {
    const r = (db["input." + x] || {})[it.key]; if (!r) return [];
    const out = [];
    if (num(r.o) > 0) out.push({ d: deliveryOf(it, x), q: ordToStock(it, num(r.o)) });
    if (num(r.i) > 0) out.push({ d: addBiz(x, 1), q: num(r.i), legacy: true });
    return out;
  };
  // d일 재고를 센 뒤에 들어올 입고: 그 전날까지 앱에 넣은 발주 중 아직 안 온 것 (+ 예전 방식 익일 칸)
  // 오늘 재고를 미트카운트로 넣었으면 오늘 들어오는 입고도 아직 안 센 것 → 들어올 양에 더함
  const incNow = (it) => incomingOf(it, TODAY) + (meatOn(it, TODAY) ? arrBetween(it, TODAY, true, TODAY, false) : 0); // = 오늘 들어오는 입고
  const incomingOf = (it, d) => { let q = 0; for (let k = 0; k <= 7; k++) { const x = addDays(d, -k); arrivalsOf(it, x).forEach((a) => { if (a.d > d && (k > 0 || a.legacy)) q += a.q; }); } return q; };
  // 재고 단계: 충분(필요량 이상) · 여유(다음 입고까지는 되고 여유분만 모자람) · 부족(예상 사용량의 70~100%) · 발주필요(70% 미만)
  // 재고 단계: 필요량보다 적으면 무조건 발주필요. 필요량 이상이면 얼마나 넉넉한지로 충분(1.5배↑) · 여유(1.2~1.5배) · 부족(1.2배 미만)
  // 발주 안 해도 되는 품목은 이미 안전재고까지 채워져 있음 → 모두 충분
  const tierOf = (r) => (r.packs ? "buy" : "ok");
  // 사전발주 ON (쉬는 날 집에서 발주): 오늘 재고를 안 센 품목은 예상 재고로 계산
  //  예상 재고 = 최근 7일 안 마지막으로 센 재고 + 그 뒤 입고(앱 발주) − 그 사이 사용량 − 여유(1단위 + 그 사이 사용량 한 번 더)
  //  저녁(14:30 이후)에 센 재고는 그날 남은 영업분만 뺌. 86 위험·학습에는 안 씀. 켠 날만 유지 (다음 날 자동 꺼짐)
  // 껐다 켜면 항상 OFF (기억하지 않음)
  let preMode = false;
  const setPre = (on) => { preMode = on; };
  // 고른 날(d) 아침 예상 재고: 오늘까지 마지막으로 센 재고에서 그날까지 영업일 사용량(지난날은 실제 Gross, 앞날은 Forecast)을 빼고 입고를 더함
  let preDay = null; // 사전발주로 고른 날 (없으면 다음 발주일)
  const nextOrderDay0 = () => { let d = addDays(TODAY, 1); while (dow(d) === 0) d = addDays(d, 1); return d; };
  const pDay = () => preDay || nextOrderDay0();
  // pre: d에 미트카운트로 센다고 볼 때(그날 입고 전) — 그날 입고는 빼고 봄
  function estStock(it, d, plan, pre) {
    const start = d > TODAY ? TODAY : addDays(d, -1);
    for (let x = start; x >= addDays(TODAY, -7); x = addDays(x, -1)) {
      const k = Math.round((parseISO(d) - parseISO(x)) / 864e5);
      const r = (db["input." + x] || {})[it.key];
      if (!r || r.s === "" || r.s == null || !isFinite(num(r.s))) continue;
      const log = logOn(it, x), xm = !!log && isMeat(log.t);
      let arr = arrBetween(it, x, xm, d, !!pre);
      (plan || []).forEach((a) => { if (a.d > x && a.d <= d) arr += a.q; });
      const hh = log ? +log.t.slice(11, 13) + +log.t.slice(14, 16) / 60 : 10;
      const left = leftOf(hh, x);
      const gross = left * dayGross(x, true).v + sumGross(addDays(x, 1), d, true).s;
      const weGross = (isWE(x) ? left * dayGross(x, true).v : 0) + weSum(addDays(x, 1), d, true);
      const c = calc(it, { ...orderWindow(x), days: Math.max(1, k - 1 + left), gross, weGross, fcVar: fcVar(x, d, true, left) }, 0, 0);
      if (c.none) return null;
      return { v: Math.max(0, stockOf(it, r) + arr - c.use), from: x, days: k };
    }
    return null;
  }
  const counted = (v) => !!v && v.s !== "" && v.s != null && isFinite(num(v.s));
  // 박스째로만 세는 품목(버터라이스 40·스파게티니 20·시즐링 25 등): 예상 칩을 셈 단위로 내려서 보여 줌 (계산은 그대로)
  //  한 단위가 안 되면 내리지 않고 그대로 (0으로 보이지 않게)
  //  itemCfg.countStep이 없으면 최근 5번(4번 이상) 센 값이 모두 40·25·20·10·5의 배수인지로 짐작 (40·40·40만 보면 40으로 잘못 봄) (2팀 G 백테스트: 해당 품목 적중 26%→47%)
  function countStepOf(it) {
    if (it.box) return 0;
    if (it.countStep) return it.countStep;
    const vals = Object.keys(db).filter((k) => /^input\.\d{4}-\d\d-\d\d$/.test(k) && k.slice(6) <= TODAY).sort().reverse()
      .map((k) => (db[k] || {})[it.key]).filter((v) => counted(v) && num(v.s) > 0).slice(0, 5).map((v) => num(v.s));
    if (vals.length < 4) return 0;
    return [40, 25, 20, 10, 5].find((st) => vals.every((x) => Math.abs(x / st - Math.round(x / st)) < 1e-9)) || 0;
  }
  // 사전발주 계산: 오늘부터 고른 날(P) 전까지 발주일에 아직 발주 기록이 없으면 그날 앱 추천량대로 넣는다고 보고 이어서 계산
  //  (토요일 사전발주를 수요일에 보면 목·금 발주분이 주말을 맡으니, 토요일 발주는 화요일 입고 뒤 몫만)
  let preMemo = new Map();
  function preCalc(it, v, P) {
    const mk = it.key + "|" + P; if (preMemo.has(mk)) return preMemo.get(mk);
    const plan = [], incP = (d) => incomingOf(it, d) + plan.reduce((a, p) => a + (p.d > d ? p.q : 0), 0);
    const now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;
    for (let y = TODAY; y < P; y = addDays(y, 1)) {
      if (dow(y) === 0 || !isOrderDay(it, y)) continue;
      const ry = (db["input." + y] || {})[it.key];
      if (ry && num(ry.o) > 0) continue; // 넣은 발주는 입고로 이미 셈
      if (y === TODAY && nowH > ORDER_CUTOFF_H) continue; // 오늘 발주 마감 지남
      const ey = y === TODAY && counted(v) ? null : estStock(it, y, plan), sy = ey ? ey.v : counted(v) ? stockOf(it, v) : NaN;
      if (!isFinite(sy)) continue;
      const ry2 = calc(it, orderWindowFor(it, y), sy, incP(y));
      if (!ry2.none && ry2.packs > 0) plan.push({ d: deliveryOf(it, y), q: ordToStock(it, ry2.orderQty), y });
    }
    const e = P === TODAY && counted(v) ? null : estStock(it, P, plan), sv = e ? e.v : counted(v) ? stockOf(it, v) : NaN;
    const w = orderWindowFor(it, P), inc = incP(P);
    const r = isFinite(sv) && w.canOrder ? calc(it, w, sv, inc) : null;
    // 보여줄 예상 재고: 이번 발주가 들어오는 날 아침(이번 발주분 빼고). 필요량 = 그날부터 쓸 양 − 이 값
    const own = (db["input." + P] || {})[it.key], ownQ = own && num(own.o) > 0 && deliveryOf(it, P) === w.deliv ? ordToStock(it, num(own.o)) : 0;
    const eD = estStock(it, w.deliv, plan), sD = eD ? Math.max(0, eD.v - ownQ) : NaN;
    const out = { e, sv, sD, w, inc, r: r && !r.none ? r : null, plan };
    preMemo.set(mk, out); return out;
  }
  // 사전발주: 고른 날이 앞날이면 오늘 센 품목도 그날까지 예상, 오늘이면 안 센 품목만 예상
  const estFor = (it, v) => (!preMode ? null : pDay() === TODAY && counted(v) ? null : estStock(it, pDay()));
  // 맨 위 "발주 필요" 칸 순서: 0 발주필요 → 1 부족·여유(한 묶음) → 3 발주완료(맨 아래), -1 = 위로 안 올림
  const pinRank = (it, win, v) => {
    if (preMode) {
      const pc = preCalc(it, v, pDay()); return pc.r && pc.r.packs > 0 ? 0 : -1;
    }
    if (v && num(v.o) > 0) return 3; // 오늘 발주 넣은 품목은 칸 맨 아래로
    if (!counted(v)) return -1;
    const w = orderWindowFor(it, TODAY); if (!w.canOrder) return -1; // 오늘이 그 업체 발주일이 아니면 위로 안 올림
    const s = stockOf(it, v), inc = incNow(it), r = calc(it, w, s, inc);
    if (r.none) return -1;
    return { buy: 0 }[tierOf(r, s + inc)] ?? -1; // 발주필요만 위로
  };
  function rowEl(it, win, inp) {
    win = orderWindowFor(it, TODAY); // 업체별 발주 요일이 있으면 그 기준 기간
    const vc = vcfg(it), offDay = !win.canOrder;
    const d = document.createElement("div");
    d.className = "cell"; d.dataset.key = it.key;
    const v = { s: "", o: "", ...(inp[it.key] || {}) };
    const unit = it.pk.stock || "재고단위", ou = it.pk.order || unit;
    const inc = incNow(it);
    const draw = () => {
      const est = estFor(it, v);
      const s = est ? est.v : stockOf(it, v), i = inc;
      let need;
      // 재고를 아직 안 넣었으면 이번 기간 필요량만 회색으로 보여줌
      // 묶음 단위 발주(10개단위 등)는 필요량도 그 단위로 반올림
      const m = it.pk.mult || 1, rm = (v) => (m > 1 && v > 0 ? Math.max(m, Math.round(v / m) * m) : it.box ? Math.ceil(v - 0.05) : r1(v));
      // 몇 포션인지 (itemCfg.portionG): 보이는 필요량 × 1단위 g ÷ 1포션 g
      const por = (q) => (it.portionG && it.pk.g && q > 0 ? `<em class="por">${Math.ceil(q * it.pk.g / it.portionG - 1e-9)}${esc(it.portionLabel)}</em>` : "");
      if (!isFinite(s) && num(v.o) > 0) return `<span class="need done"><b>${CK}발주완료</b><span>${esc(v.o)}${esc(ou)} 발주</span></span>`;
      if (!isFinite(s)) { const r = calc(it, win, 0, 0); need = r.none ? '<span class="need none"><b>–</b></span>' : `<span class="need none need-idle">${por(+rm(r.need))}<b>${rm(r.need)}<small>${esc(unit)}</small></b><span>필요량</span></span>`; }
      else {
        const r = calc(it, win, s, i);
        if (r.none) need = '<span class="need none"><b>?</b></span>';
        else if (num(v.o) > 0) need = `<span class="need done"><b>${CK}발주완료</b><span>${esc(v.o)}${esc(ou)} 발주</span></span>`;
        else if (!r.packs) {
          // 필요량 = 주말 영업까지 다 하고 이번 입고일(월)에 들어와야 할 양 = 필요(사용+안전재고) − 재고 − 입고예정. 발주 안 해도 되면 0
          need = `<span class="need enough"><b>충분</b><span>필요 0${esc(unit)}</span></span>`;
        }
        else if (offDay) need = `<span class="need none need-idle lbl"><b>${DOW[dow(win.orderDay)]}요일 발주</b><span>필요 ${r.orderQty}${esc(it.pk.order || unit)}</span></span>`;
        else {
          need = `<span class="need buy lbl">${por(ordToStock(it, r.orderQty))}<b>발주필요</b><span>필요 ${r.orderQty}${esc(it.pk.order || unit)}</span></span>`;
        }
      }
      return need;
    };
    const c0 = calc(it, win, 0, 0);
    let tag = "";
    if (c0.none) tag = '<span class="chip new">데이터 없음</span>';
    else if (c0.useA == null && c0.useB == null) tag = '<span class="chip new">재고로 학습</span>';
    else if (it.isNew) tag = '<span class="chip new">신규 품목</span>';
    else if (c0.spread != null) tag = c0.spread < 0.1 ? '<span class="chip ok">일치</span>' : `<span class="chip diff">오차 ${Math.round(c0.spread * 100)}% 보정반영</span>`;
    // 예상 범위: 그 품목 단위로 ±0.4PK, ±1.1EA처럼 소수 첫째 자리 (g·ml은 정수). 일치·보정반영 칩 오른쪽에 작게
    const rng = !c0.none && c0.sd > 0 ? `<span class="rng">±${/^(g|ml|cc)$/i.test(unit) ? Math.max(1, Math.round(c0.sd)) : Math.max(0.1, Math.round(c0.sd * 10) / 10).toFixed(1)}${esc(unit)}</span>` : "";
    const rk86 = preMode ? null : riskOf(it, v), tag86 = rk86 ? `<span class="chip diff">${esc(rk86.when)} 부족</span>` : "";
    const top = `<div class="c-top"><span class="c-name">${esc(it.name)}</span>${tag86 || tag || rng ? `<span class="c-tags">${tag86}${tag}${rng}</span>` : ""}</div>`;
    // 사전발주 ON: 예상 재고와 사전발주 필요량 두 칸만
    if (preMode) {
      const d0 = pDay(), pc = preCalc(it, v, d0), w0 = pc.w, inc0 = incomingOf(it, d0); // 입고예정은 실제로 넣은 발주만
      const e = pc.e, sv = pc.sv, r = c0.none ? null : pc.r;
      const sShow = isFinite(pc.sD) ? r1(pc.sD / (it.box || 1)) + (it.box ? "BOX" : esc(unit)) : "–";
      const q = r && !r.none ? r.orderQty : null;
      d.innerHTML = top + `<div class="c-bot pre"><span class="c-meta"><span>${esc(it.vendor || "업체 미지정")}</span>${inc0 ? `<span class="incnote">입고예정 ${r1(inc0)}${esc(unit)}</span>` : ""}${!w0.canOrder ? `<span class="boxnote">${DOW[dow(d0)]}요일 발주 없음</span>` : ""}</span>` +
        `<span class="fld ro${e ? " est" : ""}"><span>${DOW[dow(w0.deliv)]} 예상 재고</span><b>${sShow}</b></span>` +
        `<span class="need prebox${q ? " has" : ""}"><b>${q == null ? "–" : q}${q ? `<small>${esc(ou)}</small>` : ""}</b><span>사전발주 필요량</span></span></div>`;
      return d;
    }
    d.innerHTML = top +
      `<div class="c-bot"><span class="c-meta"><span>${esc(it.vendor || "업체 미지정")}</span>${it.box ? `<span class="boxnote">재고는 박스로<br>1박스 = ${it.box}${esc(unit === "PK" ? "팩" : unit)}</span>` : `<span>${esc(it.unit || unit)}</span>`}${inc ? `<span class="incnote">입고예정 ${r1(inc)}${esc(unit)}</span>` : ""}${vc.days ? `<span class="boxnote">${esc(vc.note ? vc.note + " · " : "")}${vc.days.map((x) => DOW[x]).join("·")}요일 발주</span>` : ""}${it.thaw ? `<span class="boxnote">해동 ${it.thaw}일</span>` : ""}${it.useK !== 1 ? `<span class="boxnote">반영 ${it.useK > 1 ? "+" : ""}${Math.round((it.useK - 1) * 100)}%</span>` : ""}</span>` +
      // 예상 재고: 마지막으로 센 재고(7일 안) + 그 뒤 입고 − 오늘 아침까지 쓸 양. 재고칸 위 작은 회색 박스 (재고칸은 비워 둠)
      (() => { const l0 = logOn(it, TODAY), e0 = estStock(it, TODAY, null, l0 ? isMeat(l0.t) : new Date().getHours() < MEAT_H), st = countStepOf(it), et = e0 ? (st && e0.v >= st ? Math.floor(e0.v / st + 1e-9) * st : r1(e0.v / (it.box || 1))) : null; return `<div class="stk">${et != null ? `<span class="estchip">예상 ${et}${it.box ? "BOX" : esc(unit)}</span>` : ""}<label class="fld"><span>재고</span><input type="number" step="any" min="0" enterkeyhint="next" placeholder="–" value="${esc(v.s)}" aria-label="${esc(it.name)} 재고(${it.box ? "BOX" : esc(unit)})"></label></div>`; })() +
      `<label class="fld fld-ord"><span>발주 ${esc(ou)}</span><input type="number" step="any" min="0" enterkeyhint="next" placeholder="–" value="${esc(v.o)}" aria-label="${esc(it.name)} 발주수량(${esc(ou)})"></label>` +
      `<span class="needbox">${draw()}</span></div>`;
    const [si, ii] = d.querySelectorAll("input");
    const live = () => { v.s = si.value.trim(); v.o = ii.value.trim(); swapNeed(d.querySelector(".needbox"), draw()); const e1 = estFor(it, v); si.parentElement.classList.toggle("est", !!e1); si.parentElement.firstElementChild.textContent = e1 ? "예상 재고" : "재고"; };
    si.addEventListener("input", live); ii.addEventListener("input", live);
    // 엔터(다음): 다음 품목 재고. 입력하면 목록이 다시 그려지므로 갈 곳을 기억해 두고 그린 뒤 포커스
    const jump = (to) => {
      orderFocus = to;
      const el = to && document.querySelector(`#v-main .cell[data-key="${CSS.escape(to.key)}"]`);
      if (el) el.querySelectorAll("input")[to.f].focus(); else document.activeElement.blur();
      // 다시 그리기가 없으면 기억한 칸을 지움 (남아 있으면 나중에 엉뚱한 칸으로 포커스가 감)
      setTimeout(() => { orderFocus = null; }, 50);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    // 재고·발주 어디서든 엔터 → 다음 품목 재고칸 (발주는 직접 눌러서 입력)
    [si, ii].forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const rows = [...document.querySelectorAll("#orderList .cell[data-key]")], nx = rows[rows.indexOf(d) + 1];
      jump(nx ? { key: nx.dataset.key, f: 0 } : null);
    }));
    // 급변 경고: 직전에 센 재고(3일 안) + 그 사이 입고보다 3배 넘게 많거나, 1/3 아래로 줄었는데 예상 사용량으론 설명이 안 되면
    const jumpWarn = () => {
      const a = num(v.s); if (!isFinite(a) || preMode) return null;
      for (let k = 1; k <= 3; k++) {
        const x = addDays(TODAY, -k), r = (db["input." + x] || {})[it.key]; if (!counted(r)) continue;
        const b = num(r.s), f = it.box || 1; if (!(b > 0)) return null;
        const arr = arrBetween(it, x, meatOn(it, x), TODAY, meatOn(it, TODAY) || new Date().getHours() < MEAT_H) / f;
        const c = calc(it, { ...orderWindow(x), days: k, gross: sumGross(x, TODAY, true).s, weGross: weSum(x, TODAY, true), fcVar: fcVar(x, TODAY, true) }, 0, 0), use = c.none ? 0 : c.use / f;
        const up = a >= 3 * (b + arr) && a - (b + arr) >= 2, down = a <= b / 3 && b - a >= 2 && b - a > 3 * use + arr;
        return up || down ? `${it.name}: ${k === 1 ? "어제" : mmdd(x)} ${b} → 오늘 ${a}. 숫자 확인해 주세요` : null;
      }
      return null;
    };
    si.addEventListener("input", () => si.parentElement.classList.remove("warn"));
    d.addEventListener("change", () => {
      const jw = jumpWarn(); si.parentElement.classList.toggle("warn", !!jw); if (jw) toast("⚠ " + jw, 5000);
      const was = pinRank(it, win, inp[it.key]), was86 = !!riskOf(it, inp[it.key]);
      const all = { ...todayInput() };
      // r: 그때 앱이 추천한 발주수량 (나중에 실제 발주와 비교해 학습)
      const e2 = estFor(it, v), s2 = e2 ? e2.v : stockOf(it, v);
      const rc = isFinite(s2) ? calc(it, win, s2, inc) : null;
      const rec = { ...(all[it.key] || {}), s: v.s, o: v.o, r: rc && !rc.none ? rc.orderQty : "" };
      if (e2) { rec.pre = e2.from; rec.es = +e2.v.toFixed(2); } else { delete rec.pre; delete rec.es; } // 사전발주 기록
      if (v.s === "" && v.o === "" && !num(rec.i)) delete all[it.key]; else all[it.key] = rec;
      setKey("input." + TODAY, all);
      // 채점용 기록: 재고가 들어간 경우 (같은 날 다시 고치면 마지막 값이 쓰이도록 시각 포함). v:2 = 입고는 발주 기록으로 계산
      if (isFinite(num(v.s))) { const sv = stockOf(it, v), last = (db.onhand || []).filter((l) => l.k === it.key && l.t.startsWith(TODAY)).pop(); if (!last || num(last.s) !== sv) appendKey("onhand", { t: localStamp(), k: it.key, s: sv, i: inc, v: 2 }); }
      inp[it.key] = rec;
      // 발주 필요가 바뀌면 위로 올리거나 제자리로 (엔터로 갈 곳은 orderFocus, 아니면 지금 포커스 유지)
      // (포커스가 다음 칸으로 옮겨간 뒤에 다시 그려야 같은 품목의 발주칸을 눌렀을 때도 그 칸에 그대로 있음)
      if (was !== pinRank(it, win, inp[it.key]) || was86 || riskOf(it, inp[it.key])) setTimeout(() => {
        if (!orderFocus) { const a = document.activeElement, c = a && a.closest && a.closest("#orderList .cell[data-key]"); if (c) orderFocus = { key: c.dataset.key, f: [...c.querySelectorAll("input")].indexOf(a) }; }
        renderList();
      }, 0);
    });
    return d;
  }
  const localStamp = () => { const n = new Date(); return `${iso(n)} ${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`; };
  let orderFocus = null;
  // 발주 시트 순서 그대로 업체별로 쭉 (발주 필요한 것만 맨 위로, 검색·업체 버튼은 거르기만)
  // 86 위험: 오늘 넣은 재고 + 그 사이 들어올 입고로 오늘 발주분이 들어오기 전까지 못 버틸 것 같은 품목
  // 86 가능성 = 입고 전까지 쓸 양이 가진 양보다 많을 확률 (사용량 오차 = ± 범위와 같은 계산 오차 + Forecast 오차)
  //  재고를 센 시각 이후 남은 오늘 영업분만 셈 (영업 10:30~20:30) · 60% 넘는 것만 띄움 (다 86 난다고 하지 않게)
  // 재고는 보통 런치 전 아침에 세고 14:30 발주 마감 전에 입력 → 마감 전 입력은 오늘 영업 전체가 남은 것으로 봄
  const OPEN_H = 10.5, CLOSE_H = 20.5, SHOW_P = 0.6, ORDER_CUTOFF_H = 14.5; // 영업 10:30~20:30, 런치는 15시 전 (시간대별 비율은 시트 hourShare, 없으면 비례)
  const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  function riskOf(it, v) {
    if (!v || v.s === "" || !isFinite(num(v.s))) return null;
    const w = orderWindowFor(it, TODAY), until = addDays(w.deliv, it.thaw || 0); // 오늘 발주가 들어와서 쓸 수 있는 날 전까지 (해동 품목은 입고 다음 날)
    const days = Math.round((parseISO(until) - parseISO(TODAY)) / 864e5); if (days < 1) return null;
    let arr = 0; const arrs = []; for (let k = 0; k <= 7; k++) arrivalsOf(it, addDays(TODAY, -k)).forEach((a) => { if ((a.d > TODAY || (a.d === TODAY && meatOn(it, TODAY))) && a.d < until && (k > 0 || a.legacy)) { arr += a.q; arrs.push(a); } });
    const log = (db.onhand || []).filter((l) => l.k === it.key && l.t.startsWith(TODAY)).pop();
    const hh = log ? +log.t.slice(11, 13) + +log.t.slice(14, 16) / 60 : new Date().getHours() + new Date().getMinutes() / 60;
    const left = leftOf(hh, TODAY);
    const gross = left * dayGross(TODAY, false).v + sumGross(addDays(TODAY, 1), until, false).s;
    const weGross = (isWE(TODAY) ? left * dayGross(TODAY, false).v : 0) + weSum(addDays(TODAY, 1), until, false);
    const r = calc(it, { ...w, end: until, days: Math.max(1, days - 1 + left), gross, weGross, fcVar: fcVar(TODAY, until, false, left) }, 0, 0); if (r.none || !(r.use > 0)) return null;
    const have = stockOf(it, v) + arr;
    const p = r.sd > 0 ? 1 - phi((have - r.use) / r.sd) : have < r.use ? 1 : 0;
    if (p < SHOW_P) return null;
    // 언제 바닥나는지: 날마다 매출 비율로 사용량을 나누고(입고는 그날 아침에 더함), 그날 안에서는 영업시간에 비례해 시각으로 (런치 = 15시 전)
    let stock = stockOf(it, v), when = `${DOW[dow(until)]} 입고 전`, at = days + 1; // at: 오늘부터 바닥날 때까지 (일 단위, 정렬용)
    for (let d = TODAY; d < until && gross > 0; d = addDays(d, 1)) {
      arrs.forEach((a) => { if (a.d === d) stock += a.q; });
      const first = d === TODAY, gd = (first ? left : 1) * dayGross(d, false).v, ud = r.use * gd / gross;
      if (!(ud > 0)) continue;
      if (stock - ud < 0) {
        // 그날 매출 누적 비율로 시각을 구함 (오늘 센 뒤라면 센 시각부터 남은 매출 중 비율)
        const c0 = first && left < 1 ? hourCum(d, hh) : 0, hr = Math.min(CLOSE_H, Math.max(OPEN_H, hourAt(d, c0 + Math.max(0, stock) / ud * (1 - c0))));
        const hrR = Math.round(hr); at = Math.round((parseISO(d) - parseISO(TODAY)) / 864e5) + hr / 24; when = `${first ? "오늘" : DOW[dow(d)]} ${hrR < 15 ? "런치" : "디너"} ${String(hrR).padStart(2, "0")}:00`; break;
      }
      stock -= ud;
    }
    return { it, have, use: r.use, out: until, p, when, at };
  }
  function risk86(M, inp) {
    return M.items.filter((i) => !i.ledgerOnly).map((it) => riskOf(it, inp[it.key])).filter(Boolean).sort((a, b) => a.at - b.at || b.p - a.p); // 가장 먼저 바닥나는 순
  }
  function renderList() {
    preMemo = new Map();
    const M = model(), win = orderWindow(TODAY), inp = todayInput();
    const q = $("q").value.trim().toLowerCase();
    const box = $("orderList"); box.innerHTML = "";
    const rk = preMode ? [] : risk86(M, inp); // 예상 재고로는 86 위험을 안 띄움
    if (rk.length) {
      box.insertAdjacentHTML("beforeend", `<div class="risk86"><div class="r-top"><b>86 위험</b></div>` +
        rk.map((x) => `<button type="button" data-key="${esc(x.it.key)}"><span>${esc(x.it.name)}<em>${esc(x.when)} 부족 · 재고 ${r1(x.have)}${esc(x.it.pk.stock || "")}</em></span><small>${Math.min(99, Math.round(x.p * 100))}%</small></button>`).join("") + `</div>`);
      box.querySelector(".risk86").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const el = box.querySelector(`.cell[data-key="${CSS.escape(b.dataset.key)}"]`); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); } });
    }
    let groups = new Map();
    M.items.filter((i) => !i.ledgerOnly).forEach((it) => {
      const hit = q ? it.name.toLowerCase().includes(q) || norm(it.name).includes(norm(q)) : !cat || it.vendor === cat;
      if (!hit) return;
      const v = it.vendor || "업체 미지정";
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(it);
    });
    // 재고 넣은 품목 중 발주필요 → 부족·여유 → 발주완료 순으로 맨 위 "발주 필요"에 모음
    let top = [];
    groups.forEach((list, v) => { const keep = list.filter((it) => { const k = pinRank(it, win, inp[it.key]); if (k < 0) return true; top.push([k, it]); return false; }); if (keep.length) groups.set(v, keep); else groups.delete(v); });
    const nBuy = top.filter(([k]) => k === 0).length;
    const ord = new Map(M.items.map((it, i) => [it, i])); // 같은 순위 안에서는 발주 시트 순서
    top = top.sort((a, b) => a[0] - b[0] || ord.get(a[1]) - ord.get(b[1])).map(([, it]) => it);
    if (top.length) groups = new Map([["발주 필요", top], ...groups]);
    // "발주 필요 N" 줄은 항상 (오른쪽에 사전발주 ON 버튼)
    box.insertAdjacentHTML("beforeend", `<div class="sect sect-need${top.length ? "" : " zero"}"><span>발주 필요 <small>${nBuy}</small></span><button type="button" class="pre${preMode ? " on" : ""}" id="preBtn" aria-pressed="${preMode}">사전발주 ${preMode ? "ON" : "OFF"}</button></div>`);
    box.querySelector("#preBtn").addEventListener("click", () => { setPre(!preMode); renderMain(); });
    // 사전발주: 발주할 날 고르기 (오늘부터 일주일, 일요일 빼고) + 그날 발주분 입고일로 화살표
    if (preMode) {
      const pd = pDay(), dl = delivery(pd);
      // 오늘부터 일요일 빼고 7일, 고른 날의 입고일이 그 뒤면 입고일까지 늘림
      const days = []; for (let k = 0; k < 14 && (days.length < 7 || days[days.length - 1] < dl); k++) { const x = addDays(TODAY, k); if (dow(x) !== 0) days.push(x); }
      box.insertAdjacentHTML("beforeend", `<div class="weekwrap prewrap"><svg class="weekarc" id="preArc" aria-hidden="true"></svg><div class="week predays" id="preStrip" style="grid-template-columns: repeat(${days.length}, minmax(0, 1fr))">${days.map((x) => `<button type="button" data-d="${x}" class="${x === pd ? "today" : x === dl ? "deliv" : ""}"><b>${DOW[dow(x)]}</b><span>${mmdd(x)}</span></button>`).join("")}</div></div>`);
      box.querySelector(".predays").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; preDay = b.dataset.d; renderMain(); });
      requestAnimationFrame(() => drawWeekArc($("preArc"), $("preStrip")));
    }
    let n = 0;
    groups.forEach((list, v) => {
      if (v !== "발주 필요") box.insertAdjacentHTML("beforeend", `<div class="sect"><span>${esc(v)} <small>${list.length}</small></span></div>`);
      const g = document.createElement("div"); g.className = "group";
      list.forEach((it) => g.appendChild(rowEl(it, win, inp)));
      box.appendChild(g); n += list.length;
    });
    $("nores").hidden = n > 0;
    if (orderFocus) { const el = document.querySelector(`#v-main .cell[data-key="${CSS.escape(orderFocus.key)}"]`); if (el) el.querySelectorAll("input")[orderFocus.f].focus(); orderFocus = null; }
    $("cats").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === cat));
  }

  $("cats").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; cat = cat === b.dataset.c ? null : b.dataset.c; $("q").value = ""; renderList(); });
  $("q").addEventListener("input", renderList);

  // ---------- 프랩 ----------
  // 프랩 1일 예상: 최근 판매 달의 프랩 사용량 ÷ 그달 Gross × 오늘 Forecast
  // 프랩 1일 예상을 주방에서 세는 단위로: 레시피 1번 분량(1X), 포션, 또는 원재료 PK/EA
  function prepExpect(M, name, code, gToday, pdf) {
    const p = pdf || M.prep.find((x) => (code && x.code === code) || x.name === name || dice(toKo(x.name), name) > 0.7 || dice(x.name, name) > 0.9);
    const r = p && prepExpectFor(M, p, gToday);
    if (r && r.shelf == null) r.shelf = p.shelf;
    // cfg.label: 단위 이름만 바꿔 보여줌 (냉동마늘쫑 1EA = 1팩 → PK)
    const cf = (p && (db.prepCfg || {})[p.name]) || {};
    if (r && cf.label) r.label = cf.label; // 계산·반올림·학습은 원래 단위로
    // cfg.memo: 이름 아래 설명 (2X = 1/6 팬 1개), cfg.hot: 빨간 글씨로 (1kg = 라자냐 7오더)
    if (r && cf.memo) r.memo = cf.memo;
    if (r && cf.hot) r.hot = cf.hot;
    return r || null;
  }
  function prepExpectFor(M, p, gToday) {
    const lastB = M.withB[M.withB.length - 1];
    if (!lastB || !lastB.prepUse) return null;
    // 프랩 사용량은 최근 3개월 메뉴 판매 기준 (Gross 100만원당), 커팅비프 나누기만 최근 달 판매 그대로
    const perL = (v) => (v / (lastB.gross / 1e6)) * (gToday / 1e6);
    const per = (v) => v * (gToday / 1e6);
    const y = String(p.yield || "");
    const yg = (() => { const m = /([\d.,]+)\s*(kg|g|l|ml)\b/i.exec(y); if (!m) return null; const v = num(m[1]); return /^(kg|l)$/i.test(m[2]) ? v * 1000 : v; })();
    const yn = (() => { const m = /([\d.]+)\s*(portion|order|ea|개|인분)/i.exec(y); return m ? num(m[1]) : null; })();
    // 최근 3개월 평균과 최근 달 중 큰 쪽 (라자냐처럼 요즘 더 나가는 건 최근 달, 반짝 줄어든 건 평균으로 모자라지 않게)
    const lastR = (k) => (lastB.prepUse.get(k) || 0) / (lastB.gross / 1e6);
    let g = Math.max(M.blend.prep.get(p.name) || 0, lastR(p.name)), ea = Math.max(M.blend.prep.get(p.name + "|ea") || 0, lastR(p.name + "|ea"));
    const cfg = (db.prepCfg || {})[p.name] || {};
    const shelf = p.shelf;
    // cfg.rate: 매장 기준 "Gross 100만원당 몇 단위" (로즈마리 400만원당 1팩 = 0.25)
    if (cfg.rate) return { e: cfg.rate * (gToday / 1e6), unit: cfg.unit || "EA" };
    // 커팅비프: 시즐 스테이크&립 1개마다 채끝 270g에서 100g이 나옴. 스테이크 파스타·샐러드·플래터·피자에 먼저 쓰고 모자라면 부채살 1/2컷
    if (cfg.split || cfg.shortOf) {
      const sp = cfg.split || ((db.prepCfg || {})[cfg.shortOf] || {}).split; if (!sp) return null;
      const dp = cfg.split ? p.name : cfg.shortOf;
      const sales = (mget(lastB.m).sales || { rows: [] }).rows;
      const n = sales.reduce((a, r) => { const x = M.resolveMenu(r.menu, r.cat); return a + (x && x.recipe && x.recipe.name.startsWith(sp.from) ? r.qty * (x.mult || 1) : 0); }, 0);
      const need = (lastB.prepUse.get(dp) || 0) + (lastB.prepUse.get(dp + "|ea") || 0) * (sp.portion || 110);
      const supply = n * sp.g;
      if (cfg.split) return { e: perL(Math.min(need, supply)) / sp.g, unit: "포션", note: `시즐 스테이크&립 1개당 ${sp.g}g` };
      const it = M.items.find((i) => i.key === cfg.item);
      const halves = perL(Math.max(0, need - supply)) / (sp.portion || 110);
      return { e: halves / (cfg.per || 2), unit: (it && it.pk.stock) || "EA", note: `커팅비프 부족분 · 1EA = 1/2컷 ${cfg.per || 2}개` };
    }
    // 매장에서 정한 단위 (prepCfg): X = 레시피 1번 분량, PK = 원재료 팩(item) 또는 1포션 1팩, EA = 개수
    if (cfg.unit) {
      const batchG = yg || p.ing.reduce((a, i) => { const q = parseQty(i.w, i.v) || {}; return a + (q.g || q.ml || 0); }, 0) || null;
      // 라인 레시피에 "25 g | 6 ea"처럼 같이 적힌 걸로 1개 무게를 구함
      const eaGs = []; M.line.forEach((r) => r.ing.forEach((i) => { const t = M.resolveIng(i.n), q = parseQty(i.w, ""), c = parseQty("", i.v); if (t && t.kind === "prep" && t.id === p.name && q && q.g && c && c.ea) eaGs.push(q.g / c.ea); }));
      const eaG = cfg.eaG || (eaGs.length ? eaGs.reduce((a, b) => a + b, 0) / eaGs.length : yg && yn ? yg / yn : null);
      const base = { batch: cfg.batch ?? !/^(EA|포션|g)$/.test(cfg.unit), step: cfg.step || 1, shelf };
      // cfg.panG: 매장에서 담는 통 단위 (서드 = 1/3 팬, 식스 = 1/6 팬, 나인 = 1/9 팬) 한 통의 g. 포션으로 쓴 건 portionG로 g 환산
      if (cfg.panG) {
        const pG = cfg.portionG || eaG || (yg && yn ? yg / yn : batchG);
        return { ...base, e: per(g + ea * (pG || 0)) / cfg.panG, unit: cfg.unit, note: cfg.note || "" };
      }
      const stepNote = cfg.step > 1 ? `${cfg.step}${cfg.unit}씩` : "";
      const join = (...a) => a.filter(Boolean).join(" · ");
      if (cfg.unit === "X" && batchG) return { ...base, e: per(g + ea * (eaG || 0)) / batchG, unit: "X", note: join(`1X = ${won(batchG)}g`, cfg.note, stepNote) };
      // from: "ledger" = 그 원재료의 수불현황 실제 사용량으로 (만다린 캔처럼 레시피 개수로는 캔을 셀 수 없을 때)
      if (cfg.item && cfg.from === "ledger") {
        const it = M.items.find((i) => i.key === cfg.item);
        // 단위를 g으로 정하면 품목 1단위 g으로 환산 (깐마늘 1EA = 1kg)
        const f = it && cfg.unit === "g" && it.pk.g ? it.pk.g : 1;
        if (it && it.rateA != null) return { ...base, e: (it.fixedA + it.rateA * (gToday / 1e6)) * f, unit: cfg.unit || it.pk.stock || "EA", note: join(cfg.note || it.name, stepNote) };
      }
      if (cfg.unit === "PK" && cfg.item) {
        const it = M.items.find((i) => i.key === cfg.item), st = it && toStock({ g: per(g + ea * (eaG || 0)) }, it.pk);
        if (st != null) return { ...base, e: st, unit: it.pk.stock || "PK", note: join(it.name, stepNote) };
      }
      if (cfg.unit === "PK" && eaG) return { ...base, e: per(ea + g / eaG), unit: "PK", note: join(`1PK = 1포션 (${won(eaG)}g)`, stepNote) };
      // cfg.per: 1EA에 든 개수 (브리오슈 1덩이 = 8조각)
      if (cfg.unit === "EA") return { ...base, e: per(ea + (eaG ? g / eaG : 0)) / (cfg.per || 1), unit: "EA", note: join(cfg.note, stepNote) };
    }
    // 원재료가 품목 하나면 그 품목의 발주단위(PK 등)로: 브로콜리, 핑거립처럼 포션 무게만 정해진 프랩
    const ings = p.ing.map((i) => ({ i, t: M.resolveIng(i.n) })).filter((x) => x.t && !x.t.skip && !(x.t.kind === "prep" && x.t.id === p.name));
    const itemOf = (x) => x && x.t.kind === "item" && M.items.find((it) => it.key === x.t.id);
    // 1포션 무게: Yield에 g이 있으면 그것, "1 Portion"·빈 Yield처럼 개수만 있으면 재료 무게 합 ÷ 개수 (치킨 다이스 포션 = 닭가슴살 50g)
    const ingG = p.ing.reduce((a, i) => { const q = parseQty(i.w, i.v) || {}; return a + (q.g || 0); }, 0);
    const portionG = yg && (/\bor\b/i.test(y) || yn === 1) ? yg : null;
    const ingPortionG = !yg && ingG && (yn || !y.trim()) ? ingG / (yn || 1) : 0;
    // cfg.raw: 프랩 레시피에 원재료가 자기 자신으로 적힌 경우(루꼴라, 할라피뇨 등) 실제 원재료 품목
    const raw1 = (cfg.raw && M.items.find((i) => i.key === cfg.raw)) || (ings.length === 1 && itemOf(ings[0])) || null;
    // 레시피로 사용량을 못 구하면 원재료의 수불현황 실제 사용량으로
    const G100 = gToday / 1e6;
    const ledgerFallback = () => {
      if (raw1 && raw1.rateA != null) return { e: raw1.fixedA + raw1.rateA * G100, unit: raw1.pk.stock || raw1.unit || "EA", note: `${raw1.name} 사용량 기준` };
      const batchG = yg || p.ing.reduce((a, i) => { const q = parseQty(i.w, i.v) || {}; return a + (q.g || q.ml || 0); }, 0);
      const c = ings.map((x) => ({ it: itemOf(x), q: parseQty(x.i.w, x.i.v) })).filter((x) => x.it && x.it.rateA != null && x.q && (x.q.g || x.q.ml) && (x.it.pk.g || x.it.pk.ml))
        .sort((a, b) => (b.q.g || b.q.ml) - (a.q.g || a.q.ml))[0];
      if (c && batchG) {
        const n = ((c.it.fixedA + c.it.rateA * G100) * (c.it.pk.g || c.it.pk.ml)) / (c.q.g || c.q.ml);
        // "1 Order"짜리는 1포션씩 만드니 포션으로
        return yn === 1 && !yg ? { e: n, unit: "포션", note: `1포션 = ${won(batchG)}g · ${c.it.name} 사용량 기준` } : { e: n, unit: "X", batch: true, note: `1X = ${won(batchG)}g · ${c.it.name} 사용량 기준` };
      }
      if (g) return { e: per(g) / 1000, unit: "kg" };
      return null;
    };
    if (raw1 && (portionG || !yg)) {
      // g과 포션이 섞여 쓰이면 포션도 g으로 (포션만 쓰는 건 아래에서 포션 단위로 보여줌)
      const it = raw1, G = g + ea * (portionG || (g ? ingPortionG : 0));
      const s = G ? toStock({ g: per(G) }, it.pk) : null;
      if (s != null) return { e: s, unit: it.pk.stock || it.unit || "EA", note: it.name };
    }
    // 원재료 여러 개를 g으로 섞는 포션(머쉬룸 믹스 = 새송이 30g + 느타리 30g)은 kg으로
    const parts = ings.map((x) => ({ n: itemOf(x) ? itemOf(x).name : null, g: (parseQty(x.i.w, x.i.v) || {}).g })).filter((x) => x.n && x.g);
    if (!yg && ea && parts.length > 1 && parts.length === ings.length) {
      const sum = parts.reduce((a, x) => a + x.g, 0), G = g + ea * sum;
      const lo = Math.min(...parts.map((x) => x.g));
      return { e: per(G) / 1000, unit: "kg", note: `${parts.map((x) => x.n.replace(/\(.*\)/, "")).join(" + ")} ${parts.map((x) => Math.round(x.g / lo)).join(":")}` };
    }
    if (!g && !ea) return ledgerFallback();
    if (portionG) return { e: per(ea + g / portionG), unit: "포션", note: `1포션 = ${won(portionG)}g` };
    // "10 Order"처럼 오더 수로 정해진 프랩은 오더로 (cfg.step 단위로 만듦)
    if (yn > 1 && /order/i.test(y) && !yg && !/약/.test(y) && ea) return { e: per(ea), unit: "오더", batch: true, step: cfg.step || 1, shelf: p.shelf, note: cfg.step > 1 ? `${cfg.step}오더씩` : "" };
    if (/약/.test(y) && !yg) return ledgerFallback(); // "약 15 Order"는 기준이 없어 원재료 사용량으로
    // "850g (약 10 Portion)"처럼 둘 다 있으면 포션을 g으로 바꿔 합침
    if (yg && yn && ea) { g += ea * (yg / yn); ea = 0; }
    if (yg && g && !ea) return { e: per(g) / yg, unit: "X", batch: true, note: `1X = ${won(yg)}${/ml|l\b/i.test(y) ? "ml" : "g"}` };
    if (ea && !g) return yn > 1 ? { e: per(ea) / yn, unit: "X", batch: true, note: `1X = ${yn}포션` } : { e: per(ea), unit: "포션" };
    return yg ? { e: per(g) / yg, unit: "X", batch: true, note: `1X = ${won(yg)}g` } : ledgerFallback();
  }
  // 프랩 재고 학습: 어제 재고 + 어제 만든 양(앱이 보여준 필요량) − 오늘 재고 = 하루 실제 사용량
  //  실제 ÷ 앱 예상(하루치)의 중앙값을 그 프랩의 보정 배수로 (3번 이상, 0.5~2배)
  function prepLearn(id, unit) {
    const byDay = new Map();
    (db.prepLog || []).filter((l) => l.id === id && l.u === unit).forEach((l) => byDay.set(l.t.slice(0, 10), l));
    const days = [...byDay.keys()].sort(), r = [];
    for (let i = 1; i < days.length; i++) {
      if (addDays(days[i - 1], 1) !== days[i]) continue; // 하루 사이만 (그 사이 만든 양을 모르면 뺌)
      const a = byDay.get(days[i - 1]), b = byDay.get(days[i]);
      const actual = num(a.s) + (num(a.need) || 0) - num(b.s);
      if (actual > 0 && a.e > 0) r.push(Math.min(5, Math.max(0.2, actual / a.e)));
    }
    const last = r.slice(-10).sort((x, y) => x - y);
    return { k: last.length >= 3 ? Math.min(2, Math.max(0.5, last[Math.floor(last.length / 2)])) : 1, n: r.length };
  }
  function renderPrep() {
    const M = model();
    const g = dayGross(TODAY, false);
    $("prepBanner").className = "banner" + (g.src === "fc" ? "" : " soft");
    $("prepBanner").innerHTML = `<span>오늘 ${DOW[dow(TODAY)]}요일 Forecast${g.src === "fc" ? (fcBias(TODAY).k !== 1 ? ` (보정 ${fcBias(TODAY).k > 1 ? "+" : ""}${Math.round((fcBias(TODAY).k - 1) * 100)}%)` : "") : " (추정)"}</span><span>${won(g.v)}원</span>`;
    const sheet = M.prepSheet;
    const list = sheet.length ? sheet.map((x) => ({ name: x.name, code: x.code || "", shelf: x.shelf, section: x.section || "" }))
      : M.prep.map((p) => ({ name: p.short || p.name, code: p.code || "", shelf: p.shelf }));
    const store = db["prepOnhand." + TODAY] || {};
    const box = $("prepList");
    if (!list.length) { box.innerHTML = '<div class="empty"><b>프랩 목록이 없어요</b>데이터 파일에서 프랩 시트나 Prep 레시피를 올려 주세요.</div>'; return; }
    box.innerHTML = "";
    const entries = list.map((x) => {
      // prepMap: 프랩 시트 이름 → Prep 레시피 이름 (자동으로 못 맞춘 것)
      const pm = (db.prepMap || {})[x.name];
      const pdf = (pm && M.prep.find((p) => p.name === pm)) || M.prep.find((p) => (x.code && p.code === x.code) || dice(toKo(p.name), x.name) > 0.75);
      const ex = prepExpect(M, x.name, x.code, g.v, pdf);
      const shelf = x.shelf || (pdf && pdf.shelf) || (ex && ex.shelf) || null;
      // 한 번에 만드는 소스·오더류는 쉘프라이프 동안 쓸 양으로
      // 한 번에 만드는 프랩은 쉘프라이프의 절반 기간 Forecast 합으로 (3days → 1.5days, 1day는 그대로)
      const days = shelf > 1 ? shelf / 2 : 1;
      const id0 = (x.code ? x.code + " " : "") + x.name;
      if (ex) {
        ex.eRaw = ex.e; // 학습 전 하루 예상 (채점용)
        const L = prepLearn(id0, ex.unit);
        if (L.k !== 1) { ex.e *= L.k; if (Math.abs(L.k - 1) >= 0.05) ex.note = [ex.note, `재고 학습 ×${L.k.toFixed(2)}`].filter(Boolean).join(" · "); }
      }
      // 하루 예상(학습 반영)과 내일 예상: 오늘은 충분해도 내일 아침에 바로 만들어야 하는지(ASAP) 판단용
      if (ex) { ex.eDay = ex.e; ex.eTomorrow = g.v > 0 ? ex.e * dayGross(addDays(TODAY, 1), false).v / g.v : ex.e; }
      if (ex && ex.batch && days > 1 && g.v > 0) {
        const full = Math.floor(days), part = days - full;
        ex.e *= (sumGross(TODAY, addDays(TODAY, full), false).s + part * dayGross(addDays(TODAY, full), false).v) / g.v;
      }
      // 이름 아래: Prep 레시피의 Yield (있으면 "1X = 650g"은 겹치니 뺌)
      const yl = pdf && pdf.yield && !/as needed/i.test(pdf.yield) ? `Yield : ${pdf.yield}` : "";
      if (ex) ex.note = [yl, ex.memo, ...String(ex.note || "").split(" · ").filter((t) => t && !(yl && /^1X = [\d,.]+\s*(g|ml)$/i.test(t)))].filter(Boolean).join(" · ");
      return { ...x, shelf, ex, id: (x.code ? x.code + " " : "") + x.name };
    });
    // 프랩은 소수 첫째 자리까지 (2.0, 1.5). 예상은 반올림, 필요량은 올림, 0보다 크면 최소 0.1. g·cc는 정수
    const rpu = (v, u, up) => {
      if (/^(g|cc)$/.test(u)) return String(v > 1e-9 ? Math.max(1, up ? Math.ceil(v - 1e-9) : Math.round(v)) : 0);
      return (v > 1e-9 ? Math.max(0.1, (up ? Math.ceil(v * 10 - 1e-6) : Math.round(v * 10)) / 10) : 0).toFixed(1);
    };
    // g은 1000 넘으면 kg, cc는 L로 보여줌
    const disp = (unit, e) => unit === "g" && e >= 1000 ? { u: "kg", f: 1000 } : unit === "cc" && e >= 1000 ? { u: "L", f: 1000 } : { u: unit, f: 1 };
    entries.forEach(({ name, code, shelf, ex, id }) => {
      const unit = ex ? ex.unit : "";
      const dd = ex ? disp(unit, ex.e) : { u: "", f: 1 };
      if (ex && ex.label && dd.f === 1) dd.u = ex.label;
      const v = { s: store[id] ?? "" };
      const d = document.createElement("div");
      d.className = "cell";
      const draw = () => {
        v.need = 0;
        if (!ex) return '<span class="need none"><b>?</b></span>';
        if (v.s === "") return '<span class="need none"><b>–</b></span>';
        // 2days 이상 프랩은 오늘 쓸 양 + 내일 아침(반나절)치까지 있어야 충분 → 아슬아슬하면 오늘 미리 만들도록 필요량으로
        const target = shelf && shelf <= 1 ? ex.e : Math.max(ex.e * 1.1, ex.eDay + ex.eTomorrow * 0.5);
        let r = target - (num(v.s) * dd.f || 0);
        if (r <= ex.e * 0.03) return '<span class="need enough"><b>충분</b></span>';
        if (ex.step > 1 || ex.unit === "EA") r = Math.ceil(r / (ex.step || 1) - 1e-9) * (ex.step || 1); // EA는 통으로
        v.need = +rpu(r / dd.f, dd.u, true) * dd.f; // 학습용: 이만큼 만든다고 봄
        return `<span class="need buy"><b>${rpu(r / dd.f, dd.u, true)}<small>${esc(dd.u)}</small></b><span>필요량</span></span>`;
      };
      d.innerHTML =
        `<div class="c-top"><span class="c-name">${code ? `<small style="color:var(--muted);font-weight:600;margin-right:5px">${esc(code)}</small>` : ""}${esc(name)}${ex && (ex.note || ex.hot) ? `<small class="pnote">${esc(ex.note || "")}${ex.hot ? `${ex.note ? " · " : ""}<em class="hot">${esc(ex.hot)}</em>` : ""}</small>` : ""}</span>${shelf ? `<span class="chip d${Math.min(shelf, 3)}">${shelf}${shelf > 1 ? "days" : "day"}</span>` : ""}</div>` +
        `<div class="p-bot"><label class="fld"><span>재고(On Hand)${dd.u ? ` <em class="u">${esc(dd.u)}</em>` : ""}</span><input type="number" step="any" min="0" enterkeyhint="next" placeholder="–" value="${esc(v.s)}" aria-label="${esc(name)} 재고"></label>` +
        `<span class="fld ro"${ex && ex.note ? ` title="${esc(ex.note)}"` : ""}><span>예상${dd.u ? " " + esc(dd.u) : ""}</span><b>${ex ? rpu(ex.e / dd.f, dd.u) : "–"}</b></span><span class="needbox">${draw()}</span></div>`;
      const inp = d.querySelector("input");
      // 엔터(다음)를 누르면 바로 아래 프랩 재고칸으로 (iOS도 리턴 키가 나오게 type=number)
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const all = [...$("prepList").querySelectorAll("input")], next = all[all.indexOf(inp) + 1];
        if (next) { next.focus(); next.scrollIntoView({ block: "center", behavior: "smooth" }); } else inp.blur();
      });
      inp.addEventListener("input", () => { v.s = inp.value.trim(); swapNeed(d.querySelector(".needbox"), draw()); });
      inp.addEventListener("change", () => {
        const all = { ...(db["prepOnhand." + TODAY] || {}) }; if (v.s === "") delete all[id]; else all[id] = v.s; setKey("prepOnhand." + TODAY, all);
        // 학습 기록: 재고·만들 양·앱 하루 예상을 같은 단위(ex.unit 기준)로
        if (ex && v.s !== "" && isFinite(num(v.s))) appendKey("prepLog", { t: localStamp(), id, u: ex.unit, s: num(v.s) * dd.f, need: v.need || 0, e: ex.eRaw });
      });
      box.appendChild(d);
    });
  }

  // ---------- Forecast ----------
  let fcWeekStart = mondayOf(TODAY);
  // ---------- 실제 Gross를 MIS에서 가져오기 (폰 → PC, GW 전송과 같은 길) ----------
  // [GW에서 가져오기] → 시트 salesPush pending {from, to} → PC 확장이 MIS 매출현황(MiscellaneousReport, 일자별)을 조회 → forecast[날짜].act를 채우고 결과를 salesPush에
  function renderSales() {
    const el = $("salesBar"); if (!el) return;
    if (!API) { el.hidden = true; return; }
    el.hidden = false;
    renderMenuSales();
    const ag = db.misAgent || {}, p = db.salesPush && db.salesPush.kind !== "menu" ? db.salesPush : null;
    const agOn = ag.at && Date.now() - ag.at < (ag.mode === "ondemand" ? 20 * 60e3 : 180000);
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    // 매출 조회는 1분이면 끝남 → 3분 넘게 그대로면 멈춘 걸로 보고 다시 누를 수 있게
    const stale = p && /pending|running/.test(p.status) && Date.now() - (p.startAt || p.at) > 3 * 60e3;
    let st, cls = "";
    if (p && p.status === "pending" && !stale) { st = agOn ? "PC가 MIS 매출현황 여는 중…" : "PC가 꺼져 있어 기다리는 중"; cls = "run"; }
    else if (p && p.status === "running" && !stale) { st = "PC에서 매출 읽는 중…"; cls = "run"; }
    else if (p && p.status === "done") { st = `✓ ${hhmm(p.doneAt)} ${p.text || "가져옴"}`; cls = "ok"; }
    else if (p && p.status === "error") { st = `⚠ ${hhmm(p.doneAt)} 못 가져옴 · 눌러서 보기`; cls = "bad"; }
    else if (stale) { st = "⚠ PC 응답 없음 · 다시 눌러 주세요"; cls = "bad"; }
    else { const to = addDays(TODAY, -1); st = `(${mmdd(mondayOf(to))} ~ ${mmdd(to)})`; } // 이번 주 월요일 ~ 어제
    el.innerHTML = `<div class="mis-t"><b>Gross Sales 불러오기</b><span class="mis-s ${cls}${p && p.status === "error" ? " tap" : ""}">${esc(st)}</span></div>` +
      `<span class="mis-act">${pinBtn()}<button type="button" class="btn" id="salesGo"${cls === "run" ? " disabled" : ""}>불러오기</button></span>`;
    bindPin(el);
    el.querySelector(".mis-s.tap")?.addEventListener("click", () => alert(p.text || ""));
    el.querySelector("#salesGo").addEventListener("click", async () => {
      if (!(await unlock())) return;
      if (db.salesPush && db.salesPush.kind === "menu" && /pending|running/.test(db.salesPush.status) && Date.now() - (db.salesPush.startAt || db.salesPush.at) < 5 * 60e3) { toast("메뉴 판매 불러오기가 끝난 뒤에 눌러 주세요"); return; }
      const to = addDays(TODAY, -1), from = mondayOf(to);
      setKey("salesPush", { id: Date.now(), at: Date.now(), status: "pending", from, to });
      misFastUntil = Date.now() + 180000;
      toast(agOn ? "PC로 보냈어요 · 1~2분 뒤 채워져요" : "보냈어요 · PC가 켜지면 가져와요");
    });
  }
  // [메뉴 판매 불러오기] → salesPush {kind: "menu", 최근 4주 ~ 어제} → PC가 MIS 메뉴별 매출현황을 하루씩 조회 → menuDay.날짜 (이미 받은 날은 건너뜀)
  //  날짜별 메뉴 판매로 주말에 몰리는 메뉴(플래터·브런치)를 알고, 레시피로 품목마다 주말 배수를 계산
  function renderMenuSales() {
    const el = $("menuBar"); if (!el) return;
    if (!API) { el.hidden = true; return; }
    el.hidden = false;
    const p = db.salesPush && db.salesPush.kind === "menu" ? db.salesPush : null;
    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    const stale = p && /pending|running/.test(p.status) && Date.now() - (p.startAt || p.at) > 5 * 60e3;
    const n = Object.keys(db).filter((k) => k.startsWith("menuDay.") && k.slice(8) >= addDays(TODAY, -28)).length;
    let st, cls = "";
    if (p && p.status === "pending" && !stale) { st = "PC가 MIS 메뉴별 매출현황 여는 중…"; cls = "run"; }
    else if (p && p.status === "running" && !stale) { st = "PC에서 날짜별 메뉴 판매 읽는 중…"; cls = "run"; }
    else if (p && p.status === "done") { st = `✓ ${hhmm(p.doneAt)} ${p.text || "가져옴"}`; cls = "ok"; }
    else if (p && p.status === "error") { st = `⚠ ${hhmm(p.doneAt)} 못 가져옴 · 눌러서 보기`; cls = "bad"; }
    else if (stale) { st = "⚠ PC 응답 없음 · 다시 눌러 주세요"; cls = "bad"; }
    else st = `요일별 메뉴 쏠림 → 주말 보정 · 최근 4주 중 ${n}일 받음`;
    el.innerHTML = `<div class="mis-t"><b>메뉴 판매 불러오기</b><span class="mis-s ${cls}${p && p.status === "error" ? " tap" : ""}">${esc(st)}</span></div>` +
      `<span class="mis-act">${pinBtn()}<button type="button" class="btn" id="menuGo"${cls === "run" ? " disabled" : ""}>불러오기</button></span>`;
    bindPin(el);
    el.querySelector(".mis-s.tap")?.addEventListener("click", () => alert(p.text || ""));
    el.querySelector("#menuGo").addEventListener("click", async () => {
      if (!(await unlock())) return;
      if (db.salesPush && /pending|running/.test(db.salesPush.status) && Date.now() - (db.salesPush.startAt || db.salesPush.at) < 3 * 60e3) { toast("Gross 불러오기가 끝난 뒤에 눌러 주세요"); return; }
      setKey("salesPush", { id: Date.now(), at: Date.now(), status: "pending", kind: "menu", from: addDays(TODAY, -28), to: addDays(TODAY, -1) });
      misFastUntil = Date.now() + 300000;
      toast("PC로 보냈어요 · 처음엔 4주치라 2~3분 걸려요");
    });
  }
  function renderForecast() {
    renderSales();
    const sel = $("wSel");
    const y = +TODAY.slice(0, 4);
    if (!sel.options.length) {
      // 올해 1주차 월요일부터 내년 1월까지
      let d = mondayOf(`${y}-01-04`);
      while (d < `${y + 1}-01-08`) { const w = isoWeek(d); sel.add(new Option(`${w.w}주차  ${mmdd(d)} ~ ${mmdd(addDays(d, 6))}`, d)); d = addDays(d, 7); }
    }
    sel.value = fcWeekStart;
    const box = $("fcRows"); box.innerHTML = "";
    const comma = (v) => (v === "" || v == null || !isFinite(num(v)) ? "" : Math.round(num(v)).toLocaleString("ko-KR"));
    for (let i = 0; i < 7; i++) {
      const d = addDays(fcWeekStart, i);
      const f = (db.forecast || {})[d] || {};
      const row = document.createElement("div");
      const hol = isHoliday(d), de = dataForecast(d);
      row.className = "cell f-row" + (i >= 5 || hol ? " we" : "") + (d === TODAY ? " today" : "");
      row.innerHTML = `<span class="day">${DOW[dow(d)]}<small>${d === TODAY ? "오늘" : mmdd(d)}${hol ? "<em>공휴일</em>" : ""}</small></span>` +
        `<span class="dfc" title="같은 요일·공휴일 실제 매출로 낸 예상 + 이번 주 Forecast 트렌드 절반 반영">${de ? (Math.round(de / 1e4) * 1e4).toLocaleString("ko-KR") : "–"}</span>` +
        `<input class="fc" inputmode="numeric" enterkeyhint="next" placeholder="–" value="${comma(f.fc)}" aria-label="${mmdd(d)} Forecast (원)">` +
        `<input class="act" inputmode="numeric" enterkeyhint="next" placeholder="${d <= TODAY ? "입력" : "–"}" value="${comma(f.act)}" aria-label="${mmdd(d)} 실제 Gross Sales (원)">` + diffHTML(f.fc, f.act);
      const [fi, ai] = row.querySelectorAll("input");
      const upd = () => {
        [fi, ai].forEach((el) => { const v = el.value.replace(/\D/g, ""); const c = v ? Number(v).toLocaleString("ko-KR") : ""; if (el.value !== c) el.value = c; });
        row.lastElementChild.outerHTML = diffHTML(fi.value.replace(/\D/g, ""), ai.value.replace(/\D/g, ""));
        foot(); clearTimeout(fcSaveT); fcSaveT = setTimeout(fcSave, 1200);
      };
      const save = () => { clearTimeout(fcSaveT); fcSave(); };
      fi.addEventListener("input", upd); ai.addEventListener("input", upd);
      fi.addEventListener("change", save); ai.addEventListener("change", save);
      // 엔터 → 같은 칸(Forecast / 실제 Gross)의 다음 날로
      [fi, ai].forEach((el, col) => el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const nx = row.nextElementSibling && row.nextElementSibling.querySelectorAll("input")[col];
        if (nx) nx.focus(); else el.blur();
      }));
      box.appendChild(row);
    }
    foot();
  }
  // 저장은 화면에 보이는 한 주 7칸 전부를 그대로 (입력 멈추고 1.2초 뒤, 또는 칸을 벗어날 때)
  let fcSaveT;
  function fcSave() {
    const rows = [...$("fcRows").querySelectorAll(".f-row")];
    if (rows.length !== 7) return;
    const all = { ...(db.forecast || {}) }; let changed = false;
    rows.forEach((row, i) => {
      const d = addDays(fcWeekStart, i), [fi, ai] = row.querySelectorAll("input");
      const fc = fi.value.replace(/\D/g, ""), act = ai.value.replace(/\D/g, ""), o = all[d] || {};
      if ((o.fc || "") === fc && (o.act || "") === act) return;
      changed = true; if (!fc && !act) delete all[d]; else all[d] = { fc, act };
    });
    if (changed) {
      setKey("forecast", all);
      rows.forEach((row, i) => { const de = dataForecast(addDays(fcWeekStart, i)); row.querySelector(".dfc").textContent = de ? (Math.round(de / 1e4) * 1e4).toLocaleString("ko-KR") : "–"; }); // 트렌드 반영된 데이터 예상
    }
    foot();
  }
  function diffHTML(fc, act) {
    fc = num(fc); act = num(act);
    if (!isFinite(fc) || !isFinite(act) || !fc) return '<span class="diff"></span>';
    const r = (act - fc) / fc * 100;
    return `<span class="diff ${r >= 0 ? "d-up" : "d-down"}">${r >= 0 ? "+" : ""}${r.toFixed(0)}%</span>`;
  }
  // 합계: 칸에 쓰는 중인 값으로 바로 (저장 전에도 반응)
  function foot() {
    let f = 0, a = 0, fa = 0, n = 0, de = 0;
    const rows = [...$("fcRows").querySelectorAll(".f-row")];
    for (let i = 0; i < 7; i++) {
      const ins = rows[i] ? rows[i].querySelectorAll("input") : null, x = (db.forecast || {})[addDays(fcWeekStart, i)] || {};
      const fv = num(ins ? ins[0].value.replace(/\D/g, "") : x.fc) || 0, av = num(ins ? ins[1].value.replace(/\D/g, "") : x.act);
      f += fv; de += dataForecast(addDays(fcWeekStart, i)) || 0; if (isFinite(av)) { a += av; fa += fv; n++; }
    }
    $("fcFoot").innerHTML = `<span class="day">합계</span><span class="t-de">${de ? won(Math.round(de / 1e4) * 1e4) : "–"}</span><span class="t-fc">${won(f)}</span><span class="t-act">${n ? won(a) : "–"}</span><span class="diff">${n && fa ? (a / fa * 100).toFixed(0) + "%" : ""}</span>`;
  }
  $("wSel").addEventListener("change", () => { fcWeekStart = $("wSel").value; renderForecast(); });
  $("wPrev").onclick = () => { fcWeekStart = addDays(fcWeekStart, -7); renderForecast(); };
  $("wNext").onclick = () => { fcWeekStart = addDays(fcWeekStart, 7); renderForecast(); };

  // ---------- 데이터 파일 ----------
  const DOC = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>';
  const TABLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v14H3z"/><path d="M3 10h18M9 10v9"/></svg>';
  const KINDS = [
    { k: "line", t: "Line 레시피", acc: ".pdf", parse: async (f) => ({ recipes: await parseRecipePdf(f) }), info: (v) => `레시피 ${v.recipes.length}개` },
    { k: "prep", t: "Prep 레시피", acc: ".pdf", parse: async (f) => ({ recipes: await parseRecipePdf(f) }), info: (v) => `프랩 ${v.recipes.length}개` },
    { k: "sales", t: "메뉴별 매출현황", acc: ".xlsx,.xls,.csv", parse: async (f) => ({ rows: await parseSales(f) }), info: (v) => `메뉴 ${v.rows.length}개 · ${won(v.rows.reduce((a, x) => a + x.qty, 0))}개 판매` },
    { k: "ledger", t: "수불현황", acc: ".xlsx,.xls,.csv", parse: async (f) => ({ rows: await parseLedger(f) }), info: (v) => { const n = v.rows.filter((r) => r.usage > 0).length; return `품목 ${v.rows.length}개 · 사용량 있는 품목 ${n}개${n < v.rows.length * 0.1 ? " (사용량 칸을 못 찾은 것 같아요)" : ""}`; } },
  ];
  let selMonth = (() => { const n = new Date(); return iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)).slice(0, 7); })();
  function monthList() {
    const n = new Date(), out = [];
    for (let k = 5; k >= 0; k--) out.push(iso(new Date(n.getFullYear(), n.getMonth() - k, 1)).slice(0, 7));
    return out;
  }
  function renderFiles() {
    $("connState").className = "conn" + (API && online ? "" : " off");
    $("connState").innerHTML = API ? (online ? '<i class="mk"></i>구글 시트에 연결됨' : '<i class="mk wait"></i>구글 시트에 연결되지 않음 · 이 기기에만 저장 중') : '<i class="mk wait"></i>구글 시트 주소가 없어서 이 기기에만 저장 중이에요 (맨 아래에서 연결)';
    $("apiIn").value = API; renderBackups();
    if (document.activeElement !== $("wkIn")) $("wkIn").value = Math.round(weekendPlus() * 100);
    // 품목 목록
    const ms = [["master.order", "발주 시트", (v) => `품목 ${v.rows.length}개`], ["master.prep", "프랩 시트", (v) => `프랩 ${v.rows.length}개`]];
    $("masters").innerHTML = ms.map(([key, t, info]) => {
      const v = db[key];
      return `<div class="cell file"><span class="doc k-master">${TABLE}<i class="mk ${v ? "" : "wait"}"></i></span>` +
        `<span style="min-width:0"><span class="tt">${t}</span><span class="fn${v ? "" : " miss"}" style="display:block">${v ? `${esc(v.file)} · ${info(v)} · ${mmdd(v.at)}` : "아직 안 올렸어요"}</span></span>` +
        `<label class="up${v ? "" : " primary"}">${v ? "교체" : "올리기"}<input type="file" data-master="${key}" accept=".xlsx,.xls,.csv" aria-label="${t} 올리기"></label></div>`;
    }).join("");
    // 월
    const now = TODAY.slice(0, 7);
    const state = (m) => { const d = mget(m); const n = KINDS.filter((K) => d[K.k] || (K.k === "line" || K.k === "prep") && hasRecipeBefore(m, K.k)).length + ((num(d.gross) || grossFromForecast(m)) ? 1 : 0); return m === now ? "run" : n >= 5 ? "" : "wait"; };
    $("months").innerHTML = monthList().map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === selMonth}">${+m.slice(5)}월<i class="mk ${state(m)}"></i></button>`).join("");
    const d = mget(selMonth);
    $("mTitle").textContent = `${selMonth.slice(0, 4)}년 ${+selMonth.slice(5)}월`;
    $("mCount").textContent = selMonth === now ? "진행 중" : "";
    const gAuto = grossFromForecast(selMonth);
    $("grossIn").value = num(d.gross) ? won(num(d.gross)) : "";
    $("grossIn").placeholder = gAuto ? `Forecast 실제 합계 ${won(gAuto)}` : "예: 250,000,000";
    $("files").innerHTML = KINDS.map((K) => {
      const v = d[K.k];
      const inherited = !v && (K.k === "line" || K.k === "prep") && hasRecipeBefore(selMonth, K.k);
      const soon = !v && !inherited && selMonth === now;
      const st = v || inherited ? "" : soon ? "run" : "wait";
      const fn = v ? `${esc(v.file)} · ${K.info(v)}` : inherited ? "지난달 레시피 그대로" : soon ? `${+selMonth.slice(5)}월이 끝나면 올려요` : "아직 안 올렸어요";
      return `<div class="cell file"><span class="doc k-${K.k}">${DOC}<i class="mk ${st}"></i></span>` +
        `<span style="min-width:0"><span class="tt">${K.t}</span><span class="fn${!v && !inherited && !soon ? " miss" : ""}" style="display:block">${fn}</span></span>` +
        `<label class="up${!v && !inherited && !soon ? " primary" : ""}">${v ? "교체" : "올리기"}<input type="file" data-k="${K.k}" accept="${K.acc}" aria-label="${+selMonth.slice(5)}월 ${K.t} 올리기"></label></div>`;
    }).join("");
    renderMap();
    renderLearn();
  }
  const hasRecipeBefore = (m, k) => months().some((x) => x < m && mget(x)[k]);
  $("months").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { selMonth = b.dataset.m; renderFiles(); } });
  $("grossIn").addEventListener("input", (e) => { const v = e.target.value.replace(/\D/g, ""); e.target.value = v ? Number(v).toLocaleString("ko-KR") : ""; });
  $("grossIn").addEventListener("change", (e) => { const v = e.target.value.replace(/\D/g, ""); mset(selMonth, { gross: v ? Number(v) : null }); renderFiles(); toast("저장했어요"); });
  $("masters").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const key = e.target.dataset.master;
    try {
      busy(true);
      const r = key === "master.order" ? await parseOrderSheet(f) : await parsePrepSheet(f);
      setKey(key, { file: f.name, at: TODAY, ...r });
      let msg = `${r.rows.length}개 읽었어요`;
      if (r.sheets && r.sheets.length > 1) msg += ` · 업체 탭 ${r.sheets.length}개`;
      // 발주 BOH 파일의 '수불부 당월 매출'은 고른 달의 Gross Sales가 비어 있을 때만 채움
      if (r.gross && !num(mget(selMonth).gross)) { mset(selMonth, { gross: r.gross }); msg += ` · ${+selMonth.slice(5)}월 Gross ${won(r.gross)}원`; }
      toast(msg);
    } catch (err) { toast("읽지 못했어요: " + err.message); } finally { busy(false); renderFiles(); }
  });
  $("files").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const K = KINDS.find((x) => x.k === e.target.dataset.k);
    try {
      busy(true);
      const v = await K.parse(f);
      if ((v.recipes && !v.recipes.length) || (v.rows && !v.rows.length)) throw new Error("내용을 찾지 못했어요");
      mset(selMonth, { [K.k]: { file: f.name, at: TODAY, ...v } });
      toast(`${K.t}: ${K.info(v)} 읽었어요`);
    } catch (err) { toast("읽지 못했어요: " + err.message); } finally { busy(false); renderFiles(); }
  });
  function busy(on) { $("v-files").classList.toggle("busy", on); if (on) toast("파일을 읽는 중이에요…"); }

  // 레시피 연결 확인: 판매가 많은 메뉴 중 연결 안 된 것, 연결 안 된 재료
  let mapMore = false;
  function renderMap() {
    const M = model();
    const lastSales = [...M.monthRows].reverse().find((r) => r.theo);
    const box = $("mapList");
    if (!M.line.length || !lastSales) { box.innerHTML = '<div class="empty">Line 레시피와 메뉴별 매출현황을 올리면 여기서 연결을 확인할 수 있어요.</div>'; $("mapCount").textContent = ""; return; }
    const sales = mget(lastSales.m).sales.rows.slice().sort((a, b) => b.qty - a.qty);
    const menuRows = sales.map((s) => ({ s, r: M.resolveMenu(s.menu, s.cat) }));
    const ingNames = [...new Set(M.line.concat(M.prep).flatMap((r) => r.ing.map((i) => i.n)))];
    const ingRows = ingNames.map((n) => ({ n, r: M.resolveIng(n) }));
    const badMenu = menuRows.filter((x) => !x.r || x.r.auto);
    const badIng = ingRows.filter((x) => !x.r);
    $("mapCount").textContent = `메뉴 ${Math.round(lastSales.menuMapped / Math.max(1, lastSales.menuQty) * 100)}% 연결 · 재료 ${ingRows.length - badIng.length}/${ingRows.length}`;
    const recipeOpts = (sel) => `<option value="">연결 안 함 (계산 제외)</option>` + M.line.map((r) => `<option value="${esc(r.name)}"${sel === r.name ? " selected" : ""}>${esc(r.short || r.name)} · ${esc(r.name)}</option>`).join("");
    const ingOpts = (sel) => `<option value="">선택…</option><option value="skip"${sel === "skip" ? " selected" : ""}>계산에서 빼기</option>` + M.ingCands.map((c) => `<option value="${esc(c.kind + ":" + c.id)}"${sel === c.kind + ":" + c.id ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    const lim = mapMore ? 999 : 8;
    let html = `<div class="cell kv"><span>메뉴 → 레시피<small>자동 연결은 맞는지 확인만 하면 돼요</small></span></div>`;
    badMenu.slice(0, lim).forEach(({ s, r }) => {
      html += `<div class="cell map${r ? " ok" : ""}"><span class="nm">${esc(s.menu)}<small>${esc(s.cat)} · ${won(s.qty)}개</small></span><select data-menu="${esc(s.menu)}">${recipeOpts(r && r.recipe ? r.recipe.name : "")}</select></div>`;
    });
    html += `<div class="cell kv"><span>레시피 재료 → 품목<small>연결 안 된 재료 ${badIng.length}개</small></span></div>`;
    badIng.slice(0, lim).forEach(({ n }) => { html += `<div class="cell map"><span class="nm">${esc(n)}</span><select data-ing="${esc(n)}">${ingOpts("")}</select></div>`; });
    if (badMenu.length > lim || badIng.length > lim) html += `<button type="button" class="more" id="mapMore">${mapMore ? "접기" : "모두 보기"}</button>`;
    box.innerHTML = html;
    const mb = $("mapMore"); if (mb) mb.onclick = () => { mapMore = !mapMore; renderMap(); };
  }
  $("mapList").addEventListener("change", (e) => {
    const t = e.target; const cfg = { menu: {}, ing: {}, ...(db.map || {}) };
    if (t.dataset.menu != null) { cfg.menu = { ...cfg.menu, [t.dataset.menu]: t.value || "skip" }; }
    if (t.dataset.ing != null) { cfg.ing = { ...cfg.ing }; if (t.value) cfg.ing[t.dataset.ing] = t.value; else delete cfg.ing[t.dataset.ing]; }
    setKey("map", cfg); renderMap(); renderLearn();
  });
  function renderLearn() {
    const M = model();
    const a = M.withA.length, b = M.withB.length;
    const withA = M.items.filter((i) => i.rateA != null).length, withB = M.items.filter((i) => i.rateB != null).length;
    const D = M.items.filter((i) => i.fixedA > 0).length;
    $("learnRange").textContent = a ? `${+M.withA[0].m.slice(5)}월~${+M.withA[a - 1].m.slice(5)}월 · ${a}개월` : "";
    $("learnState").innerHTML = [
      ["A · 수불현황", `수불현황 + Gross Sales가 있는 달 ${a}개`, `${withA}개 품목`, withA ? "ok" : "bad"],
      ["B · 레시피", `메뉴별 판매 + 레시피가 있는 달 ${b}개`, `${withB}개 품목`, withB ? "ok" : "bad"],
      ["D · 고정량 + 비례량", "3개월 이상 쌓이면 계산", `${D}개 품목`, ""],
      ["G · 재고채점", "같은 품목 재고를 두 번 이상 입력하면 채점", `${M.scores.filter((x) => !x.src).length}건`, ""],
    ].map(([t, s, v, c]) => `<div class="cell kv"><span>${t}<small>${s}</small></span><b class="${c || "mut"}">${v}</b></div>`).join("");
  }
  // 버튼 비밀번호: GW 전송·Gross 불러오기·데이터 파일 들어가기 앞에 물어봄 (링크가 퍼져도 다른 사람이 못 누르게)
  //  시트 btnLock = {salt, hash}(번호는 안 남김). 기기마다 한 번 맞히면 기억. 아직 없으면 처음 누를 때 정함. 버튼 옆 자물쇠로 바꿈
  //  앱에서 막는 잠금 — 시트 자체를 잠그는 건 가게 키(APP_KEY)
  const LS_PIN = "order-calc-pin";
  const pinHash = async (salt, pin) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pin)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const pinOn = () => !!(db.btnLock && db.btnLock.hash);
  const pinOk = () => { try { return pinOn() && localStorage.getItem(LS_PIN) === db.btnLock.hash; } catch { return false; } };
  const rememberPin = (h) => { try { localStorage.setItem(LS_PIN, h); } catch {} };
  async function newPin(title) {
    const v = prompt(title); if (v == null) return false;
    if (!/^\d{4,8}$/.test(v.trim())) { toast("숫자 4~8자리로 넣어 주세요"); return false; }
    if ((prompt("비밀번호를 한 번 더 넣어주세요") || "").trim() !== v.trim()) { toast("두 번 넣은 번호가 달라요"); return false; }
    const salt = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = await pinHash(salt, v.trim());
    setKey("btnLock", { salt, hash, at: Date.now() }); rememberPin(hash);
    toast("버튼 비밀번호를 정했어요"); return true;
  }
  async function unlock() {
    if (pinOk()) return true;
    // 시트를 아직 못 받았으면(앱이 막 켜짐) 먼저 받아서 확인 — 안 그러면 잠금이 없는 줄 알고 새 번호를 정하게 됨
    if (!pinOn() && !pulled) await pull(true);
    if (pinOk()) return true;
    if (!pinOn()) { if (!pulled) { toast("시트에 연결한 뒤 다시 눌러 주세요"); return false; } return newPin("비밀번호를 넣어주세요"); }
    const v = prompt("비밀번호를 넣어주세요"); if (v == null) return false;
    const h = await pinHash(db.btnLock.salt, v.trim());
    if (h !== db.btnLock.hash) { toast("비밀번호가 달라요"); return false; }
    rememberPin(h); return true;
  }
  function pinBtn() { return `<button type="button" class="pinbtn" aria-label="버튼 비밀번호 바꾸기"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg></button>`; }
  function bindPin(el) { el.querySelector(".pinbtn")?.addEventListener("click", async () => { if (pinOn() && !(await unlock())) return; newPin("새 비밀번호를 넣어주세요"); }); }
  $("apiSave").onclick = async () => {
    API = $("apiIn").value.trim();
    try { localStorage.setItem(LS_API, API); } catch {}
    await pull(); renderFiles(); toast(online ? "구글 시트에 연결했어요" : API ? "연결하지 못했어요. 주소를 확인해 주세요" : "주소를 지웠어요");
  };
  // 백업에서 되돌리기 (Apps Script가 하루 첫 저장 때 전날 마감 상태를 복사해 둠, 14일)
  async function renderBackups() {
    const sel = $("bkSel"); if (!sel || !API) return;
    try {
      const res = await fetch(withKey(API + "?api=1&backups=1&t=" + Date.now())), j = await res.json(), list = j && j.data && j.data.backups;
      if (!Array.isArray(list)) { sel.innerHTML = `<option value="">Apps Script 업데이트 필요</option>`; return; }
      sel.innerHTML = list.length ? list.map((d) => `<option value="${d}">${mmdd(d)} ${DOW[dow(d)]} 시작 상태</option>`).join("") : `<option value="">아직 백업 없음 (내일부터)</option>`;
    } catch { sel.innerHTML = `<option value="">불러오지 못했어요</option>`; }
  }
  $("wkIn").addEventListener("change", () => {
    const v = num($("wkIn").value); if (!isFinite(v) || v < 0 || v > 200) { toast("0~200 사이로 넣어 주세요"); return; }
    setKey("settings", { ...(db.settings || {}), weekendPlus: v }); invalidate(); toast(`주말 여유분 ${v}%로 바꿨어요`);
  });
  $("bkGo").onclick = async () => {
    const d = $("bkSel").value; if (!d) return;
    if (!confirm(`${mmdd(d)} ${DOW[dow(d)]}요일 시작 상태로 되돌릴까요?\n그 뒤에 입력한 재고·발주·설정이 모두 사라져요. (지금 상태는 시트의 "kv_되돌리기전" 탭에 남아요)`)) return;
    try {
      await apiCall({ action: "restore", date: d });
      pend = { set: {}, add: {}, base: {} }; savePend(); db = {}; lastSig = "";
      await pull(); invalidate(); renderFiles(); toast(`${mmdd(d)} 백업으로 되돌렸어요`);
    } catch (e) { toast("되돌리지 못했어요 · " + e.message); }
  };
  $("apiPush").onclick = async () => {
    if (!API) { toast("먼저 주소를 저장해 주세요"); return; }
    try { for (const k of Object.keys(db)) await apiCall({ action: "set", key: k, value: db[k] }); online = true; toast("이 기기 데이터를 시트로 보냈어요"); }
    catch { toast("보내지 못했어요"); }
    renderFiles();
  };

  // ---------- 데이터 리포트 ----------
  let rWeek = null;
  // 학습량: 쌓인 데이터를 0~100%로 (어떤 입력이든 조금씩 오르게 연속값으로 계산)
  function learnLevel(M) {
    const ms = months().map(mget);
    const files = ms.reduce((a, d) => a + ["ledger", "sales", "line", "prep"].filter((k) => d[k]).length / 4 + (num(d.gross) > 0 ? 0.25 : 0), 0) / 1.25;
    const actDays = Object.values(db.forecast || {}).filter((f) => isFinite(num(f.act))).length;
    const last = [...M.monthRows].reverse().find((r) => r.menuQty);
    const mapped = last ? last.menuMapped / last.menuQty : 0;
    const own = M.items.filter((i) => !i.ledgerOnly);
    const both = own.length ? own.filter((i) => i.rateA != null && i.rateB != null).length / own.length : 0;
    const sat = (n, k) => 1 - Math.exp(-n / k); // 처음엔 빨리, 갈수록 천천히 차오름
    const parts = [
      { t: "데이터 파일", d: "수불현황·매출현황·레시피·Gross Sales", v: `${Math.round(files * 10) / 10}개월`, max: 30, p: 30 * sat(files, 6) },
      { t: "재고채점", d: "같은 품목 재고를 다른 날 다시 입력", v: `${M.scores.filter((x) => !x.src).length}건`, max: 30, p: 30 * sat(M.scores.filter((x) => !x.src).length, 400) },
      { t: "실제 Gross Sales", d: "Forecast 화면에 적은 날", v: `${actDays}일`, max: 20, p: 20 * sat(actDays, 120) },
      { t: "메뉴 연결", d: "판매 메뉴 중 레시피에 연결된 비율", v: `${Math.round(mapped * 100)}%`, max: 10, p: 10 * mapped },
      { t: "레시피 계산 품목", d: "수불과 레시피 둘 다로 계산되는 품목", v: `${Math.round(both * 100)}%`, max: 10, p: 10 * both },
    ];
    return { pct: parts.reduce((a, x) => a + x.p, 0), parts };
  }
  function renderXp(M) {
    const L = learnLevel(M);
    if (!$("xpLog").hidden) renderLog();
    const tok = ++xpTok, fill = $("xpFill"), w = `${Math.min(100, L.pct)}%`, show = (x) => { $("xpPct").innerHTML = `${x.toFixed(3)}<small>%</small>`; };
    if (xpAnim && !calm()) {
      xpAnim = false;
      fill.style.transition = "none"; fill.style.width = "0%"; void fill.offsetWidth; fill.style.transition = ""; fill.style.width = w;
      const t0 = performance.now(), to = L.pct;
      const tick = (t) => { if (tok !== xpTok) return; const k = Math.min(1, (t - t0) / 900); show(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
      show(0); requestAnimationFrame(tick);
    } else { xpAnim = false; show(L.pct); fill.style.width = w; }
    $("xpParts").innerHTML = L.parts.map((x) => `<div class="xp-row"><span>${x.t}<small>${x.d}</small></span><b>${x.v}</b><em>${x.p.toFixed(3)}<small>/ ${x.max}%</small></em></div>`).join("");
  }
  const toggle = (btn, box, after) => $(btn).addEventListener("click", () => { const open = $(box).hidden; $(box).hidden = !open; $(btn).setAttribute("aria-expanded", String(open)); if (after) after(); });
  toggle("xpDetail", "xpParts");
  toggle("xpMore", "xpLog", () => renderLog());

  // ---------- 학습 기록 (패치노트) ----------
  // 지금 상태를 요약해 두고, 날마다 그날 처음 상태(base)와 비교해서 무엇을 배우고 고쳤는지 한 항목으로 적음
  const KIND_KO = { ledger: "수불현황", sales: "메뉴별 매출현황", line: "Line 레시피", prep: "Prep 레시피" };
  function snapshot(M) {
    const files = {}, errs = [];
    months().forEach((m) => {
      const d = mget(m);
      Object.keys(KIND_KO).forEach((k) => { if (d[k]) files[m + "|" + k] = `${d[k].at || ""}|${(d[k].rows || d[k].recipes || []).length}`; });
      if (num(d.gross) > 0) files[m + "|gross"] = String(num(d.gross));
      if (d.ledger) { const n = d.ledger.rows.filter((r) => r.usage > 0).length; if (n < d.ledger.rows.length * 0.1) errs.push("ledger0|" + m); }
      if (d.ledger && !(num(d.gross) > 0) && !grossFromForecast(m)) errs.push("nogross|" + m);
    });
    const ms = months();
    ms.forEach((m, i) => {
      const a = mget(m).sales, b = i ? mget(ms[i - 1]).sales : null;
      if (a && b && JSON.stringify(a.rows) === JSON.stringify(b.rows)) errs.push("samesales|" + m);
    });
    const spreads = {}, bOff = [], gOn = [];
    const w = orderWindow(TODAY);
    M.items.forEach((it) => {
      const c = calc(it, w, 0, 0);
      if (c.spread != null) spreads[it.key] = Math.round(c.spread * 100);
      if (it.rateA != null && it.rateB == null && M.withB.some((r) => r.theo.get(it.key))) bOff.push(it.key);
      if (it.rateG != null) gOn.push(it.key);
    });
    // 정확도는 최근 한 달 (리포트와 같은 기준)
    const lm = M.scores.reduce((m, s) => (s.end.slice(0, 7) > m ? s.end.slice(0, 7) : m), ""), lms = monthScores(M, lm);
    const acc = lms.length ? Math.round(100 - lms.reduce((a, s) => a + Math.min(1, Math.abs(s.pF - s.actual) / s.actual), 0) / lms.length * 100) : null;
    const last = [...M.monthRows].reverse().find((r) => r.menuQty);
    return {
      files, errs, spreads, bOff, gOn, acc,
      scores: M.scores.filter((x) => !x.src).length, act: Object.values(db.forecast || {}).filter((f) => isFinite(num(f.act))).length,
      mapped: last ? Math.round(last.menuMapped / last.menuQty * 100) : 0,
      map: db.map || {}, hide: db.hide || [], order: db["master.order"] ? `${db["master.order"].at}|${db["master.order"].rows.length}` : "",
      loss: M.items.filter((i) => i.loss !== 1).length, items: M.items.filter((i) => !i.ledgerOnly).length,
    };
  }
  const ERR_KO = {
    ledger0: [(m) => `${+m.slice(5)}월 수불현황에서 사용량 칸을 못 읽음 (사용량 있는 품목이 거의 없음)`, (m) => `${+m.slice(5)}월 수불현황 사용량을 다시 읽어 정상 반영`],
    nogross: [(m) => `${+m.slice(5)}월 실제 Gross Sales가 비어 있어 그달 학습이 멈춤`, (m) => `${+m.slice(5)}월 실제 Gross Sales가 들어와 그달 학습 재개`],
    samesales: [(m) => `${+m.slice(5)}월 메뉴별 매출현황이 지난달 파일과 똑같음 (다른 달 파일로 보임)`, (m) => `${+m.slice(5)}월 메뉴별 매출현황을 맞는 달 파일로 교체`],
  };
  function diffNotes(a, b, M) {
    const out = [], nm = (k) => k, mo = (m) => `${+m.slice(5)}월`;
    Object.keys(b.files).forEach((k) => {
      if (a.files[k] === b.files[k]) return;
      const [m, kind] = k.split("|");
      if (kind === "gross") out.push(["learn", `${mo(m)} 실제 Gross Sales ${won(+b.files[k])}원 반영`]);
      else {
        const d = mget(m)[kind];
        const what = kind === "ledger" ? `품목 ${d.rows.filter((r) => r.usage > 0).length}개 사용량` : kind === "sales" ? `메뉴 ${d.rows.length}개 · ${won(d.rows.reduce((s, r) => s + r.qty, 0))}개 판매` : `${kind === "line" ? "레시피" : "프랩"} ${(d.recipes || []).length}개`;
        out.push(["learn", `${mo(m)} ${KIND_KO[kind]} 학습 (${what})`]);
      }
    });
    if (b.scores > a.scores) out.push(["learn", `재고채점 ${b.scores - a.scores}건 추가 (누적 ${b.scores}건)`]);
    if (b.act > a.act) out.push(["learn", `실제 Gross Sales ${b.act - a.act}일치 입력`]);
    const gNew = b.gOn.filter((k) => !a.gOn.includes(k));
    if (gNew.length) out.push(["learn", `${nm(gNew[0])}${gNew.length > 1 ? ` 외 ${gNew.length - 1}개` : ""}: 재고 입력만으로 사용량 학습 시작`]);
    if (b.order !== a.order && b.order) out.push(["fix", `발주 시트 갱신 (품목 ${b.items}개)`]);
    const chg = (x = {}, y = {}) => Object.keys({ ...x, ...y }).filter((k) => x[k] !== y[k]).length;
    const mc = chg(a.map.menu, b.map.menu), ic = chg(a.map.ing, b.map.ing);
    if (mc) out.push(["fix", `메뉴 → 레시피 연결 ${mc}개 수정 (판매 메뉴 ${b.mapped}% 연결)`]);
    if (ic) out.push(["fix", `재료 → 품목 연결 ${ic}개 수정`]);
    const hn = b.hide.filter((h) => !a.hide.includes(h));
    if (hn.length) out.push(["fix", `목록에서 숨김: ${hn.map((h) => h.replace(/^업체:/, "") + (h.startsWith("업체:") ? " 전체" : "")).slice(0, 4).join(", ")}${hn.length > 4 ? ` 외 ${hn.length - 4}개` : ""}`]);
    if (b.loss > a.loss) out.push(["fix", `로스 보정 ${b.loss - a.loss}개 품목에 적용 (지난달 실제 ÷ 레시피)`]);
    const off = b.bOff.filter((k) => !a.bOff.includes(k));
    if (off.length) out.push(["fix", `${off.slice(0, 3).join(", ")}${off.length > 3 ? ` 외 ${off.length - 3}개` : ""}: 레시피 밖 사용이 커서 수불현황 기준으로만 계산`]);
    const downs = [], ups = [];
    Object.keys(b.spreads).forEach((k) => { const p = a.spreads[k]; if (p == null) return; const d = b.spreads[k] - p; if (d <= -5) downs.push([k, p, b.spreads[k]]); else if (d >= 10) ups.push([k, p, b.spreads[k]]); });
    downs.sort((x, y) => (x[2] - x[1]) - (y[2] - y[1])); ups.sort((x, y) => (y[2] - y[1]) - (x[2] - x[1]));
    if (downs.length) out.push(["down", `${downs.slice(0, 3).map(([k, p, n]) => `${k} ${p}→${n}%`).join(", ")}${downs.length > 3 ? ` 외 ${downs.length - 3}개` : ""}`]);
    if (ups.length) out.push(["up", `${ups.slice(0, 3).map(([k, p, n]) => `${k} ${p}→${n}%`).join(", ")}${ups.length > 3 ? ` 외 ${ups.length - 3}개` : ""}`]);
    if (a.acc != null && b.acc != null && b.acc !== a.acc) out.push([b.acc > a.acc ? "down" : "up", `발주 예측 정확도 ${a.acc}% → ${b.acc}%`]);
    b.errs.filter((e) => !a.errs.includes(e)).forEach((e) => { const [c, m] = e.split("|"); if (ERR_KO[c]) out.push(["err", ERR_KO[c][0](m)]); });
    a.errs.filter((e) => !b.errs.includes(e)).forEach((e) => { const [c, m] = e.split("|"); if (ERR_KO[c]) out.push(["done", ERR_KO[c][1](m)]); });
    return out;
  }
  function learnTrack() {
    if (!online) return; // 시트에서 최신 데이터를 받은 뒤에만 비교
    const M = model(); if (!M.items.length) return;
    const cur = snapshot(M), st = db.learnsnap || null;
    const today = TODAY;
    const base = !st ? { files: {}, errs: [], spreads: {}, bOff: [], gOn: [], acc: null, scores: 0, act: 0, mapped: 0, map: {}, hide: [], order: "", loss: 0, items: 0 } : st.date === today ? st.base : st.last;
    const notes = diffNotes(base, cur, M);
    const log = (db.learnlog || []).slice();
    const id = "auto-" + today, i = log.findIndex((e) => e.id === id);
    const prev = i >= 0 ? JSON.stringify(log[i].notes) : "[]";
    if (JSON.stringify(notes) !== prev) {
      const entry = { id, t: localStamp(), notes };
      if (i >= 0) { if (notes.length) log[i] = entry; else log.splice(i, 1); } else if (notes.length) log.push(entry);
      setKey("learnlog", log.slice(-200));
    }
    const ns = { date: today, base, last: cur };
    if (!st || JSON.stringify(st) !== JSON.stringify(ns)) setKey("learnsnap", ns);
  }
  const TAG_KO = { learn: "학습", fix: "수정", down: "오차 감소", up: "오차 증가", err: "오류 발생", done: "해결" };
  let logMore = false;
  function renderLog() {
    const log = (db.learnlog || []).slice().sort((a, b) => (a.t < b.t ? 1 : -1));
    const box = $("xpLog");
    if (!log.length) { box.innerHTML = '<div class="empty">아직 학습 기록이 없어요</div>'; return; }
    const fmt = (t) => { const d = t.slice(0, 10); return `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 (${DOW[dow(d)]})<small>${t.slice(11, 16)}</small>`; };
    box.innerHTML = log.slice(0, logMore ? 200 : 5).map((e) => `<div class="pn"><h4>${fmt(e.t)}${e.by ? `<small>${esc(e.by)}</small>` : ""}</h4><ul>${e.notes.map(([k, s]) => `<li><i class="${k}">${TAG_KO[k] || k}</i><span>${esc(s)}</span></li>`).join("")}</ul></div>`).join("") +
      (log.length > 5 ? `<button type="button" class="pn-more" id="pnMore">${logMore ? "접기" : `지난 기록 ${log.length - 5}개 더 보기`}</button>` : "");
    const pm = $("pnMore"); if (pm) pm.onclick = () => { logMore = !logMore; renderLog(); };
  }
  // 데이터 요청: 계산에 모르는 값이 들어간 곳을 찾아 KM에게 물어봄 (답하면 itemCfg·prepCfg에 저장되고 사라짐, "모름"은 다시 안 물음)
  //  ① TB·tsp·cup·스쿱으로 쓰는데 1TB 무게를 모르는 재료(지금은 물처럼 15g) ② g으로 쓰는데 1단위 용량을 모르는 품목
  function dataRequests(M) {
    const ic = db.itemCfg || {}, pc = db.prepCfg || {}, skip = (db.settings || {}).reqSkip || {}, out = new Map();
    const add = (id, o) => { if (skip[id]) return; const x = out.get(id) || { ...o, n: 0, ex: [] }; x.n++; if (x.ex.length < 2 && o.line && !x.ex.includes(o.line)) x.ex.push(o.line); out.set(id, x); };
    [...M.line, ...M.prep].forEach((rc) => rc.ing.forEach((ing) => {
      const t = M.resolveIng(ing.n); if (!t || t.skip) return;
      const q = parseQty(ing.w, ing.v); if (!q) return;
      const it = t.kind === "item" ? M.items.find((i) => i.key === t.id) : null;
      const line = rc.name.replace(/\s*\(.*?\)\s*$/, "");
      if (q.vol) {
        const cfg = (t.kind === "item" ? ic[t.id] : pc[t.id]) || {};
        if (cfg.tbG || M.pairTbG().get(t.kind + ":" + t.id)) return;
        if (it && it.pk.ml && !it.pk.g) return; // 액체(ml 단위 품목)는 그대로 환산
        if (t.kind === "prep") { const p = M.prep.find((x) => x.name === t.id); if (p && /\b(ml|l)\b/i.test(String(p.yield || ""))) return; }
        add("tb:" + t.kind + ":" + t.id, { kind: "tb", target: t.kind, ref: t.id, label: t.kind === "prep" ? ing.n.replace(/\s*\(.*?\)\s*/g, "") : it ? it.name : t.id, line });
      } else if (it && (q.g || q.ml) && !it.pk.g && !it.pk.ml) {
        add("pk:" + it.key, { kind: "pk", target: "item", ref: it.key, label: it.name, unit: it.pk.stock || "EA", line });
      }
    }));
    return [...out.entries()].map(([id, x]) => ({ id, ...x })).sort((a, b) => b.n - a.n);
  }
  function renderReq(M) {
    const all = dataRequests(M), list = all.slice(0, 3);
    $("rReqH").hidden = $("rReq").hidden = !all.length;
    $("rReqN").textContent = all.length > 3 ? `${all.length}개 중 3개` : `${all.length}개`;
    $("rReq").innerHTML = list.map((r) => {
      const q = r.kind === "tb" ? `${esc(r.label)} <b>1TB</b> 무게` : `${esc(r.label)} <b>1${esc(r.unit)}</b> 용량`;
      const why = r.kind === "tb" ? `레시피 ${r.n}줄 · 지금은 물처럼 15g으로 계산` : `레시피 ${r.n}줄 · 지금은 계산에서 빠짐`;
      return `<div class="cell req" data-id="${esc(r.id)}"><span class="kv"><span>${q}<small>${why}${r.ex.length ? ` · ${esc(r.ex.join(", "))}` : ""}</small></span></span>` +
        `<div class="row"><label class="fld"><span>g</span><input type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label><button type="button" class="btn" data-act="save">저장</button><button type="button" class="btn ghost" data-act="skip">모름</button></div></div>`;
    }).join("");
    $("rReq")._reqs = list;
  }
  $("rReq").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const cell = b.closest(".req"), r = ($("rReq")._reqs || []).find((x) => x.id === cell.dataset.id); if (!r) return;
    if (b.dataset.act === "skip") {
      const st = { ...(db.settings || {}) }; st.reqSkip = { ...(st.reqSkip || {}), [r.id]: 1 }; setKey("settings", st);
    } else {
      const v = num(cell.querySelector("input").value); if (!(v > 0)) { toast("무게(g)를 넣어 주세요"); return; }
      const key = r.target === "prep" ? "prepCfg" : "itemCfg", cfg = { ...(db[key] || {}) };
      cfg[r.ref] = { ...(cfg[r.ref] || {}), [r.kind === "tb" ? "tbG" : "g"]: v };
      if (cfg[r.ref].tbGEst) delete cfg[r.ref].tbGEst;
      setKey(key, cfg); toast(`${r.label} 저장했어요`);
    }
    invalidate(); renderReport();
  });
  function renderReport() {
    const M = model();
    renderXp(M); renderReq(M);
    // 한 주(월~일) 단위로 채점: 재고 입력 사이 사용량이 끝난 날의 주 (수불현황은 한 달 단위라 주 채점에서는 뺌)
    const byWeek = new Map();
    M.scores.forEach((s) => { if (s.src === "ledger") return; const w = mondayOf(s.end); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(s); });
    const weeks = [...byWeek.keys()].sort();
    const monKo = (w) => `${isoWeek(w).w}주`, monEnd = (w) => addDays(w, 6);
    const sel = $("rSel");
    if (!weeks.length) {
      sel.innerHTML = "<option>채점 기록 없음</option>";
      $("rRange").textContent = ""; $("rAcc").innerHTML = "–"; $("rDelta").textContent = "";
      $("rTrend").innerHTML = ""; $("kSales").textContent = "–"; $("kItems").textContent = "0"; $("kLogs").innerHTML = `${(db.onhand || []).length}<small>건</small>`;
      $("rMethods").innerHTML = '<div class="empty"><b>아직 채점할 기록이 없어요</b>같은 품목의 재고를 다른 날 두 번 이상 입력하면 그 사이 실제 사용량으로 채점해요.</div>';
      $("rMiss").innerHTML = "";
      return;
    }
    if (!rWeek || !byWeek.has(rWeek)) rWeek = weeks[weeks.length - 1];
    sel.innerHTML = weeks.map((w) => `<option value="${w}"${w === rWeek ? " selected" : ""}>${isoWeek(w).w}주차 ${mmdd(w)} ~ ${mmdd(monEnd(w))}</option>`).join("");
    // 품목별 오차는 100%에서 자름 (한두 품목이 전체 점수를 0으로 만들지 않게)
    const acc = (list, f) => { const e = list.filter((s) => s[f] != null).map((s) => Math.min(1, Math.abs(s[f] - s.actual) / s.actual)); return e.length ? 100 - (e.reduce((a, b) => a + b, 0) / e.length) * 100 : null; };
    const list = byWeek.get(rWeek), idx = weeks.indexOf(rWeek);
    const pl = idx > 0 ? byWeek.get(weeks[idx - 1]) : null;
    const a = acc(list, "pF"), prev = pl ? acc(pl, "pF") : null;
    $("rRange").textContent = `${mmdd(rWeek)} ~ ${mmdd(monEnd(rWeek))} · 재고 입력 기준`;
    $("rAcc").innerHTML = `${Math.round(a)}<small>%</small>`;
    const dd = prev != null ? Math.round(a - prev) : null;
    $("rDelta").className = "delta " + (dd >= 0 ? "good" : "bad");
    $("rDelta").textContent = dd == null ? "" : `지난주 대비 ${dd >= 0 ? "▲" : "▼"} ${Math.abs(dd)}%p`;
    // 추이
    // 추이: 이번 주부터 과거 12주 칸을 고정으로, 채점한 주만 점 (점선으로 이음)
    const cur = mondayOf(TODAY), last = rWeek > cur ? rWeek : cur;
    const slots = Array.from({ length: 12 }, (_, i) => addDays(last, -7 * (11 - i)));
    const pts = slots.map((w, i) => ({ w, i, a: byWeek.has(w) ? acc(byWeek.get(w), "pF") : null })).filter((p) => p.a != null);
    const W = 330, H = 120, L = 26, R = 10, T = 16, B = 22, lo = Math.min(50, ...pts.map((p) => Math.floor(p.a / 10) * 10)), hi = 100;
    const x = (i) => L + (W - L - R) * i / 11, y = (v) => T + (H - T - B) * (hi - v) / (hi - lo);
    let g = "";
    for (let v = lo; v <= hi; v += (hi - lo) / 2) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
    slots.forEach((w, i) => { if (i % 2 === 11 % 2 || w === rWeek) g += `<text class="wk${w === rWeek ? " on" : ""}" x="${x(i)}" y="${H - 6}">${isoWeek(w).w}주</text>`; }); // 주차는 한 칸 건너 (고른 주는 항상)
    if (pts.length > 1) g += `<polyline class="ln" points="${pts.map((p) => `${x(p.i)},${y(p.a)}`).join(" ")}"/>`;
    pts.forEach((p) => {
      const on = p.w === rWeek, i = p.i;
      g += `<circle class="dot${on ? " on" : ""}" cx="${x(i)}" cy="${y(p.a)}" r="${on ? 5 : 4}"/>`;
      if (on) g += `<text class="val" x="${x(i)}" y="${y(p.a) - 10}">${Math.round(p.a)}%</text>`;
      g += `<rect class="hit" x="${x(i) - 12}" y="${T - 8}" width="24" height="${H - T - B + 16}" data-w="${p.w}"><title>${monKo(p.w)} ${Math.round(p.a)}%</title></rect>`;
    });
    $("rTrend").innerHTML = g;
    // Gross Sales 예측
    let f = 0, act = 0; for (let d = rWeek; d <= monEnd(rWeek); d = addDays(d, 1)) { const z = (db.forecast || {})[d] || {}; if (isFinite(num(z.fc)) && isFinite(num(z.act))) { f += num(z.fc); act += num(z.act); } }
    $("kSales").innerHTML = act ? `${Math.round(100 - Math.abs(act - f) / act * 100)}<small>%</small>` : "–";
    $("kItems").innerHTML = `${new Set(list.map((s) => s.key)).size}<small>개</small>`;
    $("kLogs").innerHTML = `${(db.onhand || []).filter((l) => l.t.slice(0, 10) >= rWeek && l.t.slice(0, 10) <= monEnd(rWeek)).length}<small>건</small>`;
    const ms = [["C 최종", "A·B 결합", acc(list, "pF")], ["A 수불현황", "월 사용량 기준", acc(list, "pA")], ["B 메뉴별 매출현황", "메뉴 판매 × 레시피", acc(list, "pB")]].filter((m) => m[2] != null).map(([n, s, v]) => [n, s, +v.toFixed(1)]);
    // 정확도 막대: 0%부터, 길수록 정확. 가장 긴 방식을 강조
    const bestV = Math.max(...ms.map((m) => m[2]));
    $("rMethods").innerHTML = ms.map(([n, s, v]) => `<div class="cell mrow${v === bestV ? " best" : ""}"><span class="nm">${n}<small>${s}</small></span><span class="mbar"><i style="width:${Math.min(100, v)}%"></i></span><span class="pc">${v.toFixed(1)}%</span></div>`).join("");
    // 오차 범위 큰 품목 10개: 발주 카드의 ± 범위(예상 사용량의 몇 %)가 큰 순서. 범위 = 사용량 계산 오차 + Forecast 오차
    const fmtQ = (v, u) => (/^(g|ml|cc)$/i.test(u) ? String(Math.max(1, Math.round(v))) : (Math.round(v * 10) / 10).toFixed(1));
    const wide = M.items.filter((it) => !it.ledgerOnly).map((it) => { const c = calc(it, orderWindowFor(it, TODAY), 0, 0), u0 = c.useAvg ?? c.use; return c.none || !(u0 > 0) || !(c.sd > 0) ? null : { it, sd: c.sd, use: u0, rel: c.sd / u0, u: it.pk.stock || "" }; })
      .filter(Boolean).sort((p, q) => q.rel - p.rel || q.sd - p.sd).slice(0, 10);
    // 옵션 비율: 메뉴별 매출에 안 나오는 선택(안맵게 등)을 달마다 수불현황으로 구한 값. 앞으로 계산에 쓰는 값 = 최근 달 평균
    const sh = (M.shares || []).filter((x) => x.byMonth.length);
    $("rSharesH").hidden = $("rShares").hidden = true; // 옵션 비율은 계산에만 쓰고 리포트에는 안 보임 (KM 요청)
    $("rShares").innerHTML = sh.map((x) => `<div class="cell miss"><span class="nm">${esc(x.label)}<small>${x.byMonth.filter((b) => b.m >= "2026-09").map((b) => `${+b.m.slice(5)}월 ${Math.round(b.v * 100)}%`).join(" · ")}</small></span><span class="pc">${Math.round(x.now * 100)}%</span></div>`).join("");
    $("rMiss").innerHTML = wide.map((m) => `<div class="cell miss"><span class="nm">${esc(m.it.name)}<small>±${fmtQ(Math.max(0.1, m.sd), m.u)}${esc(m.u)} · 예상 사용 ${fmtQ(m.use, m.u)}${esc(m.u)}</small></span><span class="pc">±${Math.round(m.rel * 100)}%</span></div>`).join("");
  }
  $("rSel").addEventListener("change", () => { rWeek = $("rSel").value; renderReport(); });
  $("rPrev").onclick = () => { const o = [...$("rSel").options].map((x) => x.value); const i = o.indexOf(rWeek); if (i > 0) { rWeek = o[i - 1]; renderReport(); } };
  $("rNext").onclick = () => { const o = [...$("rSel").options].map((x) => x.value); const i = o.indexOf(rWeek); if (i >= 0 && i < o.length - 1) { rWeek = o[i + 1]; renderReport(); } };
  $("rTrend").addEventListener("click", (e) => { const r = e.target.closest(".hit"); if (r) { rWeek = r.dataset.w; renderReport(); } });

  // ---------- 시작 ----------
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  renderMain();
  pull().then(() => { invalidate(); renderMain(); learnTrack(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !$("v-forecast").hidden) fcSave(); });
  // 지금 보이는 화면을 새 데이터로 다시 그림 (입력 중인 칸이 있으면 그 화면은 건드리지 않음)
  function refreshVisible() {
    invalidate();
    const typing = (id) => { const a = document.activeElement; return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && $(id).contains(a); };
    if (!$("v-main").hidden && !typing("v-main")) renderMain();
    else if (!$("v-main").hidden) renderMis();
    if (!$("v-forecast").hidden) renderSales();
    if (!$("v-forecast").hidden && !typing("v-forecast")) renderForecast();
    if (!$("v-report").hidden) renderReport();
    if (!$("v-files").hidden && !typing("v-files")) renderFiles();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pull().then(refreshVisible); });
  // 다른 기기에서 넣은 재고·Forecast도 10~30초 안에 반영 (리포트의 오차 범위 큰 품목 등)
  // 시트 변경 확인: 10초마다 버전만 묻고(가벼움) 바뀌었을 때만 전체를 받음. 옛 Apps Script(버전 없음)면 30초마다 전체
  let polling = false, lastFull = 0, noVer = false;
  setInterval(async () => {
    if (document.hidden || polling || !API) return;
    polling = true;
    try {
      let need = Date.now() - lastFull > 30000 || Date.now() < misFastUntil;
      if (!noVer) try { const r = await fetch(API + "?api=1&ver=1&t=" + Date.now()), j = await r.json(); if (j && j.ver) need = j.ver !== lastVer; else noVer = true; } catch {}
      if (need) { lastFull = Date.now(); if (await pull(true)) refreshVisible(); }
    } finally { polling = false; }
  }, 10000);
  // GW 전송·Gross 불러오기를 누른 뒤 3분 동안은 2초마다 전송 상태만 가볍게 확인 → 바뀌었을 때만 전체를 받음. 결과가 나오면 바로 멈춤
  //  옛 Apps Script(status 모름)면 3초마다 전체
  let fastSig = "", noStatus = false;
  setInterval(async () => {
    if (Date.now() > misFastUntil || document.hidden || polling || !API) return;
    if (noStatus && Date.now() - lastFull < 3000) return;
    polling = true;
    try {
      let need = true;
      if (!noStatus) try {
        const j = await (await fetch(API + "?api=1&status=1&t=" + Date.now())).json();
        if (j && j.status) { const sig = JSON.stringify([j.status.misPush, j.status.salesPush]); need = sig !== fastSig; fastSig = sig; } else noStatus = true;
      } catch {}
      if (need) { lastFull = Date.now(); if (await pull(true)) refreshVisible(); }
      const busy = (x) => x && /pending|running/.test(x.status);
      if (!busy(db.misPush) && !busy(db.salesPush)) misFastUntil = 0;
    } finally { polling = false; }
  }, 2000);
  window.__orderCalc = { model, orderWindow, orderWindowFor, estStock, incomingOf, ordToStock, calc, dataForecast, prepPlan: () => prepPlan(model()), batchAdj, db: () => db, TODAY, fcBias, fcErr, fcVar };
})();
