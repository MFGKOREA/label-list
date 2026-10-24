// GW·MIS 로그인 화면이면 저장해 둔 아이디·비밀번호를 넣고 로그인 (자동 탭에서만)
//  잘못된 비밀번호로 계정이 잠기지 않게 30분에 2번까지만 시도
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null && !el.disabled;
  let pw = null;
  for (let t = 0; t < 10 && !visible(pw); t++) { pw = [...document.querySelectorAll('input[type="password"]')].find(visible) || null; if (!pw) await sleep(500); }
  const managed = await chrome.runtime.sendMessage({ q: "managed" }).then((r) => r && r.managed, () => false);
  if (!managed) return;
  // GW에 로그인된 화면(비밀번호 칸 없음)이면 MIS로 넘어감
  if (!pw) { if (window === window.top && location.host.startsWith("gw.")) { await sleep(1500); chrome.runtime.sendMessage({ q: "toMis" }); } return; }
  const cfg = await chrome.storage.local.get(["id", "pw", "tries"]);
  if (!cfg.pw) { chrome.runtime.sendMessage({ q: "log", msg: "비밀번호가 저장 안 돼 있어 로그인 못 함" }); return; }
  const now = Date.now(), tries = (cfg.tries || []).filter((t) => now - t < 30 * 60e3);
  if (tries.length >= 2) { chrome.runtime.sendMessage({ q: "log", msg: "로그인 2번 실패 · 30분 쉬고 다시 (비밀번호 확인)" }); return; }
  tries.push(now); await chrome.storage.local.set({ tries });
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const ids = [...document.querySelectorAll("input")].filter((i) => visible(i) && /^(text|email|)$/i.test(i.getAttribute("type") || "") && (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING));
  const idIn = ids.pop();
  if (idIn && cfg.id) setV(idIn, cfg.id);
  setV(pw, cfg.pw);
  await sleep(400);
  const btn = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="image"], a')].find((b) => visible(b) && /log\s*in|로그인/i.test(b.textContent || b.value || b.alt || ""));
  if (btn) btn.click();
  else if (pw.form) (pw.form.requestSubmit ? pw.form.requestSubmit() : pw.form.submit());
  else ["keydown", "keypress", "keyup"].forEach((type) => pw.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
  chrome.runtime.sendMessage({ q: "log", msg: `로그인 시도 (${location.host})` });
})();
