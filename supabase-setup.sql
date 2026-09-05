-- ============================================================
-- MOONLAB Stock — ตั้งค่าฐานข้อมูลกลาง (วางทั้งไฟล์นี้ใน Supabase → SQL Editor → Run)
-- รันซ้ำได้ ไม่ทำข้อมูลเดิมหาย
-- ============================================================

-- 1) ตารางเก็บข้อมูล -----------------------------------------
create table if not exists public.ml_state (
  key        text primary key,
  data       jsonb       not null default '{}'::jsonb,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 2) ตารางเก็บรหัสลับของแอป (ไม่มีใครอ่านได้นอกจากฟังก์ชันข้างล่าง)
create table if not exists public.ml_config (
  id         int primary key default 1,
  app_token  text not null,
  created_at timestamptz not null default now()
);

-- 3) ปิดประตูทุกบาน: ห้ามแตะตารางตรงๆ ทั้งจากเว็บและจาก REST API
alter table public.ml_state  enable row level security;
alter table public.ml_config enable row level security;
-- (ไม่สร้าง policy เลย = ไม่มีใครผ่าน RLS ได้ ยกเว้นฟังก์ชัน security definer ด้านล่าง)

revoke all on public.ml_state  from anon, authenticated;
revoke all on public.ml_config from anon, authenticated;

-- 4) ใส่รหัสลับของแอป ------------------------------------------
--    !! เปลี่ยน 'CHANGE-ME-TO-A-LONG-RANDOM-STRING' เป็นข้อความสุ่มยาวๆ ของคุณเอง
--    แล้วเอาค่าเดียวกันนี้ไปใส่ในไฟล์ config.js ช่อง token
insert into public.ml_config (id, app_token)
values (1, 'CHANGE-ME-TO-A-LONG-RANDOM-STRING')
on conflict (id) do nothing;

-- 5) ฟังก์ชันตรวจรหัสลับ ---------------------------------------
create or replace function public.ml_auth(p_tok text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  select (app_token = p_tok) into ok from public.ml_config where id = 1;
  if coalesce(ok, false) is not true then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return true;
end;
$$;

-- 6) อ่าน version ของทุก key (payload เล็กมาก ใช้ poll ทุก 5 วิ)
create or replace function public.ml_versions(p_tok text)
returns table (key text, version bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ml_auth(p_tok);
  return query select s.key, s.version from public.ml_state s;
end;
$$;

-- 7) ดึงข้อมูลเฉพาะ key ที่ต้องการ
create or replace function public.ml_pull(p_tok text, p_keys text[])
returns table (key text, data jsonb, version bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ml_auth(p_tok);
  return query
    select s.key, s.data, s.version
    from public.ml_state s
    where s.key = any(p_keys);
end;
$$;

-- 8) เขียนข้อมูล พร้อมตรวจการชนกันของสองเครื่อง
--    p_base = version ที่เครื่องนั้นถืออยู่
--    ถ้าไม่ตรงกับของจริง → คืน conflict = true พร้อมข้อมูลล่าสุด ให้ฝั่งเว็บ merge แล้วส่งใหม่
create or replace function public.ml_push(
  p_tok text, p_key text, p_data jsonb, p_base bigint, p_who text
)
returns table (conflict boolean, data jsonb, version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare cur bigint; cur_data jsonb;
begin
  perform public.ml_auth(p_tok);

  select s.version, s.data into cur, cur_data
  from public.ml_state s where s.key = p_key
  for update;

  if cur is null then
    insert into public.ml_state (key, data, version, updated_at, updated_by)
    values (p_key, p_data, 1, now(), p_who);
    return query select false, null::jsonb, 1::bigint;
    return;
  end if;

  if cur <> p_base then
    return query select true, cur_data, cur;
    return;
  end if;

  update public.ml_state s
     set data = p_data, version = cur + 1, updated_at = now(), updated_by = p_who
   where s.key = p_key;
  return query select false, null::jsonb, (cur + 1)::bigint;
end;
$$;

-- 9) ล้างข้อมูลทั้งหมด (ใช้ตอนอยากลบข้อมูลตัวอย่างเพื่อเริ่มใช้ของจริง)
create or replace function public.ml_reset(p_tok text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ml_auth(p_tok);
  delete from public.ml_state;
end;
$$;

-- 10) เปิดให้เว็บเรียกได้เฉพาะ 4 ฟังก์ชันนี้ (ต้องมีรหัสลับถึงจะผ่าน)
revoke all on function public.ml_auth(text)                                  from public, anon, authenticated;
revoke all on function public.ml_versions(text)                              from public, anon, authenticated;
revoke all on function public.ml_pull(text, text[])                          from public, anon, authenticated;
revoke all on function public.ml_push(text, text, jsonb, bigint, text)       from public, anon, authenticated;
revoke all on function public.ml_reset(text)                                 from public, anon, authenticated;

grant execute on function public.ml_versions(text)                           to anon;
grant execute on function public.ml_pull(text, text[])                       to anon;
grant execute on function public.ml_push(text, text, jsonb, bigint, text)    to anon;
grant execute on function public.ml_reset(text)                              to anon;

-- เสร็จแล้ว ✅
-- ตรวจได้ว่าใครแก้ล่าสุดเมื่อไหร่:  select key, version, updated_by, updated_at from ml_state order by updated_at desc;
