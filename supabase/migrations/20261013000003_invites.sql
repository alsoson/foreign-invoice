-- =========================================================
-- 0003_invites.sql：邀請連結
-- =========================================================

create table public.trip_invites (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  code        text not null unique,
  role        text not null check (role in ('editor', 'viewer')),
  label       text check (label is null or char_length(label) <= 50),
  expires_at  timestamptz not null,
  max_uses    integer check (max_uses is null or max_uses > 0),   -- null = 不限次數
  used_count  integer not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked     boolean not null default false,
  revoked_at  timestamptz
);
create index trip_invites_trip_idx on public.trip_invites (trip_id);

-- 誰透過哪個連結加入
create table public.trip_invite_uses (
  invite_id uuid not null references public.trip_invites(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  used_at   timestamptz not null default now(),
  primary key (invite_id, user_id)
);

-- 邀請碼輸入錯誤紀錄（防止猜測）
create table public.invite_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index invite_attempts_user_idx on public.invite_attempts (user_id, attempted_at);

alter table public.trip_invites     enable row level security;
alter table public.trip_invite_uses enable row level security;
alter table public.invite_attempts  enable row level security;   -- 沒有任何 policy = 一般使用者完全不能存取

-- 只有擁有者能查看邀請；只能改標籤與作廢
create policy invites_select on public.trip_invites for select to authenticated
  using (public.trip_role(trip_id) = 'owner');
create policy invites_update on public.trip_invites for update to authenticated
  using (public.trip_role(trip_id) = 'owner')
  with check (public.trip_role(trip_id) = 'owner');
grant select on public.trip_invites, public.trip_invite_uses to authenticated;
revoke insert, update, delete on public.trip_invites from authenticated;
grant update (label, revoked, revoked_at) on public.trip_invites to authenticated;

create policy invite_uses_select on public.trip_invite_uses for select to authenticated
  using (public.trip_role((select i.trip_id from public.trip_invites i where i.id = invite_id)) = 'owner');

-- ---------- 輔助函式 ----------

-- 產生 8 碼邀請碼（排除 0 O 1 I L）
create or replace function public.gen_invite_code()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- 31 個字元
  v text;
begin
  loop
    select string_agg(substr(chars, (get_byte(gen_random_bytes(1), 0) % 31) + 1, 1), '')
      into v
      from generate_series(1, 8);
    exit when not exists (select 1 from public.trip_invites where code = v);
  end loop;
  return v;
end $$;

-- 邀請連結目前的狀態
create or replace function public.invite_status(p public.trip_invites)
returns text language sql stable as $$
  select case
    when p.revoked then 'revoked'
    when p.expires_at <= now() then 'expired'
    when p.max_uses is not null and p.used_count >= p.max_uses then 'used_up'
    else 'valid'
  end;
$$;

-- 1 小時內錯誤 10 次以上就暫時鎖定
create or replace function public.invite_attempts_exceeded(p_user uuid)
returns boolean language sql volatile security definer set search_path = public as $$
  delete from public.invite_attempts
   where user_id = p_user and attempted_at < now() - interval '1 day';
  select count(*) >= 10 from public.invite_attempts
   where user_id = p_user and attempted_at > now() - interval '1 hour';
$$;

-- 正規化使用者輸入的邀請碼
create or replace function public.normalize_invite_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- ---------- 建立邀請（擁有者） ----------
create or replace function public.create_invite(
  p_trip     uuid,
  p_role     text    default 'editor',
  p_days     integer default 7,
  p_max_uses integer default 10,
  p_label    text    default null)
returns public.trip_invites
language plpgsql security definer set search_path = public as $$
declare
  v public.trip_invites;
begin
  if public.trip_role(p_trip) is distinct from 'owner' then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid_role';
  end if;
  if p_days not between 1 and 90 then
    raise exception 'invalid_days';
  end if;
  if (select count(*) from public.trip_invites i
       where i.trip_id = p_trip and public.invite_status(i) = 'valid') >= 20 then
    raise exception 'too_many_active_invites';
  end if;

  insert into public.trip_invites (trip_id, code, role, label, expires_at, max_uses, created_by)
  values (p_trip, public.gen_invite_code(), p_role, nullif(trim(p_label), ''),
          now() + make_interval(days => p_days), p_max_uses, auth.uid())
  returning * into v;
  return v;
end $$;

-- ---------- 預覽邀請（需登入） ----------
create or replace function public.get_invite_preview(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_inv     public.trip_invites;
  v_trip    public.trips;
  v_status  text;
  v_inviter text;
begin
  if v_uid is null then
    return json_build_object('status', 'not_logged_in');
  end if;
  if public.invite_attempts_exceeded(v_uid) then
    return json_build_object('status', 'too_many_attempts');
  end if;

  select * into v_inv from public.trip_invites where code = public.normalize_invite_code(p_code);
  if not found then
    insert into public.invite_attempts (user_id) values (v_uid);
    return json_build_object('status', 'not_found');
  end if;

  if exists (select 1 from public.trip_members where trip_id = v_inv.trip_id and user_id = v_uid) then
    return json_build_object('status', 'already_member', 'trip_id', v_inv.trip_id);
  end if;

  v_status := public.invite_status(v_inv);
  if v_status <> 'valid' then
    return json_build_object('status', v_status);       -- 無效時不透露旅程資訊
  end if;

  select * into v_trip from public.trips where id = v_inv.trip_id;
  select display_name into v_inviter from public.profiles where id = v_inv.created_by;

  return json_build_object(
    'status',       'valid',
    'trip_name',    v_trip.name,
    'start_date',   v_trip.start_date,
    'end_date',     v_trip.end_date,
    'inviter_name', v_inviter,
    'role',         v_inv.role,
    'expires_at',   v_inv.expires_at);
end $$;

-- ---------- 接受邀請 ----------
create or replace function public.accept_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_inv    public.trip_invites;
  v_role   text;
  v_status text;
begin
  if v_uid is null then
    return json_build_object('status', 'not_logged_in');
  end if;
  if public.invite_attempts_exceeded(v_uid) then
    return json_build_object('status', 'too_many_attempts');
  end if;

  -- 鎖住這筆邀請：兩人同時加入時，第二人會等第一人完成後再判斷次數
  select * into v_inv from public.trip_invites
   where code = public.normalize_invite_code(p_code)
   for update;

  if not found then
    insert into public.invite_attempts (user_id) values (v_uid);
    return json_build_object('status', 'not_found');
  end if;

  -- 已經是成員：不扣次數
  select role into v_role from public.trip_members
   where trip_id = v_inv.trip_id and user_id = v_uid;
  if found then
    return json_build_object('status', 'already_member', 'trip_id', v_inv.trip_id, 'role', v_role);
  end if;

  v_status := public.invite_status(v_inv);
  if v_status <> 'valid' then
    return json_build_object('status', v_status);
  end if;

  insert into public.trip_members (trip_id, user_id, role) values (v_inv.trip_id, v_uid, v_inv.role);
  insert into public.trip_invite_uses (invite_id, user_id) values (v_inv.id, v_uid);
  update public.trip_invites set used_count = used_count + 1 where id = v_inv.id;

  return json_build_object('status', 'joined', 'trip_id', v_inv.trip_id, 'role', v_inv.role);
end $$;

-- ---------- 函式執行權限 ----------
revoke all on function public.create_invite(uuid, text, integer, integer, text) from public, anon;
revoke all on function public.get_invite_preview(text)                         from public, anon;
revoke all on function public.accept_invite(text)                              from public, anon;
revoke all on function public.gen_invite_code()                                from public, anon, authenticated;
revoke all on function public.invite_attempts_exceeded(uuid)                   from public, anon, authenticated;
grant execute on function public.create_invite(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.get_invite_preview(text)                         to authenticated;
grant execute on function public.accept_invite(text)                              to authenticated;
