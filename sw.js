// 한글표시사항 리스트: 앱 화면을 휴대폰에 저장해 두고 바로 띄움 (열 때마다 뒤에서 새 버전 받아 둠)
// 같은 저장소의 다른 페이지(order.html 등)와 구글 요청은 건드리지 않음
const CACHE = "label-list-shell-v9"; // 화면(index.html)·스크립트를 고칠 때마다 이 이름을 올린다. 안 올리면 휴대폰이 예전 화면을 계속 연다(v8 → v9: 사진 인식 패치)
const BASE = new URL("./", self.location).pathname; // /label-list/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith("label-list-shell-") && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isApp = req.mode === "navigate" && (url.pathname === BASE || url.pathname === BASE + "index.html");
  const isIcon = url.pathname.startsWith(BASE + "icons/label-");
  // 스크립트는 주소의 ?v= 를 뺀 경로로 기억한다(photo-prep.js?v=2 도 photo-prep.js).
  // 그래서 ?v= 만 올려서는 예전 사본이 계속 나올 수 있다 → 바꿀 때는 위 CACHE 이름도 같이 올린다.
  const isScript = url.pathname === BASE + "trace-nos.js" || url.pathname === BASE + "ocr-preprocess.js" || url.pathname === BASE + "barcode-decoder.js" || url.pathname === BASE + "photo-prep.js";
  if (!isApp && !isIcon && !isScript) return;
  const key = isApp ? BASE : url.pathname;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(key);
    const net = fetch(isApp ? BASE + "index.html" : req, { cache: "no-cache" })
      .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});

// ---- 휴대폰 알림 (유통기한·전달사항): 매장모음 구글 코드가 Firebase로 보냄 ----
self.addEventListener("push", (e) => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (err) {}
  const n = p.notification || {}, d = p.data || {};
  const title = n.title || d.title || "한글표시사항";
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || d.body || "", icon: BASE + "icons/label-192.png?v=2", badge: BASE + "icons/label-192.png?v=2",
    tag: d.tag || "label-list", data: { url: d.url || BASE },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || BASE, self.location).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const hit = list.find((c) => c.url.startsWith(self.location.origin + BASE));
    if (hit) { hit.navigate(url).catch(() => {}); return hit.focus(); }
    return self.clients.openWindow(url);
  }));
});
