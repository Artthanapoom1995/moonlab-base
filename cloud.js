/* MOONLAB Stock — cloud sync layer (Supabase RPC)
 * ไม่ต้อง build ไม่ต้อง npm — โหลดเป็น <script> ธรรมดา
 *
 * หลักการ:
 *  - state ถูกแยกเก็บเป็น "เอกสาร" ตาม key (products, sales, pkg, ...) แต่ละ key มี version ของตัวเอง
 *  - เขียน: push แบบ debounce พร้อม base version → ถ้าชนกัน (อีกเครื่องแก้ไปก่อน) จะ merge อัตโนมัติแล้วส่งใหม่
 *  - อ่าน: poll เฉพาะตาราง version (เล็กมาก) ทุก 5 วิ ถ้ามี key ไหน version ใหม่กว่าค่อยดึงเฉพาะ key นั้น
 *  - ออฟไลน์: คิวไว้ใน localStorage แล้วส่งเมื่อกลับมาออนไลน์ ระหว่างนั้นแอปยังใช้งานได้จาก cache
 */
(function () {
  'use strict';

  /* ตัวรันของ design canvas จะคัดลอกสคริปต์ใน <helmet> ไปใส่ <head> อีกรอบ
     ทำให้ไฟล์นี้ถูกรันสองครั้ง ถ้าปล่อยไว้ ตัวที่รันทีหลังจะทับตัวแรกที่แอปตั้งค่าไว้แล้ว
     กลายเป็นตัวเปล่าไม่มีรหัสฐานข้อมูล → บันทึกอะไรไปก็ไม่ขึ้นคลาวด์
     กันด้วยการออกทันทีถ้ามีตัวเดิมอยู่แล้ว */
  if (window.MoonlabCloud) return;

  var CACHE_KEY = 'moonlab_stock_v1';
  var VER_KEY = 'moonlab_versions_v1';
  var OUT_KEY = 'moonlab_outbox_v1';
  var WHO_KEY = 'moonlab_who_v1';
  var POLL_MS = 5000;
  var DEBOUNCE_MS = 700;

  /* key ที่ sync ขึ้นคลาวด์ และวิธี merge เมื่อสองเครื่องแก้พร้อมกัน */
  var SCHEMA = {
    products: { type: 'list', id: 'id' },
    sales: { type: 'list', id: 'id' },
    pkg: { type: 'list', id: 'name' },
    orders: { type: 'list', id: 'id' },
    ledger: { type: 'list', id: 'id' },
    tasks: { type: 'list', id: 'id' },
    importedOrders: { type: 'set' },
    adSpend: { type: 'map' },
    rules: { type: 'map' },
    fees: { type: 'map' },
    images: { type: 'map' }
  };
  var KEYS = Object.keys(SCHEMA);

  var cfg = null;          /* { url, key, token } */
  var versions = {};       /* key -> version ที่เครื่องนี้รู้ */
  var lastSnap = {};       /* key -> ข้อมูลล่าสุดที่ push สำเร็จ (ใช้ตรวจว่ามีอะไรถูกลบ) */
  var tombs = {};          /* key -> { id: ts } รายการที่ถูกลบ */
  var dirty = {};          /* key -> true รอ push */
  var pending = {};        /* key -> data ล่าสุดที่รอส่ง */
  var timer = null, poller = null;
  var onRemote = null, onStatus = null;
  var status = { state: 'offline', at: 0, msg: '' };
  var busy = false;

  /* ---------- utils ---------- */
  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function now() { return Date.now(); }

  function setStatus(state, msg) {
    status = { state: state, at: now(), msg: msg || '' };
    if (onStatus) { try { onStatus(clone(status)); } catch (e) { } }
  }

  /* ---------- merge ---------- */
  /* union ตาม id: ของใครใหม่กว่าเอาของคนนั้น + เคารพรายการที่ถูกลบ */
  function mergeList(mine, theirs, spec, tomb) {
    var idf = spec.id, out = [], seen = {};
    var pick = function (arr) {
      (arr || []).forEach(function (row) {
        if (!row) return;
        var id = String(row[idf]);
        if (tomb && tomb[id]) return;              /* ถูกลบไปแล้ว อย่าปลุกกลับมา */
        if (seen[id]) return;
        seen[id] = 1;
        out.push(row);
      });
    };
    pick(mine);   /* ของเครื่องนี้มาก่อน = การแก้ล่าสุดของเราชนะระดับ record */
    pick(theirs);
    return out;
  }

  function mergeSet(mine, theirs, tomb) {
    var out = [], seen = {};
    (mine || []).concat(theirs || []).forEach(function (v) {
      var k = String(v);
      if (tomb && tomb[k]) return;
      if (seen[k]) return;
      seen[k] = 1; out.push(v);
    });
    return out;
  }

  function mergeMap(mine, theirs, tomb) {
    var out = {}, k;
    for (k in (theirs || {})) if (!(tomb && tomb[k])) out[k] = theirs[k];
    for (k in (mine || {})) if (!(tomb && tomb[k])) out[k] = mine[k];   /* ของเราทับ */
    return out;
  }

  function mergeKey(key, mine, theirs) {
    var spec = SCHEMA[key], tomb = tombs[key] || {};
    if (!spec) return mine;
    if (spec.type === 'list') return mergeList(mine, theirs, spec, tomb);
    if (spec.type === 'set') return mergeSet(mine, theirs, tomb);
    return mergeMap(mine, theirs, tomb);
  }

  /* ตรวจว่ามีอะไรหายไปจาก snapshot เดิม → บันทึกเป็น tombstone จะได้ไม่โดน merge ปลุกกลับ */
  function recordDeletes(key, next) {
    var spec = SCHEMA[key], prev = lastSnap[key];
    if (prev === undefined) return;
    var t = tombs[key] || (tombs[key] = {});
    var ids = function (v) {
      var m = {};
      if (spec.type === 'list') (v || []).forEach(function (r) { if (r) m[String(r[spec.id])] = 1; });
      else if (spec.type === 'set') (v || []).forEach(function (r) { m[String(r)] = 1; });
      else for (var k in (v || {})) m[k] = 1;
      return m;
    };
    var before = ids(prev), after = ids(next), k;
    for (k in before) if (!after[k]) t[k] = now();
    /* ถ้าถูกเพิ่มกลับมาเองก็ล้าง tombstone ทิ้ง */
    for (k in after) if (t[k]) delete t[k];
    /* กัน tombstone บวมข้ามปี — เก็บ 60 วันพอ */
    var cut = now() - 60 * 864e5;
    for (k in t) if (t[k] < cut) delete t[k];
  }

  /* ---------- transport ---------- */
  function rpc(fn, body) {
    if (!cfg) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า cloud'));
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    return fetch(cfg.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': cfg.key,
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {}),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(to);
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160)); });
      return r.json();
    }, function (e) { clearTimeout(to); throw e; });
  }

  /* ---------- push ---------- */
  function flush() {
    if (busy || !cfg) return Promise.resolve();
    var keys = Object.keys(dirty);
    if (!keys.length) return Promise.resolve();
    busy = true;
    setStatus('syncing');

    var chain = Promise.resolve();
    keys.forEach(function (key) { chain = chain.then(function () { return pushOne(key, 0); }); });

    return chain.then(function () {
      busy = false;
      setStatus('ok');
      if (Object.keys(dirty).length) schedule();
    }, function (err) {
      busy = false;
      setStatus('offline', String(err && err.message || err));
      save(OUT_KEY, { pending: pending, versions: versions, tombs: tombs });
      setTimeout(schedule, 8000);   /* ลองใหม่เรื่อยๆ */
    });
  }

  function pushOne(key, retry) {
    var data = pending[key];
    if (data === undefined) { delete dirty[key]; return Promise.resolve(); }
    return rpc('ml_push', {
      p_tok: cfg.token, p_key: key, p_data: data,
      p_base: versions[key] || 0, p_who: MoonlabCloud.who()
    }).then(function (res) {
      var r = Array.isArray(res) ? res[0] : res;
      if (r && r.conflict) {
        if (retry >= 3) throw new Error('sync ชนกันหลายรอบที่ ' + key);
        /* อีกเครื่องเขียนไปก่อน — รวมของสองฝั่งแล้วส่งใหม่ */
        var merged = mergeKey(key, data, r.data);
        pending[key] = merged;
        versions[key] = r.version;
        applyRemote(key, merged, true);
        return pushOne(key, retry + 1);
      }
      versions[key] = (r && r.version) || (versions[key] || 0) + 1;
      lastSnap[key] = clone(data);
      if (pending[key] === data) { delete dirty[key]; delete pending[key]; }
      save(VER_KEY, { versions: versions, tombs: tombs });
      return null;
    });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; flush(); }, DEBOUNCE_MS);
  }

  /* ---------- pull ---------- */
  function applyRemote(key, data, silent) {
    if (onRemote) { try { onRemote(key, data, !!silent); } catch (e) { } }
  }

  function poll() {
    if (!cfg || busy || document.hidden) return Promise.resolve();
    return rpc('ml_versions', { p_tok: cfg.token }).then(function (rows) {
      var stale = [];
      (rows || []).forEach(function (r) {
        if (dirty[r.key]) return;                     /* ของเรายังไม่ได้ส่ง อย่าเพิ่งทับ */
        if ((versions[r.key] || 0) < r.version) stale.push(r.key);
      });
      if (!stale.length) { setStatus('ok'); return null; }
      return rpc('ml_pull', { p_tok: cfg.token, p_keys: stale }).then(function (docs) {
        (docs || []).forEach(function (d) {
          versions[d.key] = d.version;
          lastSnap[d.key] = clone(d.data);
          applyRemote(d.key, d.data, false);
        });
        save(VER_KEY, { versions: versions, tombs: tombs });
        setStatus('ok');
        return null;
      });
    }).catch(function (err) {
      setStatus('offline', String(err && err.message || err));
    });
  }

  /* ---------- public ---------- */
  var MoonlabCloud = {
    KEYS: KEYS,

    configure: function (c) {
      if (!c || !c.url || !c.key || !c.token) return false;
      if (/^__/.test(c.url) || /^__/.test(c.key) || /^__/.test(c.token)) return false;  /* ยังไม่ได้กรอกค่าจริง */
      cfg = { url: c.url, key: c.key, token: c.token };
      var v = ls(VER_KEY, null);
      if (v) { versions = v.versions || {}; tombs = v.tombs || {}; }
      var out = ls(OUT_KEY, null);
      if (out && out.pending) {
        pending = out.pending;
        Object.keys(pending).forEach(function (k) { dirty[k] = true; });
        try { localStorage.removeItem(OUT_KEY); } catch (e) { }
      }
      return true;
    },

    enabled: function () { return !!cfg; },

    who: function () { return ls(WHO_KEY, '') || 'ไม่ระบุ'; },
    setWho: function (name) { save(WHO_KEY, String(name || '').slice(0, 24)); },

    status: function () { return clone(status); },

    /* โหลดจาก cache ก่อน (เร็ว) แล้วค่อยอัปเดตจากคลาวด์ */
    cached: function () { return ls(CACHE_KEY, null); },
    cache: function (state) { save(CACHE_KEY, state); },

    /* ดึงทุก key จากคลาวด์ครั้งแรก */
    load: function () {
      if (!cfg) return Promise.resolve(null);
      setStatus('syncing');
      return rpc('ml_pull', { p_tok: cfg.token, p_keys: KEYS }).then(function (docs) {
        var out = {}, any = false;
        (docs || []).forEach(function (d) {
          out[d.key] = d.data;
          versions[d.key] = d.version;
          lastSnap[d.key] = clone(d.data);
          any = true;
        });
        save(VER_KEY, { versions: versions, tombs: tombs });
        setStatus('ok');
        return any ? out : null;
      }).catch(function (err) {
        setStatus('offline', String(err && err.message || err));
        return null;
      });
    },

    /* เรียกทุกครั้งที่ state เปลี่ยน — ส่งเฉพาะ key ที่ค่าต่างจริง */
    push: function (state) {
      if (!cfg) return;
      KEYS.forEach(function (key) {
        if (!(key in state)) return;
        var next = state[key];
        if (JSON.stringify(next) === JSON.stringify(lastSnap[key])) return;
        recordDeletes(key, next);
        pending[key] = clone(next);
        dirty[key] = true;
      });
      if (Object.keys(dirty).length) schedule();
    },

    /* ใช้ตอน seed ครั้งแรก: ยัดทุก key ขึ้นคลาวด์ */
    seed: function (state) {
      if (!cfg) return Promise.resolve();
      KEYS.forEach(function (key) {
        if (!(key in state)) return;
        pending[key] = clone(state[key]);
        dirty[key] = true;
      });
      return flush();
    },

    start: function (handlers) {
      onRemote = handlers && handlers.onRemote;
      onStatus = handlers && handlers.onStatus;
      if (!cfg) { setStatus('local'); return; }
      if (poller) clearInterval(poller);
      poller = setInterval(poll, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { poll(); flush(); } });
      window.addEventListener('online', function () { poll(); flush(); });
      window.addEventListener('focus', function () { poll(); });
      poll();
    },

    syncNow: function () { return Promise.all([flush(), poll()]); }
  };

  window.MoonlabCloud = MoonlabCloud;
})();
