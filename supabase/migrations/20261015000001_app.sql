-- =========================================================
-- 0004_app.sql：前端功能需要的函式、AI 服務初始設定
-- =========================================================

-- ---------- AI 服務初始設定 ----------
-- seed.sql 只會在本機 `supabase db reset` 時執行，雲端專案要靠 migration 建立。
-- 已存在的設定不覆蓋（管理員可能已在後台調整過）。
-- 模型名稱可隨時在「AI 管理」頁修改；沒有設定金鑰的服務會自動跳過。
insert into public.ai_providers
  (id, display_name, adapter, model, enabled, fallback_order, is_default, daily_limit_per_user, timeout_seconds, note)
values
  ('ollama-cloud', 'Ollama Cloud',  'ollama', 'qwen3-vl:235b-cloud', true,  10, false, 50,   40, '需要 OLLAMA_API_KEY；免費起步'),
  ('gemini',       'Google Gemini', 'gemini', 'gemini-2.5-flash',    true,  20, false, 50,   30, '需要 GEMINI_API_KEY；有免費額度'),
  ('openai',       'OpenAI',        'openai', 'gpt-5-mini',          false, 30, false, 30,   40, '需要 OPENAI_API_KEY；依用量計費'),
  ('claude',       'Claude',        'claude', 'claude-haiku-4-5',    false, 40, false, 30,   40, '需要 ANTHROPIC_API_KEY；依用量計費'),
  ('ollama-self',  '自架 Ollama',   'ollama', 'qwen2.5vl:7b',        false, 50, false, null, 60, '需要 OLLAMA_SELF_URL（及 OLLAMA_SELF_TOKEN）')
on conflict (id) do nothing;

-- 還沒有系統預設時，把 Ollama Cloud 設為預設
update public.ai_providers set is_default = true
 where id = 'ollama-cloud'
   and not exists (select 1 from public.ai_providers where is_default);

-- 管理員切換系統預設：一次完成「取消舊的、設定新的」，避免違反唯一索引
create or replace function public.set_default_ai_provider(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ai_providers where id = p_id) then
    raise exception 'provider_not_found';
  end if;
  update public.ai_providers set is_default = false where is_default and id <> p_id;
  update public.ai_providers set is_default = true where id = p_id;
end $$;

-- ---------- 旅程列表的摘要（發票張數、各幣別總額） ----------
-- security invoker：以使用者身分執行，只會算到自己有權限看的旅程
create or replace function public.trip_summaries()
returns table (trip_id uuid, currency text, receipt_count bigint, total numeric)
language sql stable security invoker set search_path = public as $$
  select r.trip_id, r.currency::text, count(*), sum(r.amount)
    from public.receipts r
   group by r.trip_id, r.currency;
$$;

