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
const REG0 = { BOH: { "90000001": "시험일", "90000002": "시험이", "90000003": "시험삼" }, FOH: { "90000009": "시험구" } };
const reset = (o) => { S = Object.assign({ login: true, status: { 48: "EDIT" }, reg: JSON.parse(JSON.stringify(REG0)), saves: [], notice: 0, confirm: 0, init: 0, uploads: 0, uploadHttp: 200, deptStart: "FOH", weekStart: 46, calls: [] }, o || {}); };
reset();
const WEEKS = { 45: ["11/02", "11/08"], 46: ["11/09", "11/15"], 47: ["11/16", "11/22"], 48: ["11/23", "11/29"], 49: ["11/30", "12/06"] };
const hrPage = () => `<!doctype html><meta charset="utf-8"><title>HR</title><body>
<ul id="gnb"><li menu-desc="근태관리"><span class="menu-step1">근태관리</span><ul><li><a href="#" menu-app-id="HRT/W_HRT6300"><span>출퇴근상세조회</span></a></li><li><a href="#" menu-app-id="HRT/W_HRT2325"><span>주간스케쥴(시간)</span></a></li></ul></li></ul>
<input type="password" id="jlamp_autocomplete_2" style="opacity:0;width:0;height:0;border:0;padding:0"><div id="app"></div><div id="toasts"></div><div id="jl_noti" style="display:none"><span id="jl_noti_msg"></span><button id="jl_noti_footer_btn1">확인</button><button id="jl_noti_report">오류 신고</button></div>
<script>
const W=${JSON.stringify(WEEKS)}; let wk=${S.weekStart}, dept=${JSON.stringify(S.deptStart)}, status='';
const KIND={'출근':'10','휴무':'17','주휴일':'18','공휴일':'19'}, DOWS=['MON','TUE','WED','THU','FRI','SAT','SUN'];
// 사이트 전역 흉내: jq(ajaxComplete·data('kendoGrid')), decParam, doClientMsg
const H=[],HS=[]; window.jq=function(sel){ if(sel===document) return {ajaxComplete(fn){H.push(fn);},ajaxSend(fn){HS.push(fn);}}; const el=typeof sel==='string'?document.querySelector(sel):sel; return {data(k){return el&&el.__k&&el.__k[k];},modal(c){if(el&&el.__k&&el.__k['bs.modal'])el.__k['bs.modal'][c]();}}; };
// Bootstrap 3 modal 흉내: show → backdrop·body.modal-open, hide → isShown false, 0.36초 뒤 display none·backdrop 지움 (S.stuck이면 backdrop이 남음)
const STUCK=${JSON.stringify(!!S.stuck)};
function mkModal(el){const m={isShown:false,show(){m.isShown=true;el.style.display='block';const b=document.createElement('div');b.className='modal-backdrop in';document.body.appendChild(b);document.body.classList.add('modal-open');},hide(){if(!m.isShown)return;m.isShown=false;setTimeout(()=>{el.style.display='none';if(!(STUCK&&window.__saves>=1))document.querySelectorAll('.modal-backdrop').forEach(b=>b.remove());document.body.classList.remove('modal-open');},360);}};el.__k=Object.assign(el.__k||{},{'bs.modal':m});return m;}
window.decParam=(s)=>decodeURIComponent(escape(atob(s)));
window.doClientMsg=function(m){const s=typeof m==='object'?m.message:m;const d=document.createElement('div');d.className='toast-msg';d.textContent=s;document.getElementById('toasts').appendChild(d);setTimeout(()=>d.remove(),3000);if(/불가|오류|Error/.test(s)){document.getElementById('jl_noti_msg').textContent=s;document.getElementById('jl_noti').style.display='block';}};
document.getElementById('jl_noti_footer_btn1').onclick=()=>{document.getElementById('jl_noti').style.display='none';};
document.getElementById('jl_noti_report').onclick=()=>{window.__reported=1;};
async function ajax(ep,body){const url='/HRT/W_HRT2325/W_HRT2325/'+ep;const st={url};HS.forEach(h=>h({},{},st));const r=await fetch(url,{method:'POST',body:JSON.stringify(body||{})});const t=await r.text();H.forEach(h=>h({}, {status:r.status,responseText:t}, st));try{return {status:r.status,j:JSON.parse(t)};}catch(e){return {status:r.status,j:null};}}
const enc=(o)=>btoa(unescape(encodeURIComponent(JSON.stringify(o))));
let pop=[];const grid={dataSource:{view(){return pop;}}};
document.querySelector('a[menu-app-id="HRT/W_HRT2325"]').addEventListener('click',(e)=>{e.preventDefault();setTimeout(render,300);});
function btns(){document.getElementById('hrt2325_btn_notice').disabled=status!=='EDIT';document.getElementById('hrt2325_btn_confirm').disabled=status!=='NOTICE';document.getElementById('hrt2325_btn_init').disabled=!(wk>=47);}
async function search(){const r=await ajax('getMasterList_prc',{workType:'MASTER',dept,wk});const a=JSON.parse(decParam(r.j.data.infoEnc));status=a.length?a[0].schedule_status:'';btns();document.getElementById('hrt2325_master_list_html').innerHTML='<table><tbody><tr><td>직원 (휴대폰 칸)</td></tr></tbody></table>';const mr=await ajax('getMasterList_prc',{workType:'MAINROWS',dept,wk});const rows=JSON.parse(decParam(mr.j.data.infoEnc));document.getElementById('hrt2325_master_list_html').__k={kendoGrid:{dataSource:{data(){return rows.map(x=>({emp_code:x.emp_code,emp_name:x.emp_name,title:'직책 (휴대폰)'}));},view(){return this.data();}}}};}
let dirty=false,curDow='MON';
async function loadDay(dow){const r=await ajax('getMasterList_prc',{workType:'DETAIL',dept,wk,dow});await new Promise(r=>setTimeout(r,250));pop=JSON.parse(decParam(r.j.data.infoEnc)).map(x=>Object.assign(x,{workType:''}));dirty=false;curDow=dow;}
// openMdl 흉내: 요일 라디오를 새로 만들고 MON을 눌러 로딩. 로딩 전까지는 지난 표(workType 'U')가 남아 있음
function openMdl(){pop=pop.map(x=>Object.assign({},x,{workType:'U'}));const t=document.getElementById('tabs');t.innerHTML=DOWS.map(v=>'<input type="radio" name="hrt2325_pop_title" id="hrt2325_pop_title_'+v+'" value="'+v+'"><label for="hrt2325_pop_title_'+v+'">'+v+'</label>').join('');
 t.querySelectorAll('input').forEach(r=>r.addEventListener('click',(e)=>{if(r.value===curDow&&r.checked&&!dirty)return;if(dirty&&!confirm('수정중인 데이터가 존재합니다. 초기화하고 다른 일자로 변경 하시겠습니까?')){e.preventDefault();return;}window.__switch=(window.__switch||0)+1;setTimeout(()=>loadDay(r.value),50);}));
 setTimeout(()=>document.querySelector('label[for=hrt2325_pop_title_MON]').click(),150);}
function render(){document.getElementById('app').innerHTML=\`
 <input type="hidden" id="hrt2325_search_site_code" value="5090"><input type="hidden" id="hrt2325_dept_category" value="\${dept}">
 <input type="hidden" id="hrt2325_yyyy" value="2026"><input type="hidden" id="hrt2325_year_week_seq" value="\${wk}">
 <label><input type="checkbox" id="hrt2325_search_leave_yn" checked>휴직자 미포함</label>
 <span class="dd"><button type="button" id="ddb">\${dept}</button><ul id="ddl" style="display:none"><li>BOH</li><li>FOH</li></ul></span>
 <button onclick="hrt2325.moveWeek('prev')">‹</button><span id="wk">\${wk}주(\${W[wk][0]}~\${W[wk][1]})</span><button onclick="hrt2325.moveWeek('next')">›</button>
 <button id="hrt2325_btn_search">검색</button><button id="hrt2325_btn_pop">일자별 수정</button><button id="hrt2325_btn_save" disabled>저장</button>
 <button id="hrt2325_btn_notice" disabled>공지</button><button id="hrt2325_btn_confirm" disabled>확정</button><button id="hrt2325_btn_init" disabled>초기화</button><button id="hrt2325_btn_copy">전주복사</button>
 <div class="k-grid" id="hrt2325_master_list_html"></div>
 <div id="hrt2325_pop_sub" style="display:none"><div id="tabs"></div>
   <form id="hrt2325_day_frm_file_upload"><input type="file" id="hrt2325_day_excel_file" style="display:none"></form>
   <div id="hrt2325_pop_list_html" class="k-grid"></div><button id="hrt2325_pop_btn_save">저장</button><button class="btn-close">닫기</button></div>\`;
 document.getElementById('hrt2325_pop_list_html').__k={kendoGrid:grid};const MD=mkModal(document.getElementById('hrt2325_pop_sub'));window.__saves=0;
 document.getElementById('ddb').onclick=()=>{document.getElementById('ddl').style.display='block';};
 document.querySelectorAll('#ddl li').forEach(li=>li.onclick=()=>{dept=li.textContent;document.getElementById('hrt2325_dept_category').value=dept;document.getElementById('ddb').textContent=dept;document.getElementById('ddl').style.display='none';});
 document.getElementById('hrt2325_btn_search').onclick=search;
 document.getElementById('hrt2325_btn_pop').onclick=()=>{if(document.querySelectorAll('.modal-backdrop').length){window.__dblBackdrop=1;}MD.show();curDow='';openMdl();};
 document.querySelector('#hrt2325_pop_sub .btn-close').onclick=()=>MD.hide();
 document.getElementById('hrt2325_day_excel_file').addEventListener('change',async(e)=>{const f=e.target.files[0];const raw=new Uint8Array(await f.arrayBuffer());const r=await ajax('uploadDayExcelFile_prc',{name:f.name,ss:/sharedStrings/.test(new TextDecoder().decode(raw))});if(r.status!==200){doClientMsg({message:'Internal Server Error'});return;}
   const rows=parseXlsx(raw).slice(1);const dow=document.querySelector('input[name=hrt2325_pop_title]:checked').value;
   pop=rows.map(x=>{const [,no,nm,kind,i,o,b]=x;const row={emp_code:no,emp_name:nm,chk_message:''};const mine=REG[dept]||{},other=Object.keys(REG).filter(d=>d!==dept).some(d=>REG[d][no]);
     if(!mine[no]&&other)row.chk_message='소속구분이 다름';else if(mine[no]!==nm)row.chk_message='사번, 이름 오류.';else if(!KIND[kind])row.chk_message='예외 근태유형';else if(kind==='출근'&&!(i&&o&&b))row.chk_message='출근인경우 출/퇴, 휴게 시간 필수 입력';
     row[dow+'_time_item_code_p']=KIND[kind]||null;row[dow+'_work_on_p_hhmm']=i;row[dow+'_work_off_p_hhmm']=o;row[dow+'_break_time_p_hhmm']=b;return row;});
   window.__fname=f.name;window.__rows=rows;dirty=true;doClientMsg('엑셀 데이터가 화면에 반영되었습니다.');});
 document.getElementById('hrt2325_pop_btn_save').onclick=async()=>{const dow=document.querySelector('input[name=hrt2325_pop_title]:checked').value;const bad=pop.find(r=>r.chk_message);if(bad){doClientMsg(bad.emp_name+'('+bad.emp_code+')님의 스케줄 등록/수정이 불가합니다('+bad.chk_message+')');return;}
   await ajax('saveData_prc',{dow,dept,wk,file:window.__fname,rows:window.__rows});dirty=false;window.__saves++;doClientMsg('저장되었습니다.');MD.hide();setTimeout(search,200);};
 document.getElementById('hrt2325_btn_notice').onclick=async()=>{if(!confirm('공지 하시겠습니까?'))return;await ajax('statusChangeData_prc',{to:'NOTICE',wk});await search();doClientMsg('공지 되었습니다.');};
 document.getElementById('hrt2325_btn_confirm').onclick=async()=>{if(!confirm('확정 하시겠습니까?'))return;await ajax('statusChangeData_prc',{to:'CONFIRM',wk});await search();doClientMsg('확정 되었습니다.');};
 document.getElementById('hrt2325_btn_init').onclick=async()=>{if(!confirm('기존에 등록된 자료가 있다면 삭제 후 초기화가 진행됩니다.'))return;await ajax('init_prc',{wk});await search();doClientMsg('초기화 되었습니다.');};
 document.getElementById('hrt2325_btn_copy').onclick=()=>ajax('copy_prc',{});
}
let REG={};fetch('/__reg').then(r=>r.json()).then(o=>REG=o);
window.hrt2325={moveWeek(d){wk+=d==='next'?1:-1;document.getElementById('wk').textContent=wk+'주('+W[wk][0]+'~'+W[wk][1]+')';document.getElementById('hrt2325_year_week_seq').value=wk;},getMasterList(){},saveData(){},validateConfirm(){},statusChangeData(){},openMdl(){}};
function parseXlsx(u8){const files={};let p=0;const dv=new DataView(u8.buffer);while(p+30<u8.length&&dv.getUint32(p,true)===0x04034b50){const cs=dv.getUint32(p+18,true),nl=dv.getUint16(p+26,true),xl=dv.getUint16(p+28,true);const name=new TextDecoder().decode(u8.subarray(p+30,p+30+nl));files[name]=new TextDecoder().decode(u8.subarray(p+30+nl+xl,p+30+nl+xl+cs));p+=30+nl+xl+cs;}
 const ss=[...files['xl/sharedStrings.xml'].matchAll(/<t[^>]*>([\\s\\S]*?)<\\/t>/g)].map(m=>m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));const rows=[];
 for(const m of files['xl/worksheets/sheet1.xml'].matchAll(/<c r="([A-Z]+)(\\d+)"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)/g)){const r=+m[2]-1,c=m[1].charCodeAt(0)-65;rows[r]=rows[r]||['','','','','','',''];const v=/<v>(\\d+)<\\/v>/.exec(m[4]||'');rows[r][c]=v&&/t="s"/.test(m[3])?ss[+v[1]]:'';}
 return rows;}
</script></body>`;
const boardPage = `<!doctype html><meta charset="utf-8"><title>HR Board</title><body>board<script>window.__msgs=[];addEventListener('message',e=>{if(e.source===window&&/^MFG_HR_(AGENT_READY|SEND_ACK|SEND_PROGRESS|SEND_RESULT)/.test((e.data||{}).type))window.__msgs.push(e.data);});window.send=(o)=>window.postMessage(Object.assign({type:'MFG_HR_SEND'},o),location.origin);</script></body>`;
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
      if (ep === "getMasterList_prc" && b.workType === "MAINROWS") return json({ returnCode: 0, data: { infoEnc: enc(S.emptyWeek ? [] : regRows()) } });
      if (ep === "getMasterList_prc") { await new Promise((r) => setTimeout(r, S.detailMs || 300)); const rows = S.emptyDays || S.emptyWeek ? [] : regRows(); return json({ returnCode: 0, data: { p_error_code: rows.length ? "MSG0001" : "MSG0006", p_row_count: rows.length, infoEnc: enc(rows) } }); }
      if (ep === "uploadDayExcelFile_prc") { S.uploads++; if (S.uploadHttp !== 200 || !b.ss) { rs.writeHead(500); return rs.end("Internal Server Error"); } return json({ returnCode: 0 }); }
      if (ep === "saveData_prc") { S.saves.push(b); return json({ returnCode: 0 }); }
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
  for (const p of ctx.pages()) if (/hr\.pljec/.test(p.url())) await p.close().catch(() => {}); // 지난 HR 탭은 닫고 새로
  if (!board || board.isClosed()) { board = await ctx.newPage(); await board.goto("https://hr-board-teal.vercel.app/"); }
  else await board.reload();
  await board.waitForFunction(() => window.__msgs.some((m) => m.type === "MFG_HR_AGENT_READY"), null, { timeout: 15000 });
  const r = reqOf(o);
  await board.evaluate((r) => window.send(r), r);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await board.evaluate((id) => window.__msgs.filter((x) => x.requestId === id), r.requestId).catch(() => []);
    const res = m.find((x) => x.type === "MFG_HR_SEND_RESULT");
    if (res) { if (V) console.log("   결과:", JSON.stringify({ ...res, log: undefined }).slice(0, 400), "\n   기록:", res.log.map((l) => `${l.stage}${l.day ? "/" + l.day : ""} ${l.msg}`).join(" | ").slice(0, 700)); return { req: r, res, msgs: m }; }
    await sleep(500);
  }
  if (V) console.log('   보드 메시지:', JSON.stringify(await board.evaluate(() => window.__msgs).catch((e) => String(e))).slice(0, 600), '\n   확장:', JSON.stringify(await sw(() => chrome.storage.local.get(['hrSend', 'logs']))).slice(0, 800));
  return { req: r, res: null, msgs: [] };
}

