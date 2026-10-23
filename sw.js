// 한글표시사항 리스트: 앱 화면을 휴대폰에 저장해 두고 바로 띄움 (열 때마다 뒤에서 새 버전 받아 둠)
// 같은 저장소의 다른 페이지(order.html 등)와 구글 요청은 건드리지 않음
const CACHE = "label-list-shell-v1";
const BASE = new URL("./", self.location).pathname; // /label-list/

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isApp = req.mode === "navigate" && (url.pathname === BASE || url.pathname === BASE + "index.html");
  const isIcon = url.pathname.startsWith(BASE + "icons/label-");
  if (!isApp && !isIcon) return;
  const key = isApp ? BASE : url.pathname;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(key);
    const net = fetch(isApp ? BASE + "index.html" : req, { cache: "no-cache" })
      .then((res) => { if (res.ok) cache.put(key, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
