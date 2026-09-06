# ============================================================
# MOONLAB Stock — เปิดเว็บทดสอบบนเครื่องตัวเอง (ไม่ต้องลง Node/Python)
# วิธีใช้:  .\serve.ps1     แล้วเปิด http://localhost:8080
# ปิดเซิร์ฟเวอร์: กด Ctrl+C
# ============================================================
param([int]$Port = 8080)

$root = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'public'
if (-not (Test-Path $root)) { Write-Host 'ยังไม่มีโฟลเดอร์ public — รัน .\build.ps1 ก่อน' -ForegroundColor Yellow; exit 1 }

$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.webmanifest'='application/manifest+json; charset=utf-8'
  '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.css'='text/css; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "เปิดเว็บที่ http://localhost:$Port  (Ctrl+C เพื่อหยุด)" -ForegroundColor Green

# ทุกคำขอห่อด้วย try/catch — ถ้าเบราว์เซอร์ปิดการเชื่อมต่อกลางคัน (เช่นกดรีเฟรชระหว่างโหลด)
# การเขียนจะโยน exception ถ้าไม่ดักไว้ เซิร์ฟเวอร์จะดับทั้งตัวและต้องมาเปิดใหม่
try {
  while ($listener.IsListening) {
    try {
      $ctx = $listener.GetContext()
    } catch { break }
    try {
      $rel = [uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = Join-Path $root $rel
      if (Test-Path $path -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $ext = [System.IO.Path]::GetExtension($path).ToLower()
        $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
        $ctx.Response.Headers.Add('Cache-Control','no-store')
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.StatusCode = 404
        $b = [System.Text.Encoding]::UTF8.GetBytes('404 not found: ' + $rel)
        $ctx.Response.OutputStream.Write($b, 0, $b.Length)
      }
    } catch {
      Write-Host ("ข้ามคำขอที่ผิดพลาด: " + $_.Exception.Message) -ForegroundColor DarkYellow
    } finally {
      try { $ctx.Response.Close() } catch { }
    }
  }
} finally { $listener.Stop(); $listener.Close() }
