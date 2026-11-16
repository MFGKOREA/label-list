// HR 주간스케쥴 전송 — 화면을 건드리지 않는 순수 부분 (GW Agent 1.12.0, 11/16 KM "MFG HR Board [HR 전송] → 플젝 HR 주간스케쥴(시간)")
//  확장(bg.js importScripts)과 시험(node)이 같은 코드를 씀
//  1) hrsCheck(req): 보드가 보낸 요청을 HR 규칙으로 검사·정리 (근태유형 4개, 시간 모양, 주휴일 주 1일, 주 52시간)
//  2) hrsFiles(plan): 요일별 엑셀(.xlsx) 7개 — 팝업 "엑셀양식 다운로드" 양식과 같은 칸
//  3) hrsXlsx(rows): 아주 작은 xlsx 만들기 (압축 없는 zip, 모든 칸 텍스트 서식 '@') — SheetJS 없이
//  개인정보: 사번·이름·시간만 다룸. 이 파일은 저장·기록을 하지 않음(메모리에서 파일만 만듦)
(function (G) {
  const KINDS = ["출근", "휴무", "주휴일", "공휴일"];
  const DOWS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const addDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || "")) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(Date.parse(s + "T00:00:00Z")).toISOString().slice(0, 10) === s;
  // "9:00"·"09:00"·"0900" → "09:00", 빈칸 → "", 틀리면 null
  function hhmm(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return String(h).padStart(2, "0") + ":" + m[2];
  }
  const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  // 근무 분: 퇴근이 출근보다 이르면 다음 날 퇴근
  function workMin(d) { if (!d.in || !d.out) return 0; let w = mins(d.out) - mins(d.in); if (w <= 0) w += 1440; return Math.max(0, w - (d.brk ? mins(d.brk) : 0)); }

  // 요청 검사 → { ok, errors:[{empNo?, name?, msg}], warns:[], plan:{dept, weekStart, weekEnd, mode, emps:[{empNo,name,days:[{date,dow,kind,in,out,brk}]}]} }
  function hrsCheck(req) {
    const errors = [], warns = [], r = req || {};
    const dept = String(r.dept || "").trim().toUpperCase();
    if (!/^(BOH|FOH)$/.test(dept)) errors.push({ msg: `부서(dept)는 BOH 또는 FOH여야 해요 (받은 값: ${r.dept})` });
    const ws = String(r.weekStart || "");
    if (!isDate(ws)) errors.push({ msg: `주 시작일(weekStart)이 날짜가 아니에요: ${r.weekStart}` });
    else if (new Date(Date.parse(ws + "T00:00:00Z")).getUTCDay() !== 1) errors.push({ msg: `주 시작일 ${ws}이 월요일이 아니에요` });
    const we = isDate(ws) ? addDay(ws, 6) : "";
    if (r.weekEnd && we && r.weekEnd !== we) errors.push({ msg: `주 끝날(weekEnd) ${r.weekEnd}이 ${we}(일)와 달라요` });
    const mode = r.mode === "test" || r.mode === "saveOnly" ? r.mode : "full";
    if (r.mode && !/^(test|saveOnly|full)$/.test(r.mode)) errors.push({ msg: `mode는 full·saveOnly·test 중 하나여야 해요 (받은 값: ${r.mode})` });
    const soft = mode === "test"; // test는 주휴일·52시간 위반을 경고만 (11/16 KM)
    const list = Array.isArray(r.employees) ? r.employees : [];
    if (!list.length) errors.push({ msg: "보낼 직원이 없어요 (employees 빈 목록)" });
    if (list.length > 300) errors.push({ msg: `직원이 너무 많아요 (${list.length}명)` });
    const seen = new Set(), emps = [];
    for (const e of list) {
      const empNo = String((e && e.empNo) == null ? "" : e.empNo).trim(), name = String((e && e.name) || "").trim().slice(0, 30);
      const bad = (msg) => errors.push({ empNo, name, msg });
      if (!/^\d{4,12}$/.test(empNo)) { bad(`사번이 숫자가 아니에요: "${empNo}"`); continue; }
      if (seen.has(empNo)) { bad("같은 사번이 두 번 있어요"); continue; }
      seen.add(empNo);
      if (!name) bad("이름이 비어 있어요");
      const days = Array.isArray(e.days) ? e.days : [], byDate = new Map();
      days.forEach((d) => { if (d && d.date) byDate.set(String(d.date), d); });
      if (!we) continue;
      if (days.length !== 7 || byDate.size !== 7) { bad(`하루씩 7일이 있어야 해요 (받은 날 ${byDate.size}일)`); continue; }
      const out = [];
      let ok = true;
      for (let i = 0; i < 7; i++) {
        const date = addDay(ws, i), d = byDate.get(date);
        if (!d) { bad(`${date} 날이 빠졌어요`); ok = false; break; }
        const kind = String(d.kind || "").trim();
        if (KINDS.indexOf(kind) < 0) { bad(`${date} 근태유형 "${kind || "(빈칸)"}"은 HR에 없어요 — 보드에서 출근·휴무·주휴일·공휴일 중 하나로 바꿔 보내 주세요`); ok = false; continue; }
        let tin = hhmm(d.in), tout = hhmm(d.out), brk = hhmm(d.brk);
        if (tin === null || tout === null || brk === null) { bad(`${date} 시간 형식 오류 (출근 ${d.in || "-"} · 퇴근 ${d.out || "-"} · 휴게 ${d.brk || "-"}, HH:MM)`); ok = false; continue; }
        if (kind === "출근") {
          if (!tin || !tout) { bad(`${date} 출근인데 출근·퇴근 시각이 비었어요`); ok = false; continue; }
          if (!brk) brk = "00:00"; // 휴게 없으면 00:00 (HR 필수 칸)
        } else if (kind === "휴무" || kind === "주휴일") {
          if (tin || tout || brk) warns.push({ empNo, name, msg: `${date} ${kind}이라 시간을 비워서 보냄` });
          tin = tout = brk = "";
        } else { // 공휴일: 셋 다 있거나 셋 다 빈칸
          const n = [tin, tout, brk].filter(Boolean).length;
          if (n === 2 && tin && tout) brk = "00:00";
          else if (n !== 0 && n !== 3) { bad(`${date} 공휴일 시간은 출근·퇴근·휴게가 다 있거나 다 비어야 해요`); ok = false; continue; }
        }
        out.push({ date, dow: DOWS[i], kind, in: tin, out: tout, brk });
      }
      if (!ok) continue;
      const wk = out.filter((d) => d.kind === "주휴일").length;
      const total = out.reduce((t, d) => t + workMin(d), 0);
      const rule = [];
      if (wk !== 1) rule.push(`주휴일이 주에 정확히 1일이어야 해요 (지금 ${wk}일)`);
      if (total > 52 * 60) rule.push(`주 근무가 52시간을 넘어요 (${Math.floor(total / 60)}시간 ${total % 60}분)`);
      if (rule.length && !soft) { rule.forEach(bad); continue; }
      rule.forEach((m) => warns.push({ empNo, name, msg: m + " (시험이라 경고만)" }));
      emps.push({ empNo, name, days: out, min: total });
    }
    const weekEnd = we;
    return { ok: !errors.length, errors, warns, plan: { dept, weekStart: ws, weekEnd, mode, emps, allowInit: r.allowInit === true } };
  }

  // ---- 아주 작은 xlsx (압축 없는 zip) ----
  const enc = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let CRC = null;
  function crc32(b) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) { // files: [[이름, Uint8Array]] → Uint8Array (STORE)
    const parts = [], cen = []; let off = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    const DT = [0x00, 0x00, 0x21, 0x00]; // 1980-01-01 00:00
    for (const [name, data] of files) {
      const nb = enc(name), crc = crc32(data);
      const head = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...DT, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
      parts.push(head, nb, data);
      cen.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...DT, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += head.length + nb.length + data.length;
    }
    const cl = cen.reduce((t, p) => t + p.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cl), ...u32(off), ...u16(0)]);
    const all = [...parts, ...cen, end], out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  const colName = (i) => String.fromCharCode(65 + i);
  // rows: 2차원 문자열 배열(첫 줄 머리글). 모든 칸은 공유 문자열(t="s") + 텍스트 서식(@), 빈칸도 "" 공유 문자열
  //  (11/16 KM 실제 확인: inlineStr·빈 칸 생략(openpyxl 기본)은 HR 서버가 500으로 거부, 양식 다운로드 파일처럼 sharedStrings면 됨)
  function hrsXlsx(rows, sheet) {
    const ss = [], idx = new Map(), si = (v) => { if (!idx.has(v)) { idx.set(v, ss.length); ss.push(v); } return idx.get(v); };
    const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" s="1" t="s"><v>${si(v == null ? "" : String(v))}</v></c>`).join("") + "</row>").join("");
    const W = (s) => enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);
    const nm = esc(sheet || "Sheet1"), last = colName(Math.max(1, rows[0] ? rows[0].length : 1) - 1) + Math.max(1, rows.length);
    return zip([
      ["[Content_Types].xml", W('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')],
      ["_rels/.rels", W('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')],
      ["xl/workbook.xml", W(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nm}" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
      ["xl/_rels/workbook.xml.rels", W('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')],
      ["xl/worksheets/sheet1.xml", W(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetData>${body}</sheetData></worksheet>`)],
      ["xl/styles.xml", W('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')],
      ["xl/sharedStrings.xml", W(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ss.length}" uniqueCount="${ss.length}">${ss.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`)],
    ]);
  }
  const HEAD = ["..", "사원코드", "이름", "근태유형", "출근시각", "퇴근시각", "휴게시간"];
  // 요일별 파일: [{ dow, date, name, bytes, empNos }] (test 모드는 월요일 하나)
  function hrsFiles(plan) {
    const n = plan.mode === "test" ? 1 : 7, out = []; // saveOnly·full은 7일
    for (let i = 0; i < n; i++) {
      const rows = [HEAD].concat(plan.emps.map((e) => { const d = e.days[i]; return ["", e.empNo, e.name, d.kind, d.in, d.out, d.brk]; }));
      out.push({ dow: DOWS[i], date: plan.emps[0].days[i].date, name: `${plan.dept}_${plan.emps[0].days[i].date}_${DOWS[i]}.xlsx`, bytes: hrsXlsx(rows), empNos: plan.emps.map((e) => e.empNo), rows: plan.emps.map((e) => ({ empNo: e.empNo, name: e.name, kind: e.days[i].kind, in: e.days[i].in, out: e.days[i].out, brk: e.days[i].brk })) });
    }
    return out;
  }
  G.hrsCheck = hrsCheck; G.hrsFiles = hrsFiles; G.hrsXlsx = hrsXlsx; G.hrsHHMM = hhmm; G.HRS_DOWS = DOWS;
})(typeof self !== "undefined" ? self : globalThis);