-- ---------- 成員清單（含名稱、頭像） ----------
create or replace function public.trip_member_list(p_trip uuid)
returns table (user_id uuid, role text, joined_at timestamptz, display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, m.joined_at, coalesce(nullif(p.display_name, ''), '（未命名）'), p.avatar_url
    from public.trip_members m
    left join public.profiles p on p.id = m.user_id
   where m.trip_id = p_trip
     and public.trip_role(p_trip) is not null
   order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, m.joined_at;
$$;

-- ---------- AI 使用統計（管理員） ----------
create or replace function public.ai_usage_stats(p_days integer default 30)
returns table (
  provider text, total bigint, success bigint, failed bigint, fallback bigint,
  avg_ms numeric, corrected_ratio numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
  select l.provider,
         count(*),
         count(*) filter (where l.status = 'success'),
         count(*) filter (where l.status <> 'success'),
         count(*) filter (where l.is_fallback and l.status = 'success'),
         round(avg(l.duration_ms) filter (where l.status = 'success')),
         round(avg(case when l.fields_corrected > 0 then 1.0 else 0.0 end)
               filter (where l.status = 'success' and l.fields_corrected is not null), 3)
    from public.ai_scan_logs l
   where l.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
     and l.status <> 'pending'
   group by l.provider
   order by l.provider;
end $$;

-- ---------- 刪除帳號前的檢查 ----------
-- 回傳「自己擁有、但還有其他成員」的旅程；這些旅程要先轉讓，才能刪除帳號
create or replace function public.owned_trips_with_members()
returns table (trip_id uuid, name text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, count(m.user_id)
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
   where t.owner_id = auth.uid()
   group by t.id, t.name
  having count(m.user_id) > 1;
$$;

-- ---------- AI 設定的欄位權限 ----------
-- id 與 adapter 決定金鑰送往哪一家，建立後不能修改（避免把 A 家的金鑰送到 B 家）
revoke update on public.ai_providers from authenticated;
grant update (display_name, model, enabled, fallback_order, daily_limit_per_user, timeout_seconds, note)
  on public.ai_providers to authenticated;

-- ---------- 辨識紀錄：先預留再呼叫，避免同時送出多張繞過每日上限 ----------
alter table public.ai_scan_logs drop constraint ai_scan_logs_status_check;
alter table public.ai_scan_logs add constraint ai_scan_logs_status_check
  check (status in ('pending', 'success', 'failed', 'timeout', 'quota_exceeded', 'invalid_output'));

-- 原子地預留一次使用額度：超過上限回傳 null（只給 Edge Function 使用）
create or replace function public.reserve_ai_scan(p_user uuid, p_trip uuid, p_provider text, p_model text, p_limit integer, p_fallback boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- 同一位使用者的預留依序進行
  perform pg_advisory_xact_lock(hashtext('ai_scan:' || p_user::text));
  if p_limit is not null and (
       select count(*) from public.ai_scan_logs
        where user_id = p_user and provider = p_provider and created_at > now() - interval '24 hours') >= p_limit then
    return null;
  end if;
  insert into public.ai_scan_logs (user_id, trip_id, provider, model, status, is_fallback)
  values (p_user, p_trip, p_provider, p_model, 'pending', p_fallback)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- 刪除帳號：在同一個交易中檢查並刪除只有自己的旅程（只給 Edge Function 使用） ----------
create or replace function public.delete_solo_trips(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_shared text[];
  v_count integer;
begin
  -- 鎖住自己擁有的旅程：期間別人無法透過邀請加入
  perform 1 from public.trips where owner_id = p_user for update;
  select array_agg(t.name order by t.name) into v_shared
    from public.trips t
   where t.owner_id = p_user
     and exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id <> p_user);
  if v_shared is not null then
    return json_build_object('status', 'must_transfer', 'trips', v_shared);
  end if;
  delete from public.trips where owner_id = p_user;
  get diagnostics v_count = row_count;
  return json_build_object('status', 'ok', 'deleted', v_count);
end $$;

revoke all on function public.reserve_ai_scan(uuid, uuid, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.delete_solo_trips(uuid)                                   from public, anon, authenticated;
grant execute on function public.reserve_ai_scan(uuid, uuid, text, text, integer, boolean) to service_role;
grant execute on function public.delete_solo_trips(uuid)                                   to service_role;

-- ---------- 函式執行權限 ----------
revoke all on function public.set_default_ai_provider(text)  from public, anon;
revoke all on function public.trip_summaries()               from public, anon;
revoke all on function public.trip_member_list(uuid)         from public, anon;
revoke all on function public.ai_usage_stats(integer)        from public, anon;
revoke all on function public.owned_trips_with_members()     from public, anon;
grant execute on function public.set_default_ai_provider(text)  to authenticated;
grant execute on function public.trip_summaries()               to authenticated;
grant execute on function public.trip_member_list(uuid)         to authenticated;
grant execute on function public.ai_usage_stats(integer)        to authenticated;
grant execute on function public.owned_trips_with_members()     to authenticated;