if (process.env.HRS_ONLY) { reset(); const y = await send({ mode: 'test' }); console.log(JSON.stringify(y.res).slice(0, 900)); process.exit(0); }
const brief = (x) => JSON.stringify(x.res && { ...x.res, log: x.res.log.map((l) => `${l.stage}${l.day ? "/" + l.day : ""} ${l.msg}`) });
const all3 = () => [emp("90000001", "시험일"), emp("90000002", "시험이"), emp("90000003", "시험삼")];
// 1) 시험 모드: 월요일 1일 → 탭 로딩·업로드·검증·팝업 저장, 공지·확정 안 함. 부서 FOH→BOH, 주차 46→48
reset();
let x = await send({ mode: "test", employees: all3() });
ok(x.res && x.res.ok && x.res.test && x.res.stage === "save" && x.res.savedDays.join() === "MON" && !x.res.noticed && !x.res.confirmed, "test: 월요일 업로드·검증·팝업 저장까지 ok, savedDays MON", brief(x));
ok(S.saves.length === 1 && S.saves[0].dow === "MON" && S.saves[0].dept === "BOH" && S.saves[0].wk === 48 && S.notice === 0 && S.confirm === 0, `test: HR 저장 1번(MON·BOH·48주), 공지·확정 0번 (저장 ${S.saves.length})`, JSON.stringify(S.saves.map((s) => [s.dow, s.dept, s.wk])));
ok(S.saves[0] && JSON.stringify(S.saves[0].rows[0]) === JSON.stringify(["", "90000001", "시험일", "출근", "09:00", "18:00", "01:00"]) && S.saves[0].file === "BOH_2026-11-23_MON.xlsx", "올린 엑셀(sharedStrings): 첫 줄·파일 이름이 양식대로", JSON.stringify(S.saves[0] && S.saves[0].rows.slice(0, 2)));
ok(x.msgs.some((m) => m.type === "MFG_HR_SEND_ACK" && m.ok) && x.msgs.filter((m) => m.type === "MFG_HR_SEND_PROGRESS").length >= 2 && x.res.log.some((l) => /saveData_prc 200/.test(l.ajax || "")), "보드가 ACK·단계 알림을 받음 · 기록에 엔드포인트 상태", brief(x));
// 2) saveOnly: 상태 없는 주라도 7일 저장, 공지·확정 안 함
reset({ status: {} });
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && x.res.ok && x.res.savedDays.length === 7 && S.saves.map((q) => q.dow).join() === "MON,TUE,WED,THU,FRI,SAT,SUN" && S.notice === 0 && !x.res.confirmed && x.res.savedEmpNos.length === 3, "saveOnly: 상태 없어도 7일 저장(팝업 다시 열 때마다 MON 첫 로딩 뒤 요일 label), 공지·확정 안 함", brief(x));
// 3) full: EDIT → 7일 저장 → 공지 → 확정
reset();
x = await send({ employees: all3() });
ok(x.res && x.res.ok && x.res.noticed && x.res.confirmed && x.res.stage === "confirm" && x.res.savedDays.join() === "MON,TUE,WED,THU,FRI,SAT,SUN", "full: 저장·공지·확정 ok", brief(x));
ok(S.saves.map((s) => s.dow).join() === "MON,TUE,WED,THU,FRI,SAT,SUN" && S.notice === 1 && S.confirm === 1 && !S.init && !S.copy, `full: 요일 7번 저장(월~일) + 공지 1 + 확정 1, 초기화·전주복사 안 누름`);
ok(S.saves[2] && JSON.stringify(S.saves[2].rows[0].slice(3)) === JSON.stringify(["주휴일", "", "", ""]), "수요일 주휴일은 시간 \"\"");
// 4) full인데 상태 없는 주 → 업로드 전에 멈춤
reset({ status: {} });
x = await send({ employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "nostatus" && x.res.stage === "week" && S.uploads === 0 && S.saves.length === 0, "full + 상태 없음 → 업로드 전에 멈춤(nostatus)", brief(x));
// 5) full + allowInit → 업로드 전에 초기화 → 끝까지
reset({ status: {} });
x = await send({ employees: all3(), allowInit: true });
ok(x.res && x.res.ok && x.res.confirmed && S.init === 1 && S.saves.length === 7, "full + allowInit: 초기화 1번 뒤 저장·공지·확정", brief(x));
// 6) 확정된 주 / 공지된 주 → 손대지 않음
reset({ status: { 48: "CONFIRM" } }); x = await send({ employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "confirmed" && S.uploads === 0, "이미 확정된 주 → 멈춤", brief(x));
reset({ status: { 48: "NOTICE" } }); x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "noticed" && S.uploads === 0, "공지된 주 → 멈춤", brief(x));
// 7) 보내기 전 검사: 연차 → HR 안 건드림
reset();
x = await send({ mode: "test", employees: [emp("90000001", "시험일", ["출근", "연차", "주휴일", "출근", "출근", "출근", "휴무"]), emp("90000002", "시험이"), emp("90000003", "시험삼")] });
ok(x.res && !x.res.ok && x.res.stage === "precheck" && x.res.rowErrors[0].empNo === "90000001" && /연차/.test(x.res.rowErrors[0].msg) && S.uploads === 0, "근태유형 '연차' → precheck에서 멈춤", brief(x));
// 8) HR이 행에 오류를 다는 경우(업로드 문구는 똑같이 '반영됨') → 저장 안 함
reset();
x = await send({ mode: "test", employees: [emp("90000001", "시험일"), emp("90000002", "다른이름"), emp("90000003", "시험삼")] });
ok(x.res && !x.res.ok && x.res.stage === "upload" && x.res.rowErrors.some((e) => e.empNo === "90000002" && /사번, 이름 오류/.test(e.msg)) && S.saves.length === 0, "이름 불일치 → chk_message '사번, 이름 오류.' → 저장 안 함", brief(x));
reset();
x = await send({ mode: "test", employees: [...all3(), emp("90000009", "시험구")] });
ok(x.res && !x.res.ok && x.res.rowErrors.some((e) => e.empNo === "90000009" && /소속구분이 다름/.test(e.msg)) && S.saves.length === 0, "FOH 직원 섞임 → '소속구분이 다름' → 저장 안 함", brief(x));
reset();
x = await send({ mode: "test", employees: [emp("90000001", "시험일"), emp("90000002", "시험이")] });
ok(x.res && !x.res.ok && x.res.stage === "week" && (x.res.missing || []).join() === "90000003" && S.uploads === 0, "직원 1명 빠짐(메인 표엔 있음) → 업로드 전에 멈춤, 명단 회신", brief(x));
// 0행인 요일(아직 저장된 게 없음, MSG0006) → 그대로 업로드·검증·저장
reset({ emptyDays: true, status: {} });
x = await send({ mode: "saveOnly", employees: all3() });
ok(x.res && x.res.ok && S.saves.length === 7, "팝업이 0행인 요일(MSG0006)도 정상 로딩으로 보고 7일 저장", brief(x));
// 메인 표도 0행인 완전히 빈 주 → 빠진 직원 검사 건너뜀 (2명만 보내도 진행)
reset({ emptyWeek: true, status: {} });
x = await send({ mode: "test", employees: [emp("90000001", "시험일"), emp("90000002", "시험이")] });
ok(x.res && x.res.ok && S.saves.length === 1, "메인 표 0행(빈 주) → 빠진 직원 검사 건너뛰고 저장", brief(x));
ok(await (async () => { const p = ctx.pages().find((q) => /hr\.pljec/.test(q.url())); return p ? await p.evaluate(() => !window.__reported && getComputedStyle(document.getElementById("hrt2325_pop_sub")).display === "none") : false; })(), "오류 뒤 팝업 닫음 · '오류 신고'는 안 누름");
// 8b) 바로 앞 시도에서 없는 사번이 섞여 표에 남았어도(팝업은 닫힘), 다음 시도는 새로 로딩된 표로 판단 → 성공
reset();
await send({ mode: "test", employees: [...all3(), emp("90000009", "시험구")] }); // 일부러 실패(소속구분이 다름)
x = await send({ mode: "test", employees: all3() });
ok(x.res && x.res.ok && S.saves.length === 1, "앞 시도의 옛 행이 남아 있어도 첫 로딩(workType '') 뒤에 읽어 정상 저장", brief(x));
// 8c) 한 자리 시간 "9:00" → 사전 점검에서 "09:00"으로 바꿔 보냄
reset();
const t9 = all3(); t9[0].days[0] = { date: dates[0], kind: "출근", in: "9:00", out: "18:00", brk: "1:00" };
x = await send({ mode: "test", employees: t9 });
ok(x.res && x.res.ok && S.saves[0] && JSON.stringify(S.saves[0].rows[0].slice(3)) === JSON.stringify(["출근", "09:00", "18:00", "01:00"]), "\"9:00\"·\"1:00\" → 09:00·01:00으로 올림", brief(x));
x = await send({ mode: "test", employees: (() => { const e = all3(); e[0].days[0] = { date: dates[0], kind: "출근", in: "9시", out: "18:00", brk: "" }; return e; })() });
ok(x.res && !x.res.ok && x.res.stage === "precheck" && /시간 형식 오류/.test(x.res.message), "\"9시\" → 사전 점검에서 '시간 형식 오류'", brief(x));
// 8d) 팝업이 닫힐 때 backdrop이 남는 경우 → 정리하고 다음 요일 계속, 끝나면 화면에 덮개 없음
reset({ stuck: true, status: {} });
x = await send({ mode: "saveOnly", employees: all3() });
const clean8 = await (async () => { const p = ctx.pages().find((q) => /hr\.pljec/.test(q.url())); return p ? await p.evaluate(() => ({ bd: document.querySelectorAll(".modal-backdrop").length, mo: document.body.classList.contains("modal-open"), dbl: !!window.__dblBackdrop })) : null; })();
ok(x.res && x.res.ok && S.saves.length === 7 && clean8 && clean8.bd === 0 && !clean8.mo && !clean8.dbl, "남은 modal-backdrop 정리하고 7일 저장, 끝난 뒤 덮개·modal-open 없음", brief(x) + " " + JSON.stringify(clean8));
// 8e) 팝업 첫 로딩이 느림(3초) → 기다렸다가 진행
reset({ detailMs: 3000 });
x = await send({ mode: "test", employees: all3() });
ok(x.res && x.res.ok && S.saves.length === 1, "첫 로딩 3초 걸려도 기다려서 저장", brief(x));
// 9) 업로드 500 (inlineStr 등) → 그 자리에서 멈춤
reset({ uploadHttp: 500 });
x = await send({ mode: "test", employees: all3() });
ok(x.res && !x.res.ok && x.res.stage === "upload" && /500|Internal Server Error/.test(x.res.message) && S.saves.length === 0, "업로드 HTTP 500 → upload에서 멈춤", brief(x));
// 10) 로그인 풀림
reset({ login: false });
x = await send({ employees: all3() });
ok(x.res && !x.res.ok && x.res.code === "login" && S.uploads === 0, "HR 로그인 화면 → 바로 멈춤(login)", brief(x));
// 11) 같은 requestId 두 번 → 한 번만
reset();
const r1 = await send({ mode: "test", requestId: "same-1", employees: all3() }), saves1 = S.saves.length;
const r2 = await send({ mode: "test", requestId: "same-1", employees: all3() }, 20000);
ok(r1.res && r2.res && r2.res.ok && S.saves.length === saves1 && saves1 === 1, `같은 requestId 두 번 → 한 번만 실행 (저장 ${S.saves.length})`);
// 12) 진짜 서버로 안 나감 + 다른 칸은 안 건드림
const hosts = [...new Set(hits.map((h) => h.split("/")[0]))];
ok(hosts.every((h) => ["hr.pljec.cloud", "hr-board-teal.vercel.app", "script.google.com", "mfgkorea.github.io", "gw.madforgarlic.com", "mis.madforgarlic.com", "script.googleusercontent.com"].includes(h)), "요청은 모두 가짜 서버로 (" + hosts.join(", ") + ")");
const st = await sw(() => chrome.storage.local.get(["hrSend", "logs"]));
ok(st && st.hrSend && !st.hrSend.run && !(st.logs || []).some((l) => /시험일|시험이|시험삼|다른이름/.test(l)), "끝나면 잠금 풀림 · 확장 기록에 이름 없음", JSON.stringify(st && { run: st.hrSend && st.hrSend.run, logs: (st.logs || []).slice(0, 4) }));
await ctx.close(); srv.close();
console.log(fails ? `실패 ${fails}개 / ${n}` : `모두 통과 (${n}개)`); process.exit(fails ? 1 : 0);
