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
cp support.js image-slot.js cloud.js pwa.js products.json manifest.webmanifest "$OUT/"
cp icon-180.png icon-192.png icon-512.png "$OUT/"

# service worker + ประทับเวอร์ชัน
sed "s/__BUILD__/$STAMP/" sw.js > "$OUT/sw.js"

# สร้าง config.js จากค่าลับใน Cloudflare (ไม่มีวันอยู่ใน GitHub)
: "${SUPABASE_URL:=}"
: "${SUPABASE_ANON_KEY:=}"
: "${APP_TOKEN:=}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$APP_TOKEN" ]; then
  echo ""
  echo "!! ยังไม่ได้ตั้ง Environment variables ใน Cloudflare Pages"
  echo "!! ต้องมี: SUPABASE_URL, SUPABASE_ANON_KEY, APP_TOKEN"
  echo "!! เว็บจะ deploy ได้ แต่ข้อมูลจะยังไม่แชร์ระหว่างเครื่อง"
  echo ""
fi

cat > "$OUT/config.js" <<EOF
/* สร้างอัตโนมัติตอน deploy — อย่าแก้ไฟล์นี้ */
window.MOONLAB_CONFIG = {
  url:   '${SUPABASE_URL}',
  key:   '${SUPABASE_ANON_KEY}',
  token: '${APP_TOKEN}'
};
EOF

echo "build เสร็จ → $OUT (เวอร์ชัน $STAMP)"
ls -la "$OUT"
