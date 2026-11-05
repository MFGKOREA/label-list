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

  g.TraceNos = { STEAKS: STEAKS, normTrace: normTrace, traceNos: traceNos, compareTrace: compareTrace, kindNear: kindNear, nextTraceShot: nextTraceShot, traceVerdict: traceVerdict };
})(typeof globalThis !== "undefined" ? globalThis : this);
