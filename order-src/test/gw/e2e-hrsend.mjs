// HR 주간스케쥴 전송 시험 (확장 gw-agent를 진짜로 올려서): 가짜 보드 [전송] → 확장 → 가짜 HR 주간스케쥴(시간) → 결과가 보드로
//  e2e-order.mjs처럼 --host-resolver-rules로 모든 주소(HR·보드·시트·GW·MIS·Pages)를 이 시험의 가짜 서버로 보냄 → 진짜 서버에 요청이 안 나감
//  가짜 HR 화면은 KM이 알려 준 ID(hrt2325_…)·문구(토스트·confirm)대로 흉내 냄. 직원 이름·사번은 지어낸 것
// 사용: node order-src/test/gw/e2e-hrsend.mjs [--v]
import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
const req = (m) => import(m).catch(() => import("/opt/node22/lib/node_modules/" + m + "/index.mjs"));
const { chromium } = await req("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, "../../.."), EXT = REPO + "/gw-agent", V = process.argv.includes("--v");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gw-hrs-")), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", TMP + "/key.pem", "-out", TMP + "/cert.pem", "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore" });

// ---- 가짜 HR 상태 ----
//  REG: HR에 등록된 직원(부서별 사번→이름). status: 주차별 상태(EDIT·NOTICE·CONFIRM, ""=상태 없음)
let S;
const REG0 = { BOH: { "90000001": "시험일", "90000002": "시험이", "90000003": "시험삼" }, FOH: { "90000009": "시험구" }, STORE: { "90000020": "시험점" } };
const KCODE = { 출근: "10", 휴무: "17", 주휴일: "18", 공휴일: "19" }, KNAME = { 10: "출근", 17: "휴무", 18: "주휴일", 19: "공휴일" }, DOWS0 = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
// 저장된 주 자료 (메인 표에 보이는 값): week[사번][요일] = { code, on, off, brk }. STORE 직원은 미리 채워 둠(정상: 수 주휴일·나머지 휴무)
const weekOf = (pat) => Object.fromEntries(DOWS0.map((d, i) => [d, pat[i] === "출근" ? { code: "10", on: "09:00", off: "18:00", brk: "01:00" } : { code: KCODE[pat[i]] || pat[i], on: "", off: "", brk: "" }]));
const reset = (o) => { S = Object.assign({ week: { "90000020": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]) }, login: true, status: { 48: "EDIT" }, reg: JSON.parse(JSON.stringify(REG0)), saves: [], notice: 0, confirm: 0, init: 0, uploads: 0, uploadHttp: 200, deptStart: "FOH", weekStart: 46, calls: [] }, o || {}); };
reset();
const WEEKS = { 45: ["11/02", "11/08"], 46: ["11/09", "11/15"], 47: ["11/16", "11/22"], 48: ["11/23", "11/29"], 49: ["11/30", "12/06"] };
const hrPage = () => `<!doctype html><meta charset="utf-8"><title>HR</title><body>
<ul id="gnb"><li menu-desc="근태관리"><span class="menu-step1">근태관리</span><ul><li><a href="#" menu-app-id="HRT/W_HRT6300"><span>출퇴근상세조회</span></a></li><li><a href="#" menu-app-id="HRT/W_HRT2325"><span>주간스케쥴(시간)</span></a></li></ul></li></ul>
<input type="password" id="jlamp_autocomplete_2" style="opacity:0;width:0;height:0;border:0;padding:0"><div id="app"></div><div id="toasts"></div><div id="jl_noti" style="display:none"><span id="jl_noti_msg"></span><button id="jl_noti_footer_btn1">확인</button></div>
<script>
const W=${JSON.stringify(WEEKS)}; let wk=${S.weekStart}, dept=${JSON.stringify(S.deptStart)}, status='';
const DOWS=['MON','TUE','WED','THU','FRI','SAT','SUN'], KN={'10':'출근','17':'휴무','18':'주휴일','19':'공휴일'};
// 사이트 전역 흉내: jq(ajaxSend·ajaxComplete·data·find), decParam, doClientMsg
const H=[],HS=[];
function Wr(el){return {el,data(k){return el&&el.__k&&el.__k[k];},find(sel){return Wr(el&&el.querySelector(sel));}};}
window.jq=function(sel){ if(sel===document) return {ajaxComplete(fn){H.push(fn);},ajaxSend(fn){HS.push(fn);}}; if(sel&&sel.el!==undefined) return sel; return Wr(typeof sel==='string'?document.querySelector(sel):sel); };
window.decParam=(s)=>decodeURIComponent(escape(atob(s)));
window.doClientMsg=function(m){const s=typeof m==='object'?m.message:m;const d=document.createElement('div');d.className='toast-msg';d.textContent=s;document.getElementById('toasts').appendChild(d);setTimeout(()=>d.remove(),3000);};
async function ajax(ep,body){const url='/HRT/W_HRT2325/W_HRT2325/'+ep;const st={url};HS.forEach(h=>h({},{},st));const r=await fetch(url,{method:'POST',body:JSON.stringify(body||{})});const t=await r.text();H.forEach(h=>h({}, {status:r.status,responseText:t}, st));try{return {status:r.status,j:JSON.parse(t)};}catch(e){return {status:r.status,j:null};}}
document.querySelector('a[menu-app-id="HRT/W_HRT2325"]').addEventListener('click',(e)=>{e.preventDefault();setTimeout(render,300);});
let rows=[];
function btns(){document.getElementById('hrt2325_btn_notice').disabled=status!=='EDIT';document.getElementById('hrt2325_btn_confirm').disabled=status!=='NOTICE';document.getElementById('hrt2325_btn_init').disabled=!(wk>=47);document.getElementById('hrt2325_btn_save').disabled=true;} /* 실제 화면처럼 꺼져 있을 수 있음 → saveData() 직접 */
// kendo ObservableObject 흉내: set() → dirty
function obs(x){x.dirty=false;x.set=function(f,v){this[f]=v;this.dirty=true;btns();};return x;}
const cols=[{field:'workType'},{field:'emp_name'},{field:'duty_name'}].concat(DOWS.map(d=>({field:d+'_time_item_code_p'})));
function draw(){const el=document.getElementById('hrt2325_info_list_html');el.innerHTML='<table><tbody>'+rows.map((x,i)=>'<tr data-uid="u'+i+'"><td></td><td>'+x.emp_name+'</td><td>직책 010-xxxx</td>'+DOWS.map(d=>'<td>'+(KN[x[d+'_time_item_code_p']]||'')+(x[d+'_work_on_p_hhmm']?' '+x[d+'_work_on_p_hhmm']+'~'+x[d+'_work_off_p_hhmm']:'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';const tbl=el.querySelector('table');
 el.__k={kendoGrid:{columns:cols,table:[tbl],dataItem(tr){return rows[+tr.getAttribute('data-uid').slice(1)];},
  editCell(w){const td=w.el;const s=document.createElement('span');s.setAttribute('data-role','dropdownlist');s.__k={kendoDropDownList:{options:{dataValueField:'time_item_code',dataTextField:'time_item_name'},dataSource:{data(){const L=[{time_item_code:'10',time_item_name:'출근'},{time_item_code:'17',time_item_name:'휴무'},{time_item_code:'18',time_item_name:'주휴일'},{time_item_code:'19',time_item_name:'공휴일'}];return {toJSON(){return L;}};}}}};td.appendChild(s);window.__edited=(window.__edited||0)+1;},
  closeCell(){document.querySelectorAll('#hrt2325_info_list_html [data-role=dropdownlist]').forEach(x=>x.remove());},
  dataSource:{data(){return rows;},view(){return rows;},hasChanges(){return rows.some(r=>r.dirty);},cancelChanges(){window.__cancel=(window.__cancel||0)+1;rows.forEach(r=>{r.dirty=false;});draw();btns();}}}};}
async function search(){const r=await ajax('getMasterList_prc',{workType:'MASTER',dept,wk});const a=JSON.parse(decParam(r.j.data.infoEnc));status=a.length?a[0].schedule_status:'';const mr=await ajax('getMasterList_prc',{workType:'MAINROWS',dept,wk});rows=JSON.parse(decParam(mr.j.data.infoEnc)).map(obs);const S_OTHER=${JSON.stringify(S.otherEdit||'')};if(${JSON.stringify(!!S.preDirty)}&&rows[1]&&!window.__pd){window.__pd=1;rows[1].dirty=true;rows[1].workType='U';rows[1].MON_work_on_p_hhmm='07:00';}const DA=${JSON.stringify(S.dirtyAfter||[])};rows.forEach(r=>{if(DA.includes(String(r.emp_code))){r.dirty=true;if(S_OTHER&&String(r.emp_code)===S_OTHER){r.MON_work_on_p_hhmm='06:30';r.workType='U';}}});draw();btns();}
function render(){document.getElementById('app').innerHTML=\`
 <input type="hidden" id="hrt2325_search_site_code" value="5090"><input type="hidden" id="hrt2325_dept_category" value="\${dept}">
 <input type="hidden" id="hrt2325_yyyy" value="2026"><input type="hidden" id="hrt2325_year_week_seq" value="\${wk}">
 <label><input type="checkbox" id="hrt2325_search_leave_yn" checked>휴직자 미포함</label>
 <span class="dd"><button type="button" id="ddb">\${dept||"전체"}</button><ul id="ddl" style="display:none"><li>전체</li><li>BOH</li><li>FOH</li><li>STORE</li></ul></span>
 <button onclick="hrt2325.moveWeek('prev')">‹</button><span id="wk">\${wk}주(\${W[wk][0]}~\${W[wk][1]})</span><button onclick="hrt2325.moveWeek('next')">›</button>
 <button id="hrt2325_btn_search">검색</button><button id="hrt2325_btn_pop">일자별 수정</button><button id="hrt2325_btn_save" disabled>저장</button>
 <button id="hrt2325_btn_notice" disabled>공지</button><button id="hrt2325_btn_confirm" disabled>확정</button><button id="hrt2325_btn_init" disabled>초기화</button><button id="hrt2325_btn_copy">전주복사</button>
 <div class="k-grid" id="hrt2325_info_list_html"></div>\`;
 document.getElementById('ddb').onclick=()=>{document.getElementById('ddl').style.display='block';};
 document.querySelectorAll('#ddl li').forEach(li=>li.onclick=()=>{dept=li.textContent==='전체'?'':li.textContent;document.getElementById('hrt2325_dept_category').value=dept;document.getElementById('ddb').textContent=dept||'전체';document.getElementById('ddl').style.display='none';});
 document.getElementById('hrt2325_btn_search').onclick=search;
 document.getElementById('hrt2325_btn_pop').onclick=()=>{window.__pop=1;};
 document.getElementById('hrt2325_btn_save').onclick=()=>hrt2325.saveData();
 document.getElementById('hrt2325_btn_notice').onclick=async()=>{if(!confirm('공지 하시겠습니까?'))return;await ajax('statusChangeData_prc',{to:'NOTICE',wk});await search();doClientMsg('공지 되었습니다.');};
 document.getElementById('hrt2325_btn_confirm').onclick=async()=>{if(!confirm('확정 하시겠습니까?'))return;await ajax('statusChangeData_prc',{to:'CONFIRM',wk});await search();doClientMsg('확정 되었습니다.');};
 document.getElementById('hrt2325_btn_init').onclick=async()=>{if(!confirm('기존에 등록된 자료가 있다면 삭제 후 초기화가 진행됩니다.'))return;await ajax('init_prc',{wk});await search();doClientMsg('초기화 되었습니다.');};
 document.getElementById('hrt2325_btn_copy').onclick=()=>ajax('copy_prc',{});
}
window.hrt2325={async saveData(){window.__saveCalls=(window.__saveCalls||0)+1;const ch=rows.filter(r=>r.workType==='U').map(r=>{const o={emp_code:r.emp_code};DOWS.forEach(d=>['_time_item_code_p','_time_item_name_p','_work_on_p_hhmm','_work_off_p_hhmm','_break_time_p_hhmm'].forEach(f=>o[d+f]=r[d+f]));return o;});const sp=document.createElement('div');sp.className='k-loading-mask';sp.style.cssText='position:fixed;inset:0';document.body.appendChild(sp);const r=await ajax('saveData_prc',{dept,wk,rows:ch});sp.remove();if(!r.j||r.j.returnCode!==0){const d=document.createElement('div');d.className='k-window';d.setAttribute('role','dialog');d.textContent=(r.j&&r.j.p_error_str)||'저장 오류';document.body.appendChild(d);return;}await search();if(${JSON.stringify(!!S.stickyDirty)})rows.forEach(r=>{if(ch.some(c=>c.emp_code===r.emp_code))r.dirty=true;});},moveWeek(d){wk+=d==='next'?1:-1;document.getElementById('wk').textContent=wk+'주('+W[wk][0]+'~'+W[wk][1]+')';document.getElementById('hrt2325_year_week_seq').value=wk;},btnEnable(){btns();},getMasterList(){},validateConfirm(){},statusChangeData(){},openMdl(){}};
</script></body>`;
const boardPage = `<!doctype html><meta charset="utf-8"><title>HR Board</title><body>board<script>window.__msgs=[];addEventListener('message',e=>{if(e.source===window&&/^MFG_HR_(AGENT_READY|SEND_ACK|SEND_PROGRESS|SEND_RESULT|PUBLISH_RESULT)/.test((e.data||{}).type))window.__msgs.push(e.data);});window.send=(o)=>window.postMessage(Object.assign({type:'MFG_HR_SEND'},o),location.origin);</script></body>`;
const hits = [];
const srv = https.createServer({ key: fs.readFileSync(TMP + "/key.pem"), cert: fs.readFileSync(TMP + "/cert.pem") }, async (rq, rs) => {
  const host = String(rq.headers.host || "").replace(/:\d+$/, ""), u = new URL(rq.url, "https://x"), ck = rq.headers.cookie || "";
  let body = ""; for await (const c of rq) body += c;
  hits.push(host + u.pathname);
  const html = (b, h) => { rs.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...(h || {}) }); rs.end(b); };
  const json = (o) => { rs.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); rs.end(JSON.stringify(o)); };
  if (host === "hr.pljec.cloud") {
    if (u.pathname === "/__reg") return json(S.reg);
    const ep = (/\/(\w+_prc)$/.exec(u.pathname) || [])[1];
    if (ep) {
      const b = JSON.parse(body || "{}"); S.calls.push(ep);
      const enc = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
      if (ep === "getMasterList_prc" && b.workType === "MASTER") { const st = S.status[b.wk] || ""; return json({ returnCode: 0, data: { infoEnc: enc(st ? [{ schedule_status: st }] : []) } }); }
      const regRows = () => { const reg = S.reg[b.dept] || {}; return Object.keys(reg).map((no) => ({ emp_code: no, emp_name: reg[no], chk_message: "" })); };
      if (ep === "getMasterList_prc" && b.workType === "MAINROWS") {
        const depts = b.dept ? [b.dept] : Object.keys(S.reg), rows = [];
        if (!S.emptyWeek) depts.forEach((d) => Object.entries(S.reg[d] || {}).forEach(([no, nm]) => { const r = { emp_code: no, emp_name: nm + "<br>(" + d + " 직책)", duty_name: "직책 010-xxxx", dept_name: d }; const w = S.week[no] || {}; DOWS0.forEach((D) => { const x = w[D] || { code: "", on: "", off: "", brk: "" }; r[D + "_edit_yn"] = S.lockDay === D ? "N" : x.code ? "Y" : ""; r[D + "_time_item_code_p"] = x.code; r[D + "_time_item_name_p"] = KNAME[x.code] || ""; r[D + "_work_on_p_hhmm"] = x.on; r[D + "_work_off_p_hhmm"] = x.off; r[D + "_break_time_p_hhmm"] = x.brk; }); rows.push(r); }));
        return json({ returnCode: 0, data: { infoEnc: enc(rows) } });
      }
      if (ep === "uploadDayExcelFile_prc") { S.uploads++; return json({ returnCode: 0 }); }
      if (ep === "saveData_prc") {
        if (S.saveErr) return json({ returnCode: -1, p_error_str: S.saveErr });
        const bad = (b.rows || []).find((r) => !(S.reg[b.dept] || {})[r.emp_code]);
        if (b.dept && bad) return json({ returnCode: -1, p_error_str: `${(Object.values(S.reg).find((x) => x[bad.emp_code]) || {})[bad.emp_code] || bad.emp_code}님 소속구분이 다름` });
        S.saves.push({ dept: b.dept, wk: b.wk, n: (b.rows || []).length, emps: (b.rows || []).map((r) => r.emp_code) });
        (b.rows || []).forEach((r) => { const w = (S.week[r.emp_code] = S.week[r.emp_code] || {}); DOWS0.forEach((D) => { if (S.dropDay === D) return; w[D] = { code: r[D + "_time_item_code_p"] || "", on: r[D + "_work_on_p_hhmm"] || "", off: r[D + "_work_off_p_hhmm"] || "", brk: r[D + "_break_time_p_hhmm"] || "" }; }); });
        return json({ returnCode: 0 });
      }
      if (ep === "statusChangeData_prc") { S.status[b.wk] = b.to; if (b.to === "NOTICE") S.notice++; else S.confirm++; return json({ returnCode: 0 }); }
      if (ep === "init_prc") { S.init++; S.status[b.wk] = "EDIT"; return json({ returnCode: 0 }); }
      if (ep === "copy_prc") { S.copy = 1; return json({ returnCode: 0 }); }
    }
    if (!S.login) return html(`<!doctype html><meta charset="utf-8"><body><input type="text" id="login_id"><input type="password"><button class="login_btn">로그인</button></body>`);
    return html(hrPage());
  }
  if (host === "hr-board-teal.vercel.app") return html(boardPage);
  if (/script\.google/.test(host)) return json({ ok: true, data: {}, status: {} }); // 시트: 아무것도 안 함
  rs.writeHead(404); rs.end();
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const rules = ["hr.pljec.cloud", "hr-board-teal.vercel.app", "gw.madforgarlic.com", "mis.madforgarlic.com", "script.google.com", "script.googleusercontent.com", "mfgkorea.github.io"].map((h) => `MAP ${h} 127.0.0.1:${port}`).concat(["MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1"]).join(",");
const ctx = await chromium.launchPersistentContext(TMP + "/prof", {
  executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined, headless: true, env: { ...process.env, TZ: "Asia/Seoul" },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=${rules}`, "--ignore-certificate-errors", "--no-proxy-server"],
});
const getSW = async () => ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) || (await ctx.waitForEvent("serviceworker", { timeout: 40000 }));
const sw = async (fn, a) => { for (let i = 0; i < 6; i++) { try { return await (await getSW()).evaluate(fn, a); } catch (e) { await sleep(400); } } return null; };
const extId = (await getSW()).url().split("/")[2], ver = await sw(() => chrome.runtime.getManifest().version);
await sw(() => chrome.storage.local.set({ on: false, auto: false, hron: false })); // 발주·매출·HR 덤프는 끔 (이 시험은 HR 전송만)
const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${extId}/popup.html`); // 배경이 잠들지 않게
let fails = 0, n = 0; const ok = (c, m, extra) => { n++; console.log((c ? "통과 " : "실패 ") + m + (c || extra == null ? "" : "\n   " + String(extra).slice(0, 600))); if (!c) fails++; };
console.log(`# 확장 ${ver} · 가짜 서버 127.0.0.1:${port} (진짜 HR·보드로는 안 나감)`);

const W = "2026-11-23", dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(W + "T00:00:00Z") + i * 864e5).toISOString().slice(0, 10));
const K = ["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"];
const emp = (no, name, kinds) => ({ empNo: no, name, days: dates.map((d, i) => ({ date: d, kind: (kinds || K)[i], in: (kinds || K)[i] === "출근" ? "09:00" : "", out: (kinds || K)[i] === "출근" ? "18:00" : "", brk: (kinds || K)[i] === "출근" ? "01:00" : "" })) });
const reqOf = (o) => Object.assign({ requestId: "r" + Math.random().toString(36).slice(2), dept: "BOH", weekStart: W, weekEnd: "2026-11-29", mode: "full", employees: [emp("90000001", "시험일"), emp("90000002", "시험이"), emp("90000003", "시험삼")] }, o || {});
let board = null;
async function send(o, ms = +(process.env.HRS_MS || 150000)) {
  if (!o.keepHr) for (const p of ctx.pages()) if (/hr\.pljec/.test(p.url())) await p.close().catch(() => {}); // 지난 HR 탭은 닫고 새로 (keepHr: 같은 탭 그대로 = 매장 PC처럼)
  if (!board || board.isClosed()) { board = await ctx.newPage(); await board.goto("https://hr-board-teal.vercel.app/"); }
  else await board.reload();
  await board.waitForFunction(() => window.__msgs.some((m) => m.type === "MFG_HR_AGENT_READY"), null, { timeout: 15000 });
  const r = reqOf(o);
  await board.evaluate((r) => window.send(r), r);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await board.evaluate((id) => window.__msgs.filter((x) => x.requestId === id), r.requestId).catch(() => []);
    const res = m.find((x) => /^MFG_HR_(SEND|PUBLISH)_RESULT$/.test(x.type));
    if (res) { if (V) console.log("   결과:", JSON.stringify({ ...res, log: undefined }).slice(0, 400), "\n   기록:", res.log.map((l) => `${l.stage}${l.day ? "/" + l.day : ""} ${l.msg}`).join(" | ").slice(0, 700)); return { req: r, res, msgs: m }; }
    await sleep(500);
  }
  if (V) console.log('   보드 메시지:', JSON.stringify(await board.evaluate(() => window.__msgs).catch((e) => String(e))).slice(0, 600), '\n   확장:', JSON.stringify(await sw(() => chrome.storage.local.get(['hrSend', 'logs']))).slice(0, 800));
  return { req: r, res: null, msgs: [] };
}

