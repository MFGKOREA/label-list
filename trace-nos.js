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

  // 띄어쓴 한 줄에 번호가 두 개면 나눈다. 아직 12자리가 안 됐거나, 이어 붙여도 한 번호면 붙인다.
  function splitChunks(raw) {
    const bits = String(raw || "").trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    let cur = "";
    bits.forEach((b) => {
      if (!cur) { cur = b; return; }
      const joined = cur + " " + b;
      if (!normTrace(cur) || normTrace(joined)) cur = joined;
      else { chunks.push(cur); cur = b; }
    });
    if (cur) chunks.push(cur);
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
    const token = /[A-Za-z|]?[\d\s\-]{11,48}/g;
    lines.forEach((line, i) => {
      token.lastIndex = 0;
      let m, first = true;
      while ((m = token.exec(line))) {
        splitChunks(m[0]).forEach((chunk) => {
          const no = normTrace(chunk);
          if (!no || out.some((o) => o.no === no)) return;
          const at = line.indexOf(chunk.trim().split(/\s+/)[0], m.index);
          const before = line.slice(Math.max(0, (at >= 0 ? at : m.index) - 24), at >= 0 ? at : m.index);
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

  g.TraceNos = { STEAKS: STEAKS, normTrace: normTrace, traceNos: traceNos, compareTrace: compareTrace, kindNear: kindNear, nextTraceShot: nextTraceShot, traceVerdict: traceVerdict };
})(typeof globalThis !== "undefined" ? globalThis : this);
