# ============================================================
# MOONLAB Stock — สร้างโฟลเดอร์ public สำหรับอัปขึ้น Cloudflare Pages
# วิธีใช้:  คลิกขวาไฟล์นี้ → Run with PowerShell   (หรือรัน  .\build.ps1  ใน PowerShell)
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out  = Join-Path $root 'public'
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

# 1) ไฟล์แอปหลัก → index.html
Copy-Item (Join-Path $root 'MOONLAB Stock.dc.html') (Join-Path $out 'index.html') -Force

# 2) ไฟล์ประกอบ
$files = @(
  'support.js','cloud.js','pwa.js',
  'products.json','manifest.webmanifest',
  'icon-180.png','icon-192.png','icon-512.png'
)
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $out $f) -Force }
  else { Write-Warning "ไม่พบไฟล์ $f" }
}

# 3) service worker + ประทับเวอร์ชัน (ทำให้เครื่องที่เคยเปิดแล้วเห็นของใหม่)
$sw = Get-Content (Join-Path $root 'sw.js') -Raw -Encoding UTF8
$sw = $sw.Replace('__BUILD__', $stamp)
Set-Content -Path (Join-Path $out 'sw.js') -Value $sw -Encoding UTF8 -NoNewline

# 4) ค่าลับสำหรับ worker.js
#    ตอนทดสอบบนเครื่องนี้ปล่อยว่างไว้ได้ (serve.ps1 เสิร์ฟไฟล์ static เฉยๆ ไม่ได้รัน worker)
#    ถ้าอยากทดสอบด่านรหัสจริง ใช้ npx wrangler dev แล้วใส่ค่าในไฟล์ .dev.vars
$wcfg = Join-Path $root 'worker-config.js'
if (-not (Test-Path $wcfg)) {
  @('/* สร้างอัตโนมัติตอน build — อย่าแก้ อย่า commit */','export const BUILD_ENV = {','  SUPABASE_URL: '''',','  SUPABASE_ANON_KEY: '''',','  APP_TOKEN: '''',','  APP_PIN: '''',','  SESSION_SECRET: ''''','};') | Set-Content -Path $wcfg -Encoding UTF8
}

# uploads/ กับ tmp/ ไม่ได้ถูกคัดลอกไปด้วยตั้งใจ — เป็นไฟล์ที่เคยอัปไว้ตอนนำเข้าข้อมูล
# ถ้าเอาขึ้นเว็บจะกลายเป็นไฟล์สาธารณะที่ใครก็โหลดได้

Write-Host ''
Write-Host "เสร็จแล้ว → $out   (เวอร์ชัน $stamp)" -ForegroundColor Green
Write-Host 'ใช้ทดสอบบนเครื่องนี้: .\serve.ps1  แล้วเปิด http://localhost:8080'
Write-Host 'ขึ้นเว็บจริง: git push แล้ว Cloudflare Pages จะ build ให้เองอัตโนมัติ'