if (process.env.HRS_ONLY) { reset(); const y = await send({ mode: 'test' }); console.log(JSON.stringify(y.res).slice(0, 900)); process.exit(0); }
const brief = (x) => JSON.stringify(x.res && { ...x.res, log: x.res.log.map((l) => `${l.stage}${l.day ? "/" + l.day : ""} ${l.msg}`) });
const all3 = () => [emp("90000001", "시험일"), emp("90000002", "시험이"), emp("90000003", "시험삼")];
const mgr = () => emp("90000020", "시험점");
// 1) test: 월요일만 카드 입력 → [저장] 한 번. 업로드·팝업은 안 씀. 부서 FOH→BOH, 주차 46→48
reset();
let x = await send({ mode: "test", employees: all3() });
ok(x.res && x.res.ok && x.res.test && x.res.savedDays.join() === "MON" && S.saves.length === 1 && S.saves[0].dept === "" && S.saves[0].wk === 48 && S.uploads === 0 && S.notice === 0 && !S.deptPicked, `test: 소속구분 빈칸(전체)에서 카드 입력·저장 1번(48주), 업로드 0 · 공지 0 (저장 ${S.saves.length})`, brief(x));
ok(S.week["90000001"] && S.week["90000001"].MON.code === "10" && S.week["90000001"].MON.on === "09:00" && ["TUE", "WED", "SUN"].every((d) => !S.week["90000001"][d] || S.week["90000001"][d].code === ""), "test: 월요일만 들어가고 화~일은 그대로", JSON.stringify(S.week["90000001"]));
ok(x.msgs.some((m) => m.type === "MFG_HR_SEND_ACK" && m.ok) && x.res.log.some((l) => /saveData_prc 200/.test(l.ajax || "")) && x.res.log.some((l) => /다시 읽어 확인 맞음/.test(l.msg)), "보드가 ACK·단계를 받고, [저장]이 꺼져 있어도 saveData()로 저장 뒤 다시 읽어 확인", brief(x));
// 2) saveOnly: 7일 한 번에, 주휴일 코드(18)는 근태 칸 드롭다운에서 읽음
reset();
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && x.res.ok && x.res.savedDays.length === 7 && S.saves.length === 1 && S.week["90000001"].WED.code === "18" && S.week["90000001"].SUN.code === "17" && S.week["90000001"].SUN.on === "" , "saveOnly: 7일을 저장 한 번에, 주휴일 코드 18", brief(x));
ok(!S.copy && !S.init && S.uploads === 0, "전주복사·초기화·업로드 안 누름");
// 3) 부서를 고르지 않음: BOH 3명 + 관리자(STORE) 1명 → 전체 화면에서 저장 한 번
reset();
x = await send({ mode: "saveOnly", employees: [...all3(), mgr()] });
ok(x.res && x.res.ok && S.saves.length === 1 && S.saves[0].dept === "" && S.saves[0].n === 4 && x.res.savedEmpNos.length === 4, `BOH 3명 + STORE 관리자 1명 → 전체 화면에서 한 번에 저장 (${S.saves.map((q) => (q.dept || "전체") + q.n).join(",")})`, brief(x));
// 4) 표에 없는 사번 → 그 사람만 건너뛰고 보고, 나머지는 저장 (11/17 KM)
reset();
x = await send({ mode: "test", employees: [...all3(), emp("99999999", "없는사람")] });
ok(x.res && x.res.ok && S.saves.length === 1 && S.saves[0].n === 3 && (x.res.skipped || []).some((k) => k.empNo === "99999999"), "표에 없는 사번 → 건너뛰고 보고, 나머지 3명 저장", brief(x));
// 4b) 입력에 주휴일이 없는 직원 → HR의 기존 주휴일(수)은 덮어쓰지 않고 '확인 필요'
reset({ week: { "90000001": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]), "90000020": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]) } });
x = await send({ mode: "saveOnly", employees: [emp("90000001", "시험일", ["출근", "출근", "휴무", "출근", "출근", "출근", "휴무"]), emp("90000002", "시험이"), emp("90000003", "시험삼")] });
ok(x.res && x.res.ok && S.week["90000001"].WED.code === "18" && S.week["90000001"].MON.code === "10" && (x.res.kept || []).some((k) => k.empNo === "90000001" && k.dow === "WED"), "주휴일 없는 입력 → 기존 수요일 주휴일 유지·확인 필요", brief(x));
// 5) 일부만 보내면 → 보낸 직원만 저장, 안 보낸 직원 행은 그대로 (부서 칸 검사 없음, 11/17 KM)
reset({ week: { "90000003": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]), "90000020": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]) } });
x = await send({ mode: "test", employees: [emp("90000001", "시험일"), emp("90000002", "시험이")] });
ok(x.res && x.res.ok && S.saves.length === 1 && S.saves[0].emps.join() === "90000001,90000002" && S.week["90000003"].MON.code === "17", "일부만 보내면 그 직원만 저장, 나머지 행은 그대로", brief(x));
// 6) 확정·공지된 주
reset({ status: { 48: "CONFIRM" } }); x = await send({ employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "confirmed" && S.saves.length === 0, "이미 확정된 주 → 멈춤", brief(x));
reset({ status: { 48: "NOTICE" } }); x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "noticed" && S.saves.length === 0, "공지된 주 → 멈춤", brief(x));
// 7) 보내기 전 검사
reset();
x = await send({ mode: "test", employees: [emp("90000001", "시험일", ["출근", "연차", "주휴일", "출근", "출근", "출근", "휴무"]), emp("90000002", "시험이"), emp("90000003", "시험삼")] });
ok(x.res && !x.res.ok && x.res.stage === "precheck" && /연차/.test(x.res.rowErrors[0].msg) && S.saves.length === 0, "근태유형 '연차' → precheck에서 멈춤", brief(x));
const t9 = all3(); t9[0].days[0] = { date: dates[0], kind: "출근", in: "9:00", out: "18:00", brk: "1:00" };
reset(); x = await send({ mode: "test", employees: t9 });
ok(x.res && x.res.ok && S.week["90000001"].MON.on === "09:00" && S.week["90000001"].MON.brk === "01:00", "\"9:00\"·\"1:00\" → 09:00·01:00으로 입력", brief(x));
// 8) HR이 저장을 거부(오류 문구) → 그 문구 그대로 멈춤
reset({ saveErr: "시험이님의 주휴일을 설정해주세요" });
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && !x.res.ok && x.res.stage === "save" && /주휴일을 설정해주세요/.test(x.res.message), "HR 저장 오류(대화창) → save에서 문구 그대로", brief(x));
// 9) 수정할 수 없는 날(edit_yn N) → 그 칸만 건너뛰고 보고
reset({ lockDay: "MON", week: { "90000001": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]), "90000020": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]) } });
x = await send({ mode: "test", employees: all3() });
ok(x.res && x.res.ok && (x.res.locked || []).some((k) => k.empNo === "90000001" && k.dow === "MON") && S.week["90000001"].MON.code === "17", "edit_yn N인 칸 → 건너뛰고 보고(값 그대로)", brief(x));
// 9b) 이미 같은 값 → 바꿀 칸 0개 (저장 안 누름)
reset({ week: { "90000001": weekOf(["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"]), "90000002": weekOf(["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"]), "90000003": weekOf(["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"]) } });
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && x.res.ok && S.saves.length === 0 && x.res.changed === 0, "이미 같으면 바꿀 칸 0개, 저장 호출 안 함", brief(x));
// 10) 저장은 됐는데 다시 읽어 보니 한 요일이 안 들어감 → 알림 (9시간 넘는 근무 휴게 경고도 결과에)
reset({ dropDay: "FRI" });
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && !x.res.ok && x.res.stage === "save" && x.res.rowErrors.some((e) => e.day === "FRI"), "저장 뒤 다시 읽어 값이 다르면 알림(FRI)", brief(x));
// 10b) 누가 HR 표를 고치다 만 상태(저장 안 된 변경) → 같이 저장되지 않게 멈춤
reset({ preDirty: true });
x = await send({ mode: "test", employees: all3() });
ok(x.res && !x.res.ok && x.res.stage === "save" && /저장 안 된 변경/.test(x.res.message) && S.saves.length === 0, "HR 표에 남의 저장 안 된 변경 → 저장 안 하고 멈춤", brief(x));
// 10c) (1.17.2) 저장 직후 HR 표에 '저장 안 된 변경' 표시가 남아도(다시 불러오기 중) 방금 저장한 행은 내 것 → 같은 탭에서 바로 다시 보내도 멈추지 않음
reset({ stickyDirty: true });
x = await send({ mode: "saveOnly", employees: all3() });
const hrTab = () => ctx.pages().find((p) => /hr\.pljec/.test(p.url()));
ok(x.res && x.res.ok && S.saves.length === 1 && (await hrTab().evaluate(() => !jq("#hrt2325_info_list_html").data("kendoGrid").dataSource.data().some((r) => /^[UID]$/.test(String(r.workType || ""))))), "저장 뒤 kendo 변경 표시가 남아도(다시 불러오기 직후) 저장할 행(workType)은 없음 → 깨끗", brief(x));
S.dirtyAfter = ["90000001", "90000002", "90000003"]; await hrTab().reload(); await sleep(800); // 매장처럼: 검색 뒤에도 방금 저장한 행에 '변경' 표시가 남는 경우
x = await send({ mode: "saveOnly", keepHr: true, employees: all3() });
ok(x.res && x.res.ok && S.saves.length === 1 && !x.res.log.some((l) => /저장 안 된 변경 표시|저장 안 된 변경이/.test(l.msg)) && x.res.log.some((l) => /EDIT\(작성 중 · 공지 전\)/.test(l.msg)), "(1.17.3) HR 화면이 불러올 때 켜는 kendo 변경 표시(합계 칸 등, workType 없음)는 '저장 안 된 변경'으로 안 봄 → 같은 탭에서 바로 다시 보내도 진행 · 주차 상태 EDIT는 '작성 중'으로 따로", brief(x));
S.dirtyAfter = ["90000001", "90000002", "90000003", "90000020", "90000009"]; await hrTab().reload(); await sleep(800);
x = await send({ mode: "saveOnly", keepHr: true, employees: [emp("90000001", "시험일", ["출근", "휴무", "주휴일", "출근", "출근", "출근", "휴무"]), emp("90000002", "시험이"), emp("90000003", "시험삼")] });
ok(x.res && x.res.ok && S.saves.length === 2 && S.week["90000001"].TUE.code === "17", "표 전원에 kendo 변경 표시만 켜져 있어도(검색만 해도 켜지는 경우) 멈추지 않고 저장", brief(x));
S.dirtyAfter = ["90000001", "90000020"]; S.otherEdit = "90000020"; await hrTab().reload(); await sleep(800);
x = await send({ mode: "saveOnly", keepHr: true, employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "dirty" && /90000020/.test(x.res.message) && !/90000001/.test(x.res.message) && S.saves.length === 2, "남의 행(보내지 않은 90000020, 값을 고침)에 저장 안 된 변경 → 예전처럼 멈춤, 그 사번만 알려 줌", brief(x));
S.dirtyAfter = ["90000002"]; S.otherEdit = "90000002"; await hrTab().reload(); await sleep(800);
x = await send({ mode: "saveOnly", keepHr: true, employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "dirty" && /90000002/.test(x.res.message) && S.saves.length === 2, "방금 저장한 사람이라도 표 값을 누가 고쳤으면(06:30) 남의 변경 → 멈춤", brief(x));
// 10d) (1.17.4) 소속구분 전체 화면: 사번은 맞는데 이름이 다르면 그 사람은 건너뜀(다른 사람 줄에 넣지 않음) · 사번이 HR에 없으면 같은 이름의 HR 사번을 알려 줌 · 나머지는 사번으로 제 줄에
reset();
x = await send({ mode: "saveOnly", employees: [emp("90000001", "다른사람"), emp("90000777", "시험이"), emp("90000003", "시험삼")] });
ok(x.res && x.res.ok && !S.week["90000001"] && S.week["90000003"] && S.week["90000003"].MON.code === "10" && (x.res.skipped || []).some((k) => k.empNo === "90000001" && /이름이 달라/.test(k.msg)) && (x.res.skipped || []).some((k) => k.empNo === "90000777" && /같은 이름은 HR 사번 90000002/.test(k.msg)) && !S.week["90000002"], "사번·이름이 둘 다 맞는 줄에만 넣음: 이름 다름 → 건너뜀 · 사번 틀림 → HR 사번 알려 줌 · 맞는 사람은 저장", brief(x));
// 11) 로그인 풀림 · 같은 requestId
reset({ login: false }); x = await send({ employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "login" && S.saves.length === 0, "HR 로그인 화면 → 바로 멈춤(login)", brief(x));
reset();
const r1 = await send({ mode: "test", requestId: "same-1", employees: all3() }), saves1 = S.saves.length;
const r2 = await send({ mode: "test", requestId: "same-1", employees: all3() }, 20000);
ok(r1.res && r2.res && r2.res.ok && S.saves.length === saves1 && saves1 === 1, `같은 requestId 두 번 → 한 번만 실행 (저장 ${S.saves.length})`);
// 13) 매장 전체 공지·확정 (PUBLISH)
reset();
await send({ mode: "saveOnly", employees: [...all3(), mgr()] });
await send({ mode: "saveOnly", dept: "FOH", employees: [emp("90000009", "시험구")] });
x = await send({ type: "MFG_HR_PUBLISH", action: "both" });
ok(x.res && x.res.type === "MFG_HR_PUBLISH_RESULT" && x.res.ok && x.res.confirmed && S.notice === 1 && S.confirm === 1 && x.res.log.some((l) => /전체 검색/.test(l.msg)), "PUBLISH: 세 탭 점검 통과 → 전체 화면에서 공지 1·확정 1", brief(x));
reset({ week: { "90000020": Object.assign(weekOf(["휴무", "휴무", "휴무", "휴무", "휴무", "휴무", "휴무"]), { FRI: { code: "10", on: "", off: "", brk: "" } }) } });
await send({ mode: "saveOnly", employees: all3() });
await send({ mode: "saveOnly", dept: "FOH", employees: [emp("90000009", "시험구")] });
x = await send({ type: "MFG_HR_PUBLISH", action: "both" });
ok(x.res && !x.res.ok && x.res.stage === "precheck" && S.notice === 0 && x.res.rowErrors.some((e) => e.empNo === "90000020" && /주휴일이 주에 0일/.test(e.msg)) && x.res.rowErrors.some((e) => e.day === "FRI" && /시간이 없어요/.test(e.msg)), "PUBLISH 점검 걸림 → 공지 안 누르고 직원·요일 회신", brief(x));
reset();
await send({ mode: "saveOnly", employees: all3() });
await send({ mode: "saveOnly", dept: "FOH", employees: [emp("90000009", "시험구")] });
x = await send({ type: "MFG_HR_PUBLISH", action: "notice" }); const n5 = S.notice, c5 = S.confirm;
const y = await send({ type: "MFG_HR_PUBLISH", action: "confirm" });
ok(x.res && x.res.ok && !x.res.confirmed && n5 === 1 && c5 === 0 && y.res && y.res.ok && y.res.confirmed && S.notice === 1 && S.confirm === 1, "PUBLISH: 공지만 → 다음에 확정만", brief(y));
// 15) 사이드패널: 붙여넣기 → HR 화면 주차 확인 → 미리보기(바뀔 칸만) → 체크 → [반영 후 저장]
reset({ week: { "90000002": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]), "90000020": weekOf(["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"]) } });
for (const q of ctx.pages()) if (/hr\.pljec/.test(q.url())) await q.close().catch(() => {});
const hp = await ctx.newPage(); await hp.goto("https://hr.pljec.cloud/");
await hp.click('a[menu-app-id="HRT/W_HRT2325"]'); await hp.waitForSelector("#hrt2325_btn_search");
await hp.click("#ddb"); await hp.click("#ddl li:has-text('전체')");
await hp.evaluate(() => { hrt2325.moveWeek("next"); hrt2325.moveWeek("next"); }); await hp.click("#hrt2325_btn_search"); await sleep(1200);
const spg = await ctx.newPage(); await spg.goto(`chrome-extension://${extId}/sidepanel.html`); await sleep(800);
const rowsOf = (nm, ks, times) => ks.map((k, i) => [nm, k, ...(k === "출근" ? (times || ["9:00", "18:00", "01:00", "8:00"]) : [])].join("\t")).join("\n");
const pasteTxt = [rowsOf("시험일", ["출근", "출근", "주휴일", "출근", "출근", "출근", "휴무"]), rowsOf("시험이", ["휴무", "출근", "휴무", "출근", "출근", "출근", "휴무"]), rowsOf("없는사람", ["휴무", "휴무", "주휴일", "휴무", "휴무", "휴무", "휴무"])].join("\n");
await spg.fill("#paste", pasteTxt); await spg.click("#preview");
await spg.waitForFunction(() => /바뀔 칸|오류|못/.test(document.getElementById("out").textContent), null, { timeout: 40000 });
const pv = await spg.evaluate(() => ({ out: document.getElementById("out").textContent, week: document.getElementById("week").textContent, rows: document.querySelectorAll("#out table tr").length - 1, applyDisabled: document.getElementById("apply").disabled }));
ok(/48주\(11\/23~11\/29\)/.test(pv.week) && pv.rows > 0 && /시험이 WED/.test(pv.out) && /없는사람: 표에 없음/.test(pv.out) && pv.applyDisabled && S.saves.length === 0, `사이드패널 미리보기: 48주, 바뀔 칸 ${pv.rows}개, 주휴일 유지·건너뜀 표시, 체크 전엔 저장 단추 꺼짐, 아직 저장 0`, JSON.stringify(pv).slice(0, 500));
await spg.check("#weekOk"); await spg.click("#apply");
await spg.waitForFunction(() => /저장 됨|저장 안 됨/.test(document.getElementById("out").textContent), null, { timeout: 60000 }).catch(() => {});
const ap = await spg.evaluate(() => document.getElementById("out").textContent);
ok(/저장 됨/.test(ap) && S.saves.length === 1 && S.week["90000001"].MON.code === "10" && S.week["90000001"].MON.on === "09:00" && S.week["90000002"].WED.code === "18" && S.week["90000002"].TUE.code === "10", "사이드패널 [반영 후 저장]: saveData() 한 번, 9:00→09:00, 시험이 수요일 주휴일 유지", ap.slice(0, 400) + " " + JSON.stringify(S.week["90000002"]));
// 14) 진짜 서버로 안 나감 + 다른 칸은 안 건드림
const hosts = [...new Set(hits.map((h) => h.split("/")[0]))];
ok(hosts.every((h) => ["hr.pljec.cloud", "hr-board-teal.vercel.app", "script.google.com", "mfgkorea.github.io", "gw.madforgarlic.com", "mis.madforgarlic.com", "script.googleusercontent.com"].includes(h)), "요청은 모두 가짜 서버로 (" + hosts.join(", ") + ")");
const st = await sw(() => chrome.storage.local.get(["hrSend", "logs"]));
ok(st && st.hrSend && !st.hrSend.run && !(st.logs || []).some((l) => /시험일|시험이|시험삼|시험점|시험구|없는사람/.test(l)), "끝나면 잠금 풀림 · 확장 기록에 이름 없음", JSON.stringify(st && { run: st.hrSend && st.hrSend.run, logs: (st.logs || []).slice(0, 4) }));
await ctx.close(); srv.close();
console.log(fails ? `실패 ${fails}개 / ${n}` : `모두 통과 (${n}개)`); process.exit(fails ? 1 : 0);
