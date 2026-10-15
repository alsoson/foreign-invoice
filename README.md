# foreign-invoice

旅遊發票統計系統。前端 React＋Vite（PWA），後端 Supabase，部署在 GitHub Pages。

詳細文件放在 [`docs/`](docs/README.md)。修改版面前請先看 [RWD 規則](docs/rwd-guidelines.md)。

目前進度：**階段 0（專案骨架）** — Google 登入、旅程列表、新增旅程、個人設定、手機版版面、PWA、自動部署。

## 專案結構

```
foreign-invoice/
├─ .github/workflows/deploy-web.yml   # 推送到 main 後自動部署到 GitHub Pages
├─ .github/workflows/deploy-db.yml    # migration 有變更時自動推到 Supabase
├─ public/icons/                      # App 圖示
├─ src/
│  ├─ main.tsx、App.tsx               # 進入點與路由（Hash 路由）
│  ├─ auth/AuthProvider.tsx           # 登入狀態、Google 登入
│  ├─ components/                     # 版面、登入保護、載入動畫
│  ├─ lib/supabase.ts                 # Supabase 連線
│  ├─ lib/inAppBrowser.ts             # 偵測 LINE 等內建瀏覽器
│  └─ pages/                          # 登入、旅程列表、個人設定
├─ supabase/                          # 資料庫 migration（Supabase CLI）
├─ docs/                              # 專案文件（設定說明、操作手冊）
├─ .env.example                       # 環境變數範本
├─ index.html、vite.config.ts、package.json
```

## 一、在電腦上執行

需要先安裝 [Node.js](https://nodejs.org)（LTS 版）。

1. 安裝套件：

   ```bash
   npm install
   ```

2. 設定 Supabase 連線：把 `.env.example` 複製一份，改名為 `.env.local`，填入：
   - `VITE_SUPABASE_URL`：已填好 `https://yzzbilxzpjyhxgiilzaw.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`：Supabase 後台 → **Project Settings** → **API Keys**，複製 **anon**（或 **publishable**，`sb_publishable_` 開頭）的金鑰
   - **不要**使用 service_role 或 secret key

3. Supabase 後台 → **Authentication** → **URL Configuration**：
   - **Site URL**：`https://<你的 GitHub 帳號>.github.io/foreign-invoice/`
   - **Redirect URLs** 加入：
     - `http://localhost:5173/`
     - `https://<你的 GitHub 帳號>.github.io/foreign-invoice/`

4. 啟動：

   ```bash
   npm run dev
   ```

   瀏覽器打開 `http://localhost:5173`，按「使用 Google 帳號登入」。

5. 登入後試著新增一個旅程，能出現在列表上，就代表登入、資料庫、權限都正常。

## 二、部署到 GitHub Pages

1. 推上 GitHub：

   ```bash
   git init
   git add .
   git commit -m "階段 0：專案骨架"
   git branch -M main
   git remote add origin https://github.com/<你的帳號>/foreign-invoice.git
   git push -u origin main
   ```

   `.env.local` 已被 `.gitignore` 排除，不會上傳。

2. GitHub repo → **Settings** → **Pages** → **Source** 選 **GitHub Actions**。

3. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** 分頁 → **New repository variable**，新增兩個：

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://yzzbilxzpjyhxgiilzaw.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | 和 `.env.local` 相同的 anon key |

4. 到 **Actions** 分頁，執行 **Deploy Web**（或再推一次程式），完成後網站在：
   `https://<你的帳號>.github.io/foreign-invoice/`

## 三、在手機上使用

用手機瀏覽器打開上面的網址並登入，然後加到主畫面，就能像 App 一樣使用：

- **iPhone（Safari）**：分享按鈕 → 加入主畫面
- **Android（Chrome）**：右上角選單 → 安裝應用程式／加到主畫面

> 從 LINE 點開連結時，會用 LINE 的內建瀏覽器，Google 不允許在那裡登入。畫面會提示改用外部瀏覽器開啟。

## 四、資料庫（Supabase CLI）

Supabase CLI 已列在開發套件中，`npm install` 後即可用 `npx supabase` 執行。

| 指令 | 用途 |
| --- | --- |
| `npx supabase login` | 登入 Supabase（第一次） |
| `npx supabase link --project-ref yzzbilxzpjyhxgiilzaw` | 連結雲端專案（每台電腦第一次） |
| `npx supabase migration list` | 查看本機與雲端已套用的 migration |
| `npx supabase migration new <名稱>` | 新增 migration 檔 |
| `npx supabase db push` | 把尚未套用的 migration 推到雲端 |

推送到 `main` 後會自動套用 migration，設定方式見 [docs/github-supabase-setup.md](docs/github-supabase-setup.md)。

規則：

- 已套用過的 migration 檔**不要修改**，要改就新增一個新的。
- 資料庫密碼、Supabase access token、service_role key 不要放進 repo。
