/* MOONLAB Stock — service worker
   เปิดแอปได้แม้เน็ตหลุด และโหลดเร็วขึ้นมากบนไอโฟน/ไอแพด (React + Babel ถูก cache ไว้)
   VERSION ถูกแทนค่าอัตโนมัติตอน build.ps1 */
var VERSION = '__BUILD__';
var SHELL = 'moonlab-shell-' + VERSION;
var LIB = 'moonlab-lib-v1';

var PRECACHE = [
  './', './index.html', './support.js', './cloud.js',
  './config.js', './pwa.js', './products.json', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () { }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n !== SHELL && n !== LIB) return caches.delete(n);   /* ล้างของเวอร์ชันเก่า */
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       /* ข้อมูลจาก Supabase เป็น POST — ไม่แตะ */
  var url = new URL(req.url);

  /* ไลบรารีจาก CDN: URL ล็อกเวอร์ชันอยู่แล้ว เอาจาก cache ได้เลย */
  if (url.origin !== self.location.origin) {
    if (!/unpkg\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) return;
    e.respondWith(
      caches.open(LIB).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  var isDoc = req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname) || /config\.js$/.test(url.pathname);

  if (isDoc) {
    /* หน้าเว็บ + config: เอาของใหม่ก่อนเสมอ ถ้าเน็ตหลุดค่อยใช้ของเดิม */
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  /* ไฟล์อื่นในเว็บ: ใช้ cache ก่อน (เร็ว) แล้วอัปเดตเงียบๆ ไว้ใช้รอบหน้า */
  e.respondWith(
    caches.open(SHELL).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
