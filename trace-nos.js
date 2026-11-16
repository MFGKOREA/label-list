// 축산물 이력번호 뽑기. index.html 과 테스트가 같이 씀.
// 국내 12자리, 수입 묶음번호(영문 1자 + 숫자 12~16, 흔히 L).
(function (g) {
  const STEAKS = ["등심", "채끝"];

  function normTrace(raw) {
    let s = String(raw || "").toUpperCase().replace(/[|]/g, "I");
    s = s.replace(/[^A-Z0-9]/g, "");
    if (/^I\d{12,16}$/.test(s)) s = "L" + s.slice(1); // 묶음번호 L 을 I 로 읽는 경우
    if (/^\d{12}$/.test(s)) return looksLikeDatePrefix(s) ? "" : s;
    if (/^[A-Z]\d{12,16}$/.test(s)) return s;
    return "";
  }

  function looksLikeDatePrefix(digits) {
    const y = +digits.slice(0, 4), mo = +digits.slice(4, 6), d = +digits.slice(6, 8);
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }

  // 띄어쓴 숫자 묶음에서 이력번호만 골라낸다. 앞에서부터 이어 붙여 보며 가장 긴 올바른 번호를 잡고,
  // 맞는 번호가 없으면 그 묶음은 버리고 다음 묶음부터 다시 본다.
  // 예) 명세서 한 줄 "발주 10 801001506378" → 수량 10 은 버리고 801001506378 만.
  function splitChunks(raw) {
    const bits = String(raw || "").trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < bits.length; ) {
      let acc = "", hit = -1;
      for (let j = i; j < bits.length; j++) {
        acc = acc ? acc + " " + bits[j] : bits[j];
        if (normTrace(acc)) hit = j;
        else if (acc.replace(/[^0-9]/g, "").length > 16) break;
      }
      if (hit < 0) { i++; continue; }
      chunks.push(bits.slice(i, hit + 1).join(" "));
      i = hit + 1;
    }
    return chunks;
  }

  // 번호 바로 앞(또는 바로 뒤)에 적힌 부위. 채끝등심처럼 두 부위가 붙어 있으면 비움.
  function kindNear(segment, kinds) {
    const t = String(segment || "").replace(/\s/g, "");
    if (!t) return null;
    if (t.includes("등심") && t.includes("채끝") && Math.abs(t.lastIndexOf("등심") - t.lastIndexOf("채끝")) <= 2) return { ambiguous: true };
    const hits = [];
    kinds.forEach((k) => { const at = t.lastIndexOf(k); if (at >= 0) hits.push({ k: k, at: at }); });
    if (!hits.length) return null;
    hits.sort((a, b) => b.at - a.at || b.k.length - a.k.length);
    return { kind: hits[0].k };
  }

  function traceNos(text, kinds) {
    const list = kinds && kinds.length ? kinds : STEAKS;
    // 구분자 있는 날짜, 또는 홀로 있는 8자리 날짜만 지운다. 긴 이력번호 중간의 2004 같은 숫자는 건드리지 않는다.
    const src = String(text || "")
      .replace(/20\d{2}\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2}\s*[일]?/g, " ")
      .replace(/\b20\d{2}[01]\d[0-3]\d\b/g, " ");
    const lines = src.split(/\n+/);
    const out = [];
    const token = /(?<![A-Za-z0-9])[A-Za-z|]?[\d\s\-]{11,48}/g; // 영문은 앞에 글자·숫자가 안 붙었을 때만 (270g 의 g 제외)
    lines.forEach((line, i) => {
      token.lastIndex = 0;
      let m, first = true;
      while ((m = token.exec(line))) {
        splitChunks(m[0]).forEach((chunk) => {
          const no = normTrace(chunk);
          if (!no || out.some((o) => o.no === no)) return;
          const at = line.indexOf(chunk.trim().split(/\s+/)[0], m.index);
          const before = line.slice(Math.max(0, (at >= 0 ? at : m.index) - 40), at >= 0 ? at : m.index);
          const after = line.slice((at >= 0 ? at : m.index) + chunk.trim().length, (at >= 0 ? at : m.index) + chunk.trim().length + 12);
          let near = kindNear(before, list) || kindNear(after, list);
          if ((!near || (!near.kind && !near.ambiguous)) && first) {
            near = kindNear(lines[i - 1] || "", list) || kindNear(lines[i + 1] || "", list);
          }
          const kind = near && near.kind && !near.ambiguous ? near.kind : "";
          out.push({ no: no, kind: kind });
          first = false;
        });
      }
    });
    // 표를 칸 단위로 읽어 품목과 번호가 다른 줄로 떨어진 명세서: 번호 없는 줄에 적힌 부위를 순서대로 짝짓는다.
    if (out.length && out.every((o) => !o.kind)) {
      const seq = [];
      lines.forEach((line) => {
        token.lastIndex = 0;
        if (token.test(line) && splitChunks(line.match(token)[0]).some((c) => normTrace(c))) return;
        const k = kindNear(line, list);
        if (k && k.kind) seq.push(k.kind);
      });
      if (seq.length === out.length) out.forEach((o, i) => { o.kind = seq[i]; });
    }
    return out;
  }

  // 명세서 번호와 박스 번호. 둘 다 있고 같으면 ok, 한쪽만·다르면 bad, 둘 다 없으면 empty.
  function compareTrace(docNo, boxNo) {
    const a = normTrace(docNo), b = normTrace(boxNo);
    if (!a && !b) return "empty";
    if (!a || !b || a !== b) return "bad";
    return "ok";
  }

  // 한 번 누르면 명세서 → 등심 박스 → 채끝 박스 순으로 카메라를 잇는다.
  function nextTraceShot(kind) {
    if (kind === "doc") return "등심";
    if (kind === "등심") return "채끝";
    return "";
  }

  // 두 부위 모두 명세서·박스 번호가 있을 때만 판정. 같으면 자동 저장, 다르면 저장 한 번.
  function traceVerdict(cuts) {
    if (!cuts || !cuts["등심"] || !cuts["채끝"]) return "wait";
    let mismatch = false;
    for (let i = 0; i < STEAKS.length; i++) {
      const c = cuts[STEAKS[i]];
      const a = normTrace(c && c.docNo), b = normTrace(c && c.boxNo);
      if (!a || !b) return "wait";
      if (a !== b) mismatch = true;
    }
    return mismatch ? "fix" : "save";
  }

  // ---- GS1-128 바코드 (축산물·식자재 포장의 (01) GTIN / (10) 로트 / (17) 유통기한) ----
  // 포장 바코드를 읽었거나 라벨 글자에 AI 표기가 찍혀 있을 때 쓴다. 없는 값은 빈 문자열로 두고, 읽은 AI 는 순서대로 남긴다.
  const GS1_FNC1 = "\u001d";
  const GS1_AI = {
    "00": { name: "sscc", len: 18 },
    "01": { name: "gtin", len: 14, key: "gtin" },
    "02": { name: "content", len: 14 },
    "10": { name: "lot", var: true, max: 20, key: "lot" },
    "11": { name: "prodDate", len: 6, date: true },
    "13": { name: "packDate", len: 6, date: true },
    "15": { name: "bestBefore", len: 6, date: true },
    "17": { name: "expiry", len: 6, date: true, key: "expiry" },
    "20": { name: "variant", len: 2 },
    "21": { name: "serial", var: true, max: 20, key: "serial" },
    "30": { name: "count", var: true, max: 8 },
    "37": { name: "countUnit", var: true, max: 8 },
    "7003": { name: "processDate", len: 10, date: true },
  };

  const gs1Pad = (n) => String(n).padStart(2, "0");
  // YYMMDD → YYYY-MM-DD. 두 자리 연도는 79 이하를 2000년대로 (26→2026, 99→1999).
  function gs1Date(value) {
    const dg = String(value || "").replace(/\D/g, "");
    if (dg.length < 6) return "";
    let y = +dg.slice(0, 2), mo = +dg.slice(2, 4), d = +dg.slice(4, 6);
    y += y <= 79 ? 2000 : 1900;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
    return y + "-" + gs1Pad(mo) + "-" + gs1Pad(d);
  }

  // GTIN-14 검증숫자 (오독이면 false — 버리지는 않고 표시만 한다)
  function gs1GtinValid(digits) {
    const g = String(digits || "");
    if (!/^\d{14}$/.test(g)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += +g[i] * (i % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +g[13];
  }

  function parseGs1Barcode(raw) {
    const res = { ok: false, gtin: "", gtinValid: false, lot: "", expiry: "", expiryRaw: "", serial: "", ais: [], warning: "" };
    let s = String(raw == null ? "" : raw).replace(/[\u001d\u001e]|<GS>|\[GS\]/gi, GS1_FNC1).trim();
    s = s.replace(/^\]C[0-9A-Za-z]/, "").trim(); // 바코드 리더가 붙이는 심볼로지 식별자(]C1 등)는 버린다
    if (!s) { res.warning = "빈 문자열"; return res; }

    const take = (ai, value) => {
      const spec = GS1_AI[ai];
      const v = String(value == null ? "" : value).replace(/\u001d/g, "").trim();
      if (!v) return;
      res.ais.push({ ai: ai, value: v });
      if (!spec) { res.warning = res.warning || ("모르는 AI (" + ai + ")"); return; }
      if (spec.key && !spec.date && !res[spec.key]) res[spec.key] = v;
      if (spec.key === "gtin") res.gtinValid = gs1GtinValid(v.replace(/\D/g, ""));
      if (spec.date && ai === "17") {
        const iso = gs1Date(v);
        res.expiryRaw = v.replace(/\D/g, "").slice(0, 6);
        if (iso) { if (!res.expiry) res.expiry = iso; }
        else res.warning = res.warning || ("(17) 날짜를 읽지 못함: " + v);
      }
    };

    // 괄호 표기: (01)08801234567890(17)261030(10)LOT1
    if (s.indexOf("(") >= 0) {
      const marks = [], re = /\((\d{2,4})\)/g;
      let m;
      while ((m = re.exec(s))) marks.push({ ai: m[1], at: m.index, from: re.lastIndex });
      marks.forEach((mk, i) => {
        let value = s.slice(mk.from, i + 1 < marks.length ? marks[i + 1].at : s.length);
        const spec = GS1_AI[mk.ai];
        if (spec && !spec.var) {
          // 사이에 낀 공백·줄바꿈은 버리고 정해진 길이만큼만 (뒤에 줄글이 붙어도 날짜는 앞 6자리)
          value = value.replace(/[^0-9A-Za-z]/g, "").slice(0, spec.len);
        } else {
          value = value.split(/[\n\r]/)[0];
        }
        take(mk.ai, value);
      });
    } else {
      // 무괄호 연속 문자열: FNC1(\u001d) 또는 정해진 길이로 끊는다. 01088012345678901726103010ABC
      let i = 0, guard = 0;
      while (i < s.length && guard++ < 64) {
        if (s[i] === GS1_FNC1 || /\s/.test(s[i])) { i++; continue; }
        const four = s.slice(i, i + 4), two = s.slice(i, i + 2);
        const ai = GS1_AI[four] ? four : GS1_AI[two] ? two : "";
        const spec = GS1_AI[ai];
        if (!spec) { res.warning = res.warning || ("AI를 찾지 못함: " + two); break; }
        const from = i + ai.length;
        let end;
        if (spec.var) {
          const gsAt = s.indexOf(GS1_FNC1, from);
          end = gsAt >= 0 ? Math.min(gsAt, from + spec.max) : Math.min(s.length, from + spec.max);
        } else {
          end = Math.min(s.length, from + spec.len);
        }
        take(ai, s.slice(from, end));
        i = end + (s[end] === GS1_FNC1 ? 1 : 0);
      }
    }
    res.ok = !!(res.gtin || res.lot || res.expiry || res.serial || res.ais.length);
    return res;
  }

  g.TraceNos = { STEAKS: STEAKS, normTrace: normTrace, traceNos: traceNos, compareTrace: compareTrace, kindNear: kindNear, nextTraceShot: nextTraceShot, traceVerdict: traceVerdict, parseGs1Barcode: parseGs1Barcode };
})(typeof globalThis !== "undefined" ? globalThis : this);
