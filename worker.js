/* MOONLAB Stock — ด่านหน้าของ Cloudflare Worker
 *
 * ทุก request วิ่งผ่านไฟล์นี้ก่อนเสมอ (run_worker_first ใน wrangler.toml)
 *  - /api/db/*   เป็นตัวกลางยิงไป Supabase โดยถือรหัสไว้ฝั่งเซิร์ฟเวอร์
 *                เบราว์เซอร์จะไม่เห็น SUPABASE_ANON_KEY / APP_TOKEN อีกต่อไป
 *  - /api/unlock ตรวจรหัสเข้าใช้งาน แล้วออก cookie แบบ HttpOnly ที่เซ็นด้วย HMAC
 *  - ที่เหลือส่งต่อให้ไฟล์ static ตามปกติ
 *
 * ค่าที่ต้องตั้ง (Cloudflare → Workers → moonlab-base → Settings → Build → Variables and secrets)
 *   ที่มีอยู่แล้ว : SUPABASE_URL, SUPABASE_ANON_KEY, APP_TOKEN
 *   ที่ต้องเพิ่ม  : APP_PIN, SESSION_SECRET
 *
 * ค่าพวกนี้ถูกอ่าน 2 ทาง เพื่อให้ใส่ไว้กล่องไหนก็ทำงาน:
 *   1. runtime binding (env) — ถ้าตั้งไว้ในกล่อง Variables and secrets ของตัว Worker เอง
 *   2. ค่าที่ build.sh ฝังไว้ตอน build — จากกล่อง Build variables ที่ใช้อยู่เดิม
 * โค้ด worker ไม่ได้ถูกเสิร์ฟให้เบราว์เซอร์ ค่าที่ฝังตอน build จึงไม่รั่วออกไปเหมือน config.js เดิม
 *
 * ตราบใดที่ยังไม่ได้ตั้ง APP_PIN กับ SESSION_SECRET ระบบจะทำงานแบบ "ยังไม่ล็อก"
 * คือใช้งานได้เหมือนเดิมทุกอย่าง ไม่พัง แต่รหัสฐานข้อมูลถูกซ่อนแล้ว
 * พอตั้งครบสองตัวเมื่อไหร่ ด่านรหัสจะเริ่มทำงานเองทันทีโดยไม่ต้อง deploy ใหม่
 */

import { BUILD_ENV } from './worker-config.js';

const COOKIE      = 'moonlab_session';
const SESSION_TTL = 12 * 60 * 60;                              /* อยู่ได้ 12 ชม. แล้วต้องใส่รหัสใหม่ */
const ALLOWED_FN  = new Set(['ml_pull', 'ml_push', 'ml_versions']);

const enc = new TextEncoder();

