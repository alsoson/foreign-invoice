-- =========================================================
-- 0001_core.sql：核心資料表
-- =========================================================

-- AI 服務設定（先建立，其他表會參照）
create table public.ai_providers (
  id                   text primary key,          -- ollama-cloud / ollama-self / gemini / openai / claude
  display_name         text not null,
  adapter              text not null check (adapter in ('ollama', 'gemini', 'openai', 'claude')),
  model                text not null,
  enabled              boolean not null default false,
  fallback_order       integer not null default 100,
  is_default           boolean not null default false,
  daily_limit_per_user integer check (daily_limit_per_user is null or daily_limit_per_user > 0),
  timeout_seconds      integer not null default 25 check (timeout_seconds between 5 and 60),
  note                 text,
  updated_at           timestamptz not null default now()
);
-- 系統預設只能有一個
create unique index ai_providers_one_default on public.ai_providers (is_default) where is_default;

-- 使用者資料
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  display_name          text not null default '',
  avatar_url            text,
  default_currency      char(3) not null default 'TWD' check (default_currency ~ '^[A-Z]{3}$'),
  locale                text not null default 'zh-TW',
  preferred_ai_provider text references public.ai_providers(id) on delete set null,
  is_admin              boolean not null default false,
  created_at            timestamptz not null default now()
);

-- 旅程
create table public.trips (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id),
  name                text not null check (char_length(name) between 1 and 100),
  country             text,
  start_date          date,
  end_date            date,
  default_currency    char(3) not null default 'TWD' check (default_currency ~ '^[A-Z]{3}$'),
  default_ai_provider text references public.ai_providers(id) on delete set null,
  budget              numeric(18, 2) check (budget is null or budget >= 0),
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (start_date is null or end_date is null or end_date >= start_date)
);

-- 旅程成員
create table public.trip_members (
  trip_id   uuid not null references public.trips(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
-- 每個旅程只能有一位擁有者
create unique index trip_members_one_owner on public.trip_members (trip_id) where role = 'owner';
create index trip_members_user_idx on public.trip_members (user_id);

-- 發票
create table public.receipts (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.trips(id) on delete cascade,
  receipt_date          date not null,
  store_name_original   text,
  store_name_translated text,
  category              text not null default 'other'
                        check (category in ('food', 'transport', 'lodging', 'shopping', 'ticket', 'other')),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount                numeric(18, 3) not null check (amount >= 0),
  payment_method        text not null default 'other'
                        check (payment_method in ('cash', 'credit_card', 'e_payment', 'other')),
  paid_by               uuid references auth.users(id) on delete set null,
  raw_text              text,
  ai_provider           text,              -- 'manual' 表示手動輸入
  ai_model              text,
  note                  text,
  created_by            uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index receipts_trip_date_idx on public.receipts (trip_id, receipt_date);

-- 品項明細
create table public.receipt_items (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.receipts(id) on delete cascade,
  sort_order      integer not null default 0,
  name_original   text,
  name_translated text,
  quantity        numeric(12, 3) not null default 1,
  unit_price      numeric(18, 3),
  subtotal        numeric(18, 3)            -- 折扣可為負數
);
create index receipt_items_receipt_idx on public.receipt_items (receipt_id, sort_order);

-- AI 辨識紀錄
create table public.ai_scan_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  trip_id          uuid references public.trips(id) on delete set null,
  receipt_id       uuid references public.receipts(id) on delete set null,
  provider         text not null,
  model            text,
  status           text not null check (status in ('success', 'failed', 'timeout', 'quota_exceeded', 'invalid_output')),
  is_fallback      boolean not null default false,
  duration_ms      integer,
  fields_corrected integer,                 -- 存檔前使用者改了幾個欄位
  error_message    text,
  created_at       timestamptz not null default now()
);
create index ai_scan_logs_user_day_idx on public.ai_scan_logs (user_id, provider, created_at);

-- =========================================================
-- 觸發器
-- =========================================================

-- 第一次登入時自動建立 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 建立旅程時，自動把建立者加為擁有者
create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger trips_add_owner
  after insert on public.trips
  for each row execute function public.add_trip_owner();

-- 更新時間
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();
create trigger ai_providers_touch before update on public.ai_providers
  for each row execute function public.touch_updated_at();

-- 發票：更新時間與最後修改者
create or replace function public.touch_receipt()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger receipts_touch before update on public.receipts
  for each row execute function public.touch_receipt();
