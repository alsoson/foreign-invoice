-- =========================================================
-- 0002_rls.sql：權限輔助函式、RLS、欄位權限、資料庫函式
-- =========================================================

-- 目前使用者在某旅程的角色（不是成員則為 null）
create or replace function public.trip_role(p_trip uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.trip_members
   where trip_id = p_trip and user_id = auth.uid();
$$;

-- 目前使用者對某張發票所屬旅程的角色
create or replace function public.receipt_role(p_receipt uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.trip_role(r.trip_id) from public.receipts r where r.id = p_receipt;
$$;

-- 是否為系統管理員
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 目前使用者是否與某人在同一個旅程（用來顯示成員名稱、頭像）
create or replace function public.shares_trip_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.trip_members a
      join public.trip_members b on a.trip_id = b.trip_id
     where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ---------- 開啟 RLS ----------
alter table public.ai_providers  enable row level security;
alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.receipts      enable row level security;
alter table public.receipt_items enable row level security;
alter table public.ai_scan_logs  enable row level security;

-- ---------- 基本存取權限 ----------
-- 新版 Supabase 專案可能不會自動把資料表開放給前端 API，這裡明確授權。
-- 實際能讀寫哪些資料列，仍由下方的 RLS 規則決定。
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.ai_providers to anon;   -- 給每週喚醒用；anon 沒有 RLS 規則，實際讀不到任何資料

-- ---------- ai_providers ----------
create policy ai_providers_select on public.ai_providers for select to authenticated
  using (enabled or public.is_admin());
create policy ai_providers_admin on public.ai_providers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- profiles ----------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- 只能改這些欄位（不能自己把 is_admin 改成 true）
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, default_currency, locale, preferred_ai_provider)
  on public.profiles to authenticated;

-- ---------- trips ----------
-- owner_id = auth.uid() 讓「新增後立即讀回」在擁有者成員資料寫入前也能成功
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.trip_role(id) is not null);
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.trip_role(id) in ('owner', 'editor'))
  with check (public.trip_role(id) in ('owner', 'editor'));
create policy trips_delete on public.trips for delete to authenticated
  using (public.trip_role(id) = 'owner');
-- owner_id 只能透過 transfer_trip_owner 變更
revoke update on public.trips from authenticated;
grant update (name, country, start_date, end_date, default_currency, default_ai_provider, budget, note)
  on public.trips to authenticated;

-- ---------- trip_members ----------
create policy members_select on public.trip_members for select to authenticated
  using (public.trip_role(trip_id) is not null);
-- 擁有者可以調整其他成員的角色（不能用這個方式產生第二位擁有者）
create policy members_update on public.trip_members for update to authenticated
  using (public.trip_role(trip_id) = 'owner' and role <> 'owner')
  with check (role in ('editor', 'viewer'));
-- 擁有者可以移除其他成員；成員可以自行退出（擁有者要先轉讓）
create policy members_delete on public.trip_members for delete to authenticated
  using (
    (public.trip_role(trip_id) = 'owner' and role <> 'owner')
    or (user_id = auth.uid() and role <> 'owner')
  );
-- 不開放直接新增：只能透過建立旅程的觸發器或 accept_invite
revoke update on public.trip_members from authenticated;
grant update (role) on public.trip_members to authenticated;

-- ---------- receipts ----------
create policy receipts_select on public.receipts for select to authenticated
  using (public.trip_role(trip_id) is not null);
create policy receipts_insert on public.receipts for insert to authenticated
  with check (public.trip_role(trip_id) in ('owner', 'editor'));
-- 移動到其他旅程時，新舊兩個旅程都必須有編輯權限
create policy receipts_update on public.receipts for update to authenticated
  using (public.trip_role(trip_id) in ('owner', 'editor'))
  with check (public.trip_role(trip_id) in ('owner', 'editor'));
create policy receipts_delete on public.receipts for delete to authenticated
  using (public.trip_role(trip_id) in ('owner', 'editor'));

-- ---------- receipt_items ----------
create policy items_select on public.receipt_items for select to authenticated
  using (public.receipt_role(receipt_id) is not null);
create policy items_insert on public.receipt_items for insert to authenticated
  with check (public.receipt_role(receipt_id) in ('owner', 'editor'));
create policy items_update on public.receipt_items for update to authenticated
  using (public.receipt_role(receipt_id) in ('owner', 'editor'))
  with check (public.receipt_role(receipt_id) in ('owner', 'editor'));
