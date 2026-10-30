-- =========================================================
-- 0005_default_trip.sql：預設旅程
-- 設定後，打開 App 會直接進到這個旅程的「拍照辨識」畫面。
-- 存在 profiles，手機與電腦同步；旅程被刪除時自動清空。
-- =========================================================

alter table public.profiles
  add column default_trip_id uuid references public.trips(id) on delete set null;

-- 使用者可以修改自己的預設旅程（profiles_update 規則已限制只能改自己的資料）
grant update (default_trip_id) on public.profiles to authenticated;
