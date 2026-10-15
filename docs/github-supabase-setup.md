# GitHub 與 Supabase 連動設定

推送程式到 GitHub 的 `main` 分支後，會自動執行以下工作：

| Workflow | 觸發條件 | 做什麼 |
| --- | --- | --- |
| `.github/workflows/deploy-web.yml`（Deploy Web） | `main` 有推送（只改 `supabase/**`、`docs/**`、`*.md` 時不執行） | 建置網站並部署到 GitHub Pages，建置時帶入 Supabase 網址與金鑰 |
| `.github/workflows/deploy-db.yml`（Deploy Supabase） | `main` 的 `supabase/**` 有變更 | 執行 `supabase db push` 套用新的 migration，再部署 Edge Functions（`scan-receipt`、`delete-account`） |

兩個 workflow 都可以到 GitHub repo 的 **Actions** 分頁手動執行。

> 只修改文件（`docs/` 資料夾或任何 `.md` 檔）時，兩個 workflow 都不會執行，網站不會重新部署。
> 但如果同一次推送裡還包含其他檔案（例如程式碼），網站仍會部署。

Supabase 專案 ID：`yzzbilxzpjyhxgiilzaw`

---

## 設定步驟

### 1. 把專案推上 GitHub

先在 GitHub 建立一個名為 `foreign-invoice` 的空 repo，然後在專案資料夾執行：

```bash
git init
git add .
git commit -m "階段 0：專案骨架"
git branch -M main
git remote add origin https://github.com/<你的帳號>/foreign-invoice.git
git push -u origin main
```

`.env.local` 已被 `.gitignore` 排除，不會上傳。

### 2. 開啟 GitHub Pages

GitHub repo → **Settings** → **Pages** → **Source** 選 **GitHub Actions**。

### 3. 設定 Variables（網站建置用）

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** 分頁 → **New repository variable**：

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://yzzbilxzpjyhxgiilzaw.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase 後台 → **Project Settings** → **API Keys** 的 anon（或 `sb_publishable_` 開頭）金鑰 |

這兩個值本來就會出現在網站程式裡，可以公開；資料安全由資料庫的 RLS 規則保護。

### 4. 設定 Secrets（資料庫 migration 用）

同一頁切到 **Secrets** 分頁 → **New repository secret**：

| Name | 取得位置 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase 後台右上角頭像 → **Account preferences** → **Access Tokens** → **Generate new token** |
| `SUPABASE_DB_PASSWORD` | 建立 Supabase 專案時設定的資料庫密碼（忘記可在 **Project Settings** → **Database** 重設） |

> ⚠️ 這兩個是機密，只能放在 **Secrets**，不要放進 Variables 或程式碼。service_role key 也不要放進 repo。

### 4-1. 設定 AI 辨識的金鑰

拍照辨識需要至少一家 AI 服務的金鑰，設定方式見 [ai-setup.md](ai-setup.md)。沒有設定時，網站其他功能（手動記帳、統計、匯出、分享）都能正常使用。

### 5. 設定 Supabase 登入返回網址

Supabase 後台 → **Authentication** → **URL Configuration**：

- **Site URL**：`https://<你的帳號>.github.io/foreign-invoice/`
- **Redirect URLs** 加入：
  - `http://localhost:5173/`
  - `https://<你的帳號>.github.io/foreign-invoice/`

### 6. 確認是否成功

1. 到 **Actions** 分頁，手動執行 **Deploy Web** 和 **Deploy Supabase**，兩個都要是綠色勾勾。
2. **Deploy Supabase** 的「顯示 migration 狀態」步驟中，本機與雲端的 migration 應該一致。
3. 打開 `https://<你的帳號>.github.io/foreign-invoice/`，用 Google 登入並新增一個旅程，能出現在列表就代表全部正常。

---

## 之後怎麼改資料庫

```bash
npx supabase migration new <名稱>   # 產生新的 migration 檔
# 編輯 supabase/migrations/ 底下新產生的 .sql
git add . && git commit -m "說明" && git push
```

推上去後 **Deploy Supabase** 會自動套用，不用再手動 `npx supabase db push`。修改 `supabase/functions/` 底下的程式也一樣，推上去就會重新部署 Edge Functions。

規則：

- 已套用過的 migration 檔**不要修改**，要改就新增一個新的。
- 同時改了網站和資料庫時，兩個 workflow 會各自執行；如果新版網站依賴新的資料表，可能有幾十秒網站先上線、資料庫還沒更新的空檔。

## 常見問題

| 狀況 | 原因與處理 |
| --- | --- |
| Deploy Supabase 在「部署 Edge Functions」失敗 | 確認 `SUPABASE_ACCESS_TOKEN` 的帳號對這個專案有權限，並查看錯誤訊息是哪一個 function 的程式有問題 |
| Deploy Supabase 在「連結 Supabase 專案」失敗 | `SUPABASE_ACCESS_TOKEN` 錯誤或過期，重新產生並更新 Secret |
| `password authentication failed` | `SUPABASE_DB_PASSWORD` 錯誤，到 Supabase 重設密碼後更新 Secret |
| `Remote migration versions not found in local migrations directory` | 有人直接在 Supabase 後台改過資料庫或刪了本機 migration 檔，需用 `npx supabase migration repair` 對齊 |
| 網站打開是空白或顯示未設定 Supabase | Variables 沒設定好，設定後重新執行 Deploy Web |
| Google 登入後跳回錯誤頁面 | 第 5 步的 Redirect URLs 沒加或網址打錯（結尾要有 `/`） |