create policy items_delete on public.receipt_items for delete to authenticated
  using (public.receipt_role(receipt_id) in ('owner', 'editor'));

-- ---------- ai_scan_logs ----------
-- 新增由 Edge Function 以 service role 寫入（不受 RLS 限制）
create policy scan_logs_select on public.ai_scan_logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy scan_logs_update on public.ai_scan_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.ai_scan_logs from authenticated;
grant update (receipt_id, fields_corrected) on public.ai_scan_logs to authenticated;

-- =========================================================
-- 資料庫函式
-- =========================================================

-- 在同一個交易中儲存發票與品項（新增或修改）
-- 修改時可帶 expected_updated_at，若別人已先修改則回傳 receipt_conflict
-- security invoker：以使用者身分執行，RLS 照常生效
create or replace function public.save_receipt(p_receipt jsonb, p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p_receipt ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.receipts (
      trip_id, receipt_date, store_name_original, store_name_translated, category,
      currency, amount, payment_method, paid_by, raw_text, ai_provider, ai_model, note)
    values (
      (p_receipt ->> 'trip_id')::uuid,
      (p_receipt ->> 'receipt_date')::date,
      p_receipt ->> 'store_name_original',
      p_receipt ->> 'store_name_translated',
      coalesce(p_receipt ->> 'category', 'other'),
      upper(p_receipt ->> 'currency'),
      (p_receipt ->> 'amount')::numeric,
      coalesce(p_receipt ->> 'payment_method', 'other'),
      nullif(p_receipt ->> 'paid_by', '')::uuid,
      p_receipt ->> 'raw_text',
      coalesce(p_receipt ->> 'ai_provider', 'manual'),
      p_receipt ->> 'ai_model',
      p_receipt ->> 'note')
    returning id into v_id;
  else
    -- 衝突檢查：別人已在你載入之後修改過
    if p_receipt ? 'expected_updated_at' and exists (
         select 1 from public.receipts
          where id = v_id
            and updated_at <> (p_receipt ->> 'expected_updated_at')::timestamptz) then
      raise exception 'receipt_conflict' using errcode = '40001';
    end if;

    update public.receipts set
      trip_id               = (p_receipt ->> 'trip_id')::uuid,
      receipt_date          = (p_receipt ->> 'receipt_date')::date,
      store_name_original   = p_receipt ->> 'store_name_original',
      store_name_translated = p_receipt ->> 'store_name_translated',
      category              = coalesce(p_receipt ->> 'category', 'other'),
      currency              = upper(p_receipt ->> 'currency'),
      amount                = (p_receipt ->> 'amount')::numeric,
      payment_method        = coalesce(p_receipt ->> 'payment_method', 'other'),
      paid_by               = nullif(p_receipt ->> 'paid_by', '')::uuid,
      raw_text              = p_receipt ->> 'raw_text',
      note                  = p_receipt ->> 'note'
    where id = v_id;
    if not found then
      raise exception 'receipt_not_found_or_forbidden' using errcode = '42501';
    end if;
    delete from public.receipt_items where receipt_id = v_id;
  end if;

  insert into public.receipt_items (
    receipt_id, sort_order, name_original, name_translated, quantity, unit_price, subtotal)
  select v_id, (t.ord - 1)::int,
         t.e ->> 'name_original', t.e ->> 'name_translated',
         coalesce((t.e ->> 'quantity')::numeric, 1),
         (t.e ->> 'unit_price')::numeric, (t.e ->> 'subtotal')::numeric
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  return v_id;
end $$;

-- 轉讓旅程擁有者
create or replace function public.transfer_trip_owner(p_trip uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.trip_role(p_trip) is distinct from 'owner' then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'already_owner';
  end if;
  if not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_new_owner) then
    raise exception 'not_member';
  end if;
  update public.trip_members set role = 'editor' where trip_id = p_trip and user_id = auth.uid();
  update public.trip_members set role = 'owner'  where trip_id = p_trip and user_id = p_new_owner;
  update public.trips set owner_id = p_new_owner where id = p_trip;
end $$;

revoke all on function public.save_receipt(jsonb, jsonb)          from public, anon;
revoke all on function public.transfer_trip_owner(uuid, uuid)      from public, anon;
grant execute on function public.save_receipt(jsonb, jsonb)        to authenticated;
grant execute on function public.transfer_trip_owner(uuid, uuid)   to authenticated;

-- ---------- 即時同步 ----------
alter publication supabase_realtime add table public.receipts, public.receipt_items, public.trip_members;
