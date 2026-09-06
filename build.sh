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

# สร้าง config.js จากค่าลับใน Cloudflare (ไม่มีวันอยู่ใน GitHub)
: "${SUPABASE_URL:=}"
: "${SUPABASE_ANON_KEY:=}"
: "${APP_TOKEN:=}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$APP_TOKEN" ]; then
  echo ""
  echo "!! ยังไม่ได้ตั้ง Environment variables ใน Cloudflare"
  echo "!! ต้องมี: SUPABASE_URL, SUPABASE_ANON_KEY, APP_TOKEN"
  echo "!! เว็บจะ deploy ได้ แต่ข้อมูลจะยังไม่แชร์ระหว่างเครื่อง"
  echo ""
fi

# ตรวจรูปแบบคร่าวๆ เพื่อกันใส่ค่าผิดช่อง (ไม่พิมพ์ค่าจริงออก log)
echo "--- ตรวจค่าที่ได้รับ ---"
echo "SUPABASE_URL      : ${#SUPABASE_URL} ตัวอักษร"
echo "SUPABASE_ANON_KEY : ${#SUPABASE_ANON_KEY} ตัวอักษร"
echo "APP_TOKEN         : ${#APP_TOKEN} ตัวอักษร"

case "$SUPABASE_URL" in
  https://*.supabase.co) ;;
  "") ;;
  *) echo "!! SUPABASE_URL ผิดรูปแบบ ต้องเป็น https://xxxxx.supabase.co" ;;
esac

if [ -n "$SUPABASE_ANON_KEY" ] && [ "${#SUPABASE_ANON_KEY}" -lt 40 ]; then
  echo "!! SUPABASE_ANON_KEY สั้นผิดปกติ (${#SUPABASE_ANON_KEY} ตัว) — ของจริงยาวเกิน 100 ตัว"
  echo "!! น่าจะคัดลอกผิดช่อง ต้องเป็น Publishable key (sb_publishable_...) หรือ anon key (eyJ...)"
fi
echo "-----------------------"

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
