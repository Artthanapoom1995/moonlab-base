#!/usr/bin/env bash
# ============================================================
# MOONLAB Stock — สคริปต์ที่ Cloudflare Pages รันเองทุกครั้งที่ push ขึ้น GitHub
# รหัสลับไม่ได้อยู่ในไฟล์นี้ — ดึงมาจาก Environment variables ที่ตั้งไว้ใน Cloudflare
# ============================================================
set -euo pipefail

OUT=public
STAMP=$(date +%Y%m%d-%H%M)

rm -rf "$OUT"
mkdir -p "$OUT"

# ไฟล์แอปหลัก
cp "MOONLAB Stock.dc.html" "$OUT/index.html"

# ไฟล์ประกอบ
cp support.js cloud.js pwa.js products.json manifest.webmanifest "$OUT/"
cp icon-180.png icon-192.png icon-512.png "$OUT/"

# service worker + ประทับเวอร์ชัน
sed "s/__BUILD__/$STAMP/" sw.js > "$OUT/sw.js"

# ค่าลับสำหรับ worker.js — ฝังตอน build จากตัวแปรที่ตั้งไว้ใน Cloudflare
# ไฟล์นี้ไม่ได้อยู่ใน public/ จึงไม่ถูกเสิร์ฟให้เบราว์เซอร์ (ต่างจาก config.js เดิม)
# และอยู่ใน .gitignore จึงไม่มีทางขึ้น GitHub
cat > worker-config.js <<EOF
/* สร้างอัตโนมัติตอน build — อย่าแก้ อย่า commit */
export const BUILD_ENV = {
  SUPABASE_URL:      '${SUPABASE_URL:-}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY:-}',
  APP_TOKEN:         '${APP_TOKEN:-}',
  APP_PIN:           '${APP_PIN:-}',
  SESSION_SECRET:    '${SESSION_SECRET:-}'
};
EOF

# เตือนถ้ายังตั้งค่าไม่ครบ (ไม่พิมพ์ค่าจริงออก log)
# ใช้ ${VAR:-} เพราะสคริปต์นี้เปิด set -u ไว้ อ้างตัวแปรที่ไม่มีตรงๆ จะทำให้ build ตาย
warn_unset() {
  eval "v=\${$1:-}"
  [ -n "$v" ] || echo "!! ยังไม่ได้ตั้ง $1 — $2"
}
warn_unset SUPABASE_URL      "ซิงก์ข้อมูลจะใช้ไม่ได้"
warn_unset SUPABASE_ANON_KEY "ซิงก์ข้อมูลจะใช้ไม่ได้"
warn_unset APP_TOKEN         "ซิงก์ข้อมูลจะใช้ไม่ได้"
warn_unset APP_PIN           "เว็บจะยังเปิดให้ใครก็เข้าได้ (ยังไม่ล็อกด้วยรหัส)"
warn_unset SESSION_SECRET    "เว็บจะยังเปิดให้ใครก็เข้าได้ (ยังไม่ล็อกด้วยรหัส)"

echo "build เสร็จ → $OUT (เวอร์ชัน $STAMP)"
ls -la "$OUT"
