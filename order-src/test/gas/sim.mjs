// Code.gs를 node에서 돌려 보는 가짜 Apps Script
import fs from "fs"; import vm from "vm";
export function load(path) {
  class Sheet { constructor(n) { this.n = n; this.rows = []; } getName() { return this.n; }
    getLastRow() { return this.rows.length; } getMaxRows() { return Math.max(1000, this.rows.length); } insertRowsAfter() {} setFrozenRows() {} setNumberFormat() {}
    appendRow(r) { this.rows.push(r.slice()); }
    deleteRow(i) { this.rows.splice(i - 1, 1); } deleteRows(i, n) { this.rows.splice(i - 1, n); }
    getRange(r, c, nr = 1, nc = 1) { const sh = this; return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] ?? ""); out.push(o); } return out; },
      setValues(v) { v.forEach((row, i) => { const R = sh.rows[r - 1 + i] || (sh.rows[r - 1 + i] = []); row.forEach((x, j) => { R[c - 1 + j] = x; }); }); },
      clearContent() { for (let i = 0; i < nr; i++) { const R = sh.rows[r - 1 + i]; if (R) for (let j = 0; j < nc; j++) R[c - 1 + j] = ""; } } }; } }
  const ss = { sheets: {}, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }, getSheets() { return Object.values(this.sheets); }, deleteSheet(s) { delete this.sheets[s.n]; }, getId() { return "id"; } };
  const props = {}, cache = {}, stats = { cacheHits: 0, readAll: 0 };
  const out = (t) => ({ t, setMimeType() { return this; } });
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { if (String(v).length > 100000) throw new Error("big"); cache[k] = String(v); }, getAll: (ks) => { const o = {}; ks.forEach((k) => { if (k in cache) o[k] = cache[k]; }); stats.cacheHits++; return o; }, putAll: (o) => { Object.entries(o).forEach(([k, v]) => { if (String(v).length > 100000) throw new Error("big"); cache[k] = String(v); }); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: out, MimeType: { JSON: "json" } },
    HtmlService: {}, Utilities: { sleep() {}, formatDate: (d) => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => "Asia/Seoul" },
    console, JSON, Date, Math, Object, String, Number, Array, Error, RegExp,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, "utf8"), ctx);
  const ra = ctx.readAll_; ctx.readAll_ = (...a) => { stats.readAll++; return ra(...a); };
  // vm 안 함수가 서로 부를 때도 세려면 다시 바인딩
  vm.runInContext("const __ra = readAll_; readAll_ = function () { __stats.readAll++; return __ra.apply(this, arguments); };", Object.assign(ctx, { __stats: stats }));
  const get = (p) => JSON.parse(ctx.doGet({ parameter: p }).t);
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).t);
  return { get, post, ctx, cache, props, stats, ss };
}
