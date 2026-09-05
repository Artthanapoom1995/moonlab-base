/* ============================================================
   MOONLAB Stock — ตั้งค่าเชื่อมฐานข้อมูลกลาง
   แก้ 3 บรรทัดนี้ให้ตรงกับโปรเจกต์ Supabase ของคุณ แล้วเว็บจะแชร์ข้อมูลกันทุกเครื่องทันที
   (ถ้ายังไม่แก้ เว็บจะทำงานได้ปกติ แต่เก็บข้อมูลไว้ในเครื่องใครเครื่องมันเหมือนเดิม)

   url   = Supabase → Project Settings → Data API → Project URL
   key   = Supabase → Project Settings → API Keys → anon / public
   token = ข้อความสุ่มยาวๆ ที่คุณตั้งเอง ต้องตรงกับที่ใส่ใน supabase-setup.sql ข้อ 4
   ============================================================ */
window.MOONLAB_CONFIG = {
  url:   '__SUPABASE_URL__',
  key:   '__SUPABASE_ANON_KEY__',
  token: '__APP_TOKEN__'
};
