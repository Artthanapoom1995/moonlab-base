/* ลงทะเบียน service worker — ทำงานเฉพาะตอนเปิดผ่าน https (หรือ localhost) เท่านั้น */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      /* มีเวอร์ชันใหม่ขึ้นเซิร์ฟเวอร์ — โหลดหน้าใหม่ให้อัตโนมัติเมื่อพร้อม */
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            try { sessionStorage.setItem('moonlab_reloaded', '1'); } catch (e) { }
          }
        });
      });
    }).catch(function () { });
  });
})();
