// follow.mjs 결과 다듬기 (11/17): 끝날 센 시각으로 "입고 전/뒤"를 정함(4~9시 또는 해동 품목 10시 전 = 입고 전, 모르면 엄하게). 사용: node follow-refine.cjs <kv.json> <follow.json> 10 "<해동 품목 키들(\u0001로 이음)>"
const fs=require('fs'); const [kv, fj]=process.argv.slice(2);
const R=JSON.parse(fs.readFileSync(kv)); const D=R.data||R; const P=(x)=>typeof x==='string'?JSON.parse(x):x;
const log=[...(P(D['onhand.archive'])||[]),...(P(D.onhand)||[])];
const last=new Map(); log.forEach(e=>{ if(!e||!e.t||!e.k) return; const k=e.k+'|'+e.t.slice(0,10); const p=last.get(k); if(!p||e.t>p) last.set(k,e.t); });
const rows=JSON.parse(fs.readFileSync(fj)); const MEAT_H=+process.argv[4];
const meatKeys=new Set(process.argv[5].split('\u0001'));
let n=0,bad=0,known=0, pre=0, list=[];
for(const r of rows){ const t=last.get(r.key+'|'+r.E); const h=t?+t.slice(11,13):null; let before;
  if(h==null) before=null; else before = (h>=4&&h<9) || (h<MEAT_H && meatKeys.has(r.key));
  const v = before===true ? r.loose : before===false ? r.strict : Math.min(r.loose,r.strict); // 모르면 엄하게
  if(h!=null) known++; if(before) pre++;
  n++; if(v< -1e-9){bad++; list.push({...r, v, h});} r.v=v; }
const pc=(a,b)=>(100*a/b).toFixed(1)+'%';
console.log('경우',n,'· 센 시각 앎',known,'(입고 전으로 봄',pre,') · 바닥',bad,'→ 안 바닥',pc(n-bad,n));
// 발주가 의미 있는 경우(앱이나 KM이 시킨 것)
const ord=rows.filter(r=>r.rec>0||r.act>0); console.log('시킨 경우',ord.length,'· 바닥',ord.filter(r=>r.v<-1e-9).length,'→',pc(ord.filter(r=>r.v>=-1e-9).length,ord.length));
// 남는 양 (일수)
const dc=rows.filter(r=>r.daily>0).map(r=>r.v/r.daily).sort((a,b)=>a-b); const q=(p)=>dc[Math.floor(p*(dc.length-1))];
console.log('끝날 남는 양(일치) 중앙',q(.5).toFixed(1),'· 25%',q(.25).toFixed(1),'· 75%',q(.75).toFixed(1));
// KM 실제와 비교: 앱이 적게 시킨 경우의 차이 합(재고 단위) — 금액 없음
const less=rows.filter(r=>r.rec<r.act), more=rows.filter(r=>r.rec>r.act);
console.log('앱이 적게',less.length,'· 많게',more.length,'· 같음',rows.length-less.length-more.length);
const vend={}; rows.forEach(r=>{const k=r.vendor||'?'; vend[k]=vend[k]||{n:0,b:0}; vend[k].n++; if(r.v<-1e-9) vend[k].b++;}); console.log('업체별',JSON.stringify(vend));
list.sort((a,b)=>a.v/Math.max(a.daily,1e-9)-b.v/Math.max(b.daily,1e-9)).forEach(r=>console.log(' ',r.d,r.name,'앱',+r.rec.toFixed(1),'실제',+r.act.toFixed(1),'→',r.E,'센시각',r.h,'앱대로',+r.v.toFixed(1),r.unit,'(하루',+r.daily.toFixed(1)+')'));