/* runtime มาก่อน ถ้าไม่มีค่อยใช้ที่ฝังไว้ตอน build */
const cfg = (env, k) => (env && env[k]) || BUILD_ENV[k] || '';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function b64url(buf) {
  let s = '';
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/* เทียบสตริงโดยใช้เวลาเท่ากันเสมอ ไม่ว่าจะผิดตั้งแต่ตัวแรกหรือตัวสุดท้าย
   ถ้าใช้ === ธรรมดา คนไล่เดารหัสจะจับเวลาตอบกลับมาไล่ทีละหลักได้ */
function safeEqual(a, b) {
  const A = enc.encode(String(a)), B = enc.encode(String(b));
  let diff = A.length ^ B.length;
  for (let i = 0; i < Math.max(A.length, B.length); i++) diff |= (A[i] || 0) ^ (B[i] || 0);
  return diff === 0;
}

/* ล็อกจริงก็ต่อเมื่อตั้งครบทั้งสองค่า — ดูหมายเหตุหัวไฟล์ */
const locked = env => !!(cfg(env, 'APP_PIN') && cfg(env, 'SESSION_SECRET'));

/* ---------- เซสชัน ---------- */
async function issueSession(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  return exp + '.' + await hmac(cfg(env, 'SESSION_SECRET'), 'v1.' + exp);
}

async function hasSession(req, env) {
  if (!locked(env)) return true;                                        /* ยังไม่ตั้งรหัส = ผ่านหมด */
  const hit = (req.headers.get('Cookie') || '')
    .split(/;\s*/).find(c => c.slice(0, COOKIE.length + 1) === COOKIE + '=');
  if (!hit) return false;

  const val = decodeURIComponent(hit.slice(COOKIE.length + 1));
  const dot = val.lastIndexOf('.');
  if (dot < 1) return false;

  const exp = val.slice(0, dot), sig = val.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;        /* หมดอายุแล้ว */
  return safeEqual(sig, await hmac(cfg(env, 'SESSION_SECRET'), 'v1.' + exp));
}

function cookieHeader(value, maxAge) {
  return COOKIE + '=' + value + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}

/* ---------- กันไล่เดารหัส ----------
   Pages ผูก rate limit binding แบบ Workers ไม่ได้ ตัวนับนี้จึงอยู่ในหน่วยความจำของ isolate
   ซึ่งช่วยได้เฉพาะการยิงรัวจากที่เดียว ไม่ใช่การกันแบบทั่วถึง
   ถ้าต้องการของจริง ให้ตั้ง WAF Rate limiting rule บน /api/unlock ในหน้า Cloudflare */
const tries = new Map();
function burstOk(req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const hits = (tries.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now);
  tries.set(ip, hits);
  if (tries.size > 5000) tries.clear();                                 /* กันบวมไม่จำกัด */
  return hits.length <= 10;
}

/* ---------- endpoints ---------- */
async function handleUnlock(req, env) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!locked(env)) return json({ ok: true });                          /* ยังไม่ตั้งรหัส ก็ถือว่าผ่าน */
  if (!burstOk(req)) return json({ error: 'ใส่รหัสผิดหลายครั้งเกินไป รอสักครู่' }, 429);

  let pin = '';
  try { pin = String(((await req.json()) || {}).pin || ''); } catch (e) { }
  if (!safeEqual(pin, cfg(env, 'APP_PIN'))) return json({ error: 'รหัสไม่ถูกต้อง' }, 401);

  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieHeader(await issueSession(env), SESSION_TTL));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

function handleLock() {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookieHeader('', 0));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

async function handleDb(req, env, fn) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!ALLOWED_FN.has(fn)) return json({ error: 'unknown function' }, 404);
  if (!await hasSession(req, env)) return json({ error: 'unauthorized' }, 401);

  const miss = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'APP_TOKEN'].filter(k => !cfg(env, k));
  if (miss.length) return json({ error: 'ยังไม่ได้ตั้งค่า: ' + miss.join(', ') }, 500);

  let body = {};
  try { body = (await req.json()) || {}; } catch (e) { }
  body.p_tok = cfg(env, 'APP_TOKEN');               /* ทับเสมอ — ฝั่งเบราว์เซอร์ส่ง token อะไรมาก็ไม่มีผล */

  let upstream;
  try {
    upstream = await fetch(cfg(env, 'SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': cfg(env, 'SUPABASE_ANON_KEY'),
        'Authorization': 'Bearer ' + cfg(env, 'SUPABASE_ANON_KEY'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return json({ error: 'ต่อฐานข้อมูลไม่ได้' }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;

    if (path === '/api/session') return json({ ok: await hasSession(req, env), locked: locked(env) });
    if (path === '/api/unlock')  return handleUnlock(req, env);
    if (path === '/api/lock')    return handleLock();
    if (path.startsWith('/api/db/')) return handleDb(req, env, path.slice('/api/db/'.length));

    /* ไฟล์เดิมที่เคยมีรหัสฐานข้อมูลอยู่ข้างใน ตอนนี้ build ไม่สร้างแล้ว
       ตอบ 410 ไว้ให้ชัด เผื่อมีเบราว์เซอร์หรือ service worker ที่ยัง cache ตัวเก่าไว้ */
    if (path === '/config.js') {
      return new Response('/* ย้ายไปฝั่งเซิร์ฟเวอร์แล้ว */', {
        status: 410,
        headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    return env.ASSETS.fetch(req);
  }
};
