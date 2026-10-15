# 旅遊發票統計紀錄系統：架構建議

> 目標：網站與 App 共用一套系統、部署在 GitHub、使用雲端資料庫
> 功能：拍照上傳、外文翻譯、資料修正儲存、分析並匯出 Excel
> 前提：**不保存圖片**，照片只在辨識時使用；**不做匯率換算**，金額以原幣別記錄
> 統計：以**一次旅遊（旅程）**為單位進行統計與匯出
> 帳號：**只用 Google 等第三方登入**，網站與 App 共用同一組帳號；**系統不寄任何 Email**
> 分享：旅程透過 **LINE 等通訊軟體傳邀請連結**分享給其他人，一起查看、新增、修正

---

## 1. 推薦架構總覽

**GitHub Pages（PWA 前端）＋ Supabase（資料庫、登入、Edge Function）＋ SheetJS（匯出 Excel）**

| 層級 | 推薦方案 | 說明 |
|---|---|---|
| 前端（網站＋App） | **PWA**（React 或 Vue + Vite） | 一套程式。手機可以「加到主畫面」，用起來像 App，也能直接開相機。之後要上架 App Store／Google Play，再用 **Capacitor** 包成原生 App |
| 部署 | **GitHub Pages + GitHub Actions** | 推送程式碼後自動建置與發佈，免費 |
| 雲端資料庫 | **Supabase** | PostgreSQL 資料庫＋登入驗證＋Edge Functions，前端可以直接呼叫 |
| 登入與帳號 | **Supabase Auth（只開第三方登入）** | Google 登入為主，iOS 上架時加 Apple 登入；不用密碼、不寄信。詳見第 5 節 |
| 分享與共同編輯 | **邀請連結（LINE 分享）＋旅程成員＋RLS**，搭配 **Supabase Realtime** | 用 LINE 傳邀請連結；資料庫依成員身分控管權限；其他成員的新增、修改會即時同步到畫面上 |
| 拍照辨識（OCR） | **多個 AI 共存**：Ollama Cloud（免費起步）、Gemini、OpenAI、Claude、自架 Ollama 可同時啟用，可以自選、自動備援、比對；另有不用 AI 的 Tesseract／ML Kit | 多模態 AI 可以一次完成「讀發票→翻譯→整理成欄位」。詳見第 3 節 |
| 外文翻譯 | 跟辨識合併處理，或另外接 Google Translate／DeepL API | 日、韓、泰文及歐洲語系的收據都能處理 |
| 匯出 Excel | **SheetJS（xlsx）** | 在瀏覽器直接產生 .xlsx，不需要後端；可以單獨匯出一次旅程 |
| 分析圖表 | Chart.js 或 Recharts | 以旅程為單位，依類別、日期、幣別、付款方式統計 |

**安全提醒：** GitHub Pages 是公開的靜態網站，OCR、翻譯、AI 的 API 金鑰**不能寫在前端**。金鑰要放在 Supabase Edge Function 中，由它代為呼叫外部服務。

---

## 2. 系統流程

```
建立／選擇旅程（例如：2026 東京行）
   ↓
拍照／選擇照片
   ↓（前端壓縮圖片）
Supabase Edge Function
   ↓ 呼叫 AI：辨識＋翻譯＋整理成結構化欄位
回傳 JSON 給前端（照片用完就丟，不保存）
   ↓
使用者檢視、修正欄位
   ↓
存入 Supabase 資料庫（歸屬到目前選擇的旅程）
   ↓
旅程統計頁 → 匯出該旅程的 Excel
```

---

## 3. AI 辨識與翻譯方案

### 3.1 設計原則：多個 AI 同時共存

系統**同時啟用多個 AI 服務**，不是只能選一家。所有辨識請求都經過同一個 Supabase Edge Function（`scan-receipt`），由它依設定決定呼叫哪一家：

```
前端（帶上 provider，或不帶就用預設）
   ↓
Edge Function：scan-receipt
   ├─ Adapter：ollama-cloud
   ├─ Adapter：ollama-self
   ├─ Adapter：gemini
   ├─ Adapter：openai
   └─ Adapter：claude
   ↓
統一格式的 JSON（見 3.4）
```

**Adapter 架構：** 每家服務寫成一個獨立的 Adapter，負責把照片和提示詞轉成該服務的 API 格式，再把回應轉成統一的 JSON。新增一家 AI 只要多寫一個 Adapter，並在設定表加一筆資料，前端和其他 Adapter 都不用改。

#### 共存的使用方式

| 功能 | 說明 |
|---|---|
| **每次辨識時自選** | 拍照畫面有下拉選單，可以選這次要用哪個 AI（只列出已啟用的服務） |
| **預設 AI 的優先順序** | 沒有指定時：個人預設 → 旅程預設 → 系統預設。例如去日本的旅程預設 Gemini，個人平常用 Ollama Cloud |
| **自動備援** | 依設定的順序嘗試，例如 Ollama Cloud → Gemini → OpenAI。前一家額度用完、逾時或回傳格式錯誤，就自動改用下一家，並在結果上標示實際用了哪一家 |
| **重新辨識** | 對結果不滿意時，按「換一個 AI 重新辨識」，選另一家再跑一次 |
| **手動編輯修正** | 不想重新辨識時，直接在結果表單上修改任何欄位（日期、店名原文／譯文、類別、幣別、金額、付款方式、品項），也可以新增或刪除品項。存檔前後都可以修改 |
| **比對模式**（選用） | 同時送給兩家 AI，畫面並排顯示結果；兩家不一致的欄位會標成黃色，讓使用者挑正確的 |
| **管理員開關** | 系統管理員可以在後台啟用／停用某一家、調整備援順序、設定每人每日使用上限，不用重新部署 |

#### 其他原則

- 所有 API 金鑰都存在 Supabase Secrets，**不放在前端**，也不存在資料表裡。
- 每次辨識都記錄用了哪一家、哪個模型、花多少時間、成功或失敗（見第 6 節 `ai_scan_logs`），方便比較哪家最準、最快。
- 保留「手動輸入」功能，所有 AI 服務都不能用時仍然可以記帳。

### 3.2 各方案比較

| 方案 | 費用 | 需要硬體 | 辨識＋翻譯效果 | 適合情境 |
|---|---|---|---|---|
| **Ollama Cloud** | 免費起步，可升級付費 | 不需要 | 好 | 想免費開始、不想自架 |
| **Google Gemini API** | 有免費額度，超過依用量計費 | 不需要 | 很好，多語言收據表現佳 | 想要穩定、價格低 |
| **OpenAI API** | 依用量計費，沒有免費額度 | 不需要 | 很好 | 已有 OpenAI 帳號 |
| **Anthropic Claude API** | 依用量計費 | 不需要 | 很好，擅長整理成結構化資料 | 已有 Claude 帳號 |
| **自架 Ollama** | 免費（電費） | 建議 8GB 以上 VRAM 的顯示卡 | 好 | 資料不能離開公司 |
| **Tesseract.js／ML Kit**（不用 AI） | 免費 | 不需要 | 普通，只能讀出文字 | 完全零成本、可離線 |

> 價格與免費額度會變動，正式採用前請到各官方網站確認。

### 3.3 各方案說明

**A. Ollama Cloud（建議先用）**
- 到 ollama.com 註冊，在 Settings → API Keys 建立金鑰，免費方案不需要信用卡。
- API 網址：`https://ollama.com/api/chat`，照片轉成 base64 放進 `images` 欄位。
- 模型：在 [ollama.com/search](https://ollama.com/search?c=cloud) 同時篩選 **cloud** 和 **vision**，選支援圖片的模型（例如 qwen3-vl 系列）。
- 注意：免費額度沒有公開具體數字，只有每次工作階段和每週的上限；發票資料會傳到 Ollama 的雲端處理。
- 呼叫格式跟本機 Ollama 相同，之後要改成自架只需換網址。

**B. Google Gemini API**
- 到 Google AI Studio 申請 API 金鑰。
- 建議用 **Flash 系列**模型，速度快、成本低，支援圖片輸入，也能設定回傳 JSON 格式。
- 注意：免費方案的資料可能會被 Google 用來改善產品，有隱私考量時請使用付費方案。

**C. OpenAI API**
- 到 platform.openai.com 申請 API 金鑰並儲值。
- 選支援圖片輸入的模型（例如 mini 系列，比較省錢），可以用 Structured Outputs 強制回傳指定格式的 JSON。

**D. Anthropic Claude API**
- 到 console.anthropic.com 申請 API 金鑰。
- 選支援圖片輸入的模型（例如 Haiku 系列，比較省錢），可以用 tool use 規範回傳的 JSON 格式。

**E. 自架 Ollama**
- 在一台一直開著的電腦或伺服器上安裝 Ollama，執行視覺模型（例如 qwen2.5vl／qwen3-vl、gemma3、minicpm-v）。
- 用 **Cloudflare Tunnel**（免費）把服務安全地對外開放，Edge Function 呼叫時帶一組密鑰驗證。
- 只有 CPU 也能跑，但一張發票可能要等幾十秒到幾分鐘；電腦關機時辨識功能就不能用。

**F. 不用 AI：Tesseract.js／ML Kit**
- 網站：用 **Tesseract.js** 在瀏覽器裡做 OCR（支援日、韓、中、泰、英等語言），翻譯用 Chrome 內建的 Translator API 或自架 LibreTranslate。
- App（Capacitor）：用 **Google ML Kit** 的文字辨識與翻譯，在手機上執行、可離線。
- 缺點：只能讀出文字，不會判斷哪個是金額、哪個是店名，要靠規則去猜，需要手動修正的比例較高。

### 3.4 統一的回傳格式（JSON）

不管用哪一家服務，都要求模型回傳以下格式：

```json
{
  "receipt_date": "2026-10-01",
  "store_name_original": "ファミリーマート 新宿店",
  "store_name_translated": "全家便利商店 新宿店",
  "category": "餐飲",
  "currency": "JPY",
  "amount": 1280,
  "payment_method": "信用卡",
  "raw_text": "（辨識出來的原文）",
  "items": [
    {
      "name_original": "おにぎり 鮭",
      "name_translated": "鮭魚飯糰",
      "quantity": 2,
      "unit_price": 160,
      "subtotal": 320
    }
  ]
}
```

### 3.5 提示詞範例

```
你是發票辨識助手。請讀取這張收據圖片，並且：
1. 擷取日期、店名、品項、數量、單價、小計、總金額、幣別、付款方式。
2. 將店名與品名翻譯成繁體中文，同時保留原文。
3. 依內容判斷類別（餐飲、交通、住宿、購物、門票、其他）。
4. 只輸出符合指定格式的 JSON，不要加其他說明；看不清楚的欄位填 null。
```

---

## 4. 雲端資料庫比較

| 方案 | 優點 | 缺點 |
|---|---|---|
| **Supabase（推薦）** | 免費方案約 500MB 資料庫，只存文字可以放幾十萬筆紀錄；登入與 Edge Functions 都包含在免費方案內；SQL 好做統計 | 免費專案一週沒有使用會自動暫停，到後台按一下就能恢復 |
| Firebase（Firestore） | 成熟、文件多，Firestore 免費額度夠用 | Cloud Functions 必須升級到 Blaze 付費方案（綁信用卡）才能用，沒有它就很難安全地藏 API 金鑰；NoSQL 做統計比較麻煩 |
| Cloudflare D1 + Workers | 免費額度大方、速度快 | 登入驗證與管理介面要自己組，適合熟悉後端的人 |

**結論：** 不存圖片的話，Firebase 的照片儲存問題就不存在了。但 Supabase 免費方案就能用 Edge Functions 保護金鑰，所以仍然是最省事的選擇。

---

## 5. 登入、帳號管理與分享

### 5.1 登入方式（Supabase Auth）

**只提供第三方登入，不提供 Email＋密碼註冊。**

| 方式 | 階段 | 說明 |
|---|---|---|
| **Google 登入** | 第一階段 | 一鍵登入，Supabase 內建支援 |
| **Apple 登入** | 上架 iOS 時 | App Store 規定：有提供 Google 等第三方登入時，通常也要提供 Apple 登入。Supabase 內建支援 |
| LINE 登入 | 選用 | Supabase 沒有內建，需要自行串接 LINE Login（例如用 Edge Function 處理登入流程），有需要再加 |

**這樣做的好處：**

- **系統完全不寄 Email**：沒有驗證信、重設密碼信、邀請信，不用設定 SMTP，也沒有寄信數量限制的問題。
- **不用管理密碼**：沒有「忘記密碼」流程，帳號安全交給 Google／Apple。
- 網站和 App 用**同一組帳號**，資料完全同步。
- 登入狀態會保留，手機不用每次重新登入。

**設定時要關掉的項目：** 在 Supabase Authentication 設定中，關閉 Email provider（含 Email＋密碼與 Magic Link），只開啟 Google（及之後的 Apple）。

### 5.2 帳號管理

| 功能 | 說明 |
|---|---|
| 個人資料 | 顯示名稱、頭像、預設幣別、介面語言 |
| 綁定登入方式 | 同一個帳號可以同時綁定 Google 和 Apple，換裝置時用哪一個都能登入 |
| 登出 | 登出目前裝置 |
| 刪除帳號 | 刪除前提示：自己建立的旅程要先轉讓給其他成員，否則一併刪除。上架 App Store 時，App 內必須提供刪除帳號功能 |

> 第一次用 Google 登入時，自動建立 `profiles` 資料，顯示名稱和頭像直接帶入 Google 帳號的資料，之後可以修改。

### 5.3 分享旅程給他人

每一次旅程都可以邀請其他人加入，成員分成三種角色：

| 角色 | 查看 | 新增發票 | 修改／刪除發票 | 編輯旅程資訊 | 管理成員 | 刪除旅程 |
|---|---|---|---|---|---|---|
| **擁有者**（建立者） | ✔ | ✔ | ✔ 全部 | ✔ | ✔ | ✔ |
| **編輯者** | ✔ | ✔ | ✔ 全部 | ✔ | ✘ | ✘ |
| **檢視者** | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |

> 你要的「一起查看、新增、修正」就是**編輯者**角色。如果希望每個人只能改自己新增的發票，可以把編輯者的修改權限限制成「只能改自己建立的」。

**邀請方式：邀請連結／邀請碼（透過 LINE 等通訊軟體分享）**

1. 擁有者在旅程頁按「邀請成員」，選擇角色（編輯者或檢視者），以及有效期限和可使用次數。
2. 系統產生邀請連結（例如 `https://你的網址/join/AB12CD`）和 6 碼邀請碼。
3. 按「分享」：
   - 優先用手機內建的分享選單（**Web Share API**），選 LINE、Messenger、WhatsApp 等都可以。
   - 也提供「用 LINE 傳送」按鈕，直接開啟 `https://line.me/R/share?text=邀請訊息與連結`。
   - 也可以「複製連結」或直接口頭告訴對方邀請碼。
4. 朋友點連結 → 還沒登入就先用 Google 登入 → 自動加入旅程。
5. 在 App 裡，也可以手動輸入 6 碼邀請碼加入。

> 整個邀請流程都不寄 Email。邀請連結等同於鑰匙，建議預設 7 天有效，並且可以隨時作廢。

**其他分享功能：**

- 擁有者可以隨時調整成員角色、移除成員，或作廢邀請連結。
- 成員可以自行退出旅程。
- 擁有者可以把旅程轉讓給其他成員。
- 每張發票記錄**由誰新增、最後由誰修改、修改時間**，畫面上會顯示。
- 用 **Supabase Realtime** 即時同步：一起旅遊時，朋友剛拍的發票會馬上出現在你的畫面上。
- 統計頁可以加上「依成員」統計，看每個人各記了多少（例如誰付的錢）。

### 5.4 權限控管（RLS）

權限一律在**資料庫層**用 Row Level Security 控管，不只靠前端隱藏按鈕：

- `trips`：只有該旅程的成員可以讀取；擁有者和編輯者可以修改；只有擁有者可以刪除。
- `receipts`、`receipt_items`：旅程成員可以讀取；擁有者和編輯者可以新增、修改、刪除。
- `trip_members`、`trip_invites`：只有擁有者可以管理。
- 透過邀請連結加入時，由 Edge Function（例如 `accept-invite`）檢查邀請碼是否有效、是否過期，再寫入成員資料。

---

## 6. 資料表設計（建議）

### `profiles`：使用者資料
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵，對應 Supabase Auth 的使用者 id |
| display_name | text | 顯示名稱 |
| avatar_url | text | 頭像網址（選用，可以直接用 Google 帳號頭像） |
| default_currency | text | 個人預設幣別 |
| locale | text | 介面語言 |
| preferred_ai_provider | text | 個人預設 AI（選用） |
| is_admin | boolean | 是否為系統管理員（可管理 AI 設定） |
| created_at | timestamptz | 建立時間 |

### `trips`：旅程
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵 |
| owner_id | uuid | 擁有者（建立者） |
| name | text | 旅程名稱（例如：2026 東京行） |
| country | text | 國家 |
| start_date / end_date | date | 期間 |
| default_currency | text | 預設幣別（新增發票時自動帶入，辨識結果可覆蓋） |
| default_ai_provider | text | 旅程預設 AI（選用） |
| budget | numeric | 預算（選用，以預設幣別計） |
| note | text | 備註 |
| created_at | timestamptz | 建立時間 |

### `trip_members`：旅程成員
| 欄位 | 型別 | 說明 |
|---|---|---|
| trip_id | uuid | 旅程（與 user_id 組成主鍵） |
| user_id | uuid | 成員 |
| role | text | 角色：`owner`／`editor`／`viewer` |
| joined_at | timestamptz | 加入時間 |

### `trip_invites`：邀請
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵 |
| trip_id | uuid | 旅程 |
| code | text | 邀請碼（唯一） |
| role | text | 加入後的角色 |
| expires_at | timestamptz | 有效期限 |
| max_uses / used_count | integer | 可使用次數／已使用次數 |
| created_by | uuid | 邀請人 |
| revoked | boolean | 是否已作廢 |

### `receipts`：發票
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵 |
| trip_id | uuid | 所屬旅程 |
| created_by | uuid | 新增者 |
| updated_by | uuid | 最後修改者 |
| paid_by | uuid | 付款人（選用，方便依成員統計） |
| receipt_date | date | 消費日期 |
| store_name_original | text | 店名（原文） |
| store_name_translated | text | 店名（譯文） |
| category | text | 類別（餐飲、交通、住宿、購物…） |
| currency | text | 幣別 |
| amount | numeric | 金額（原幣別，不換算） |
| payment_method | text | 付款方式（現金、信用卡…） |
| raw_text | text | 辨識出來的原文，方便日後核對（選用） |
| ai_provider / ai_model | text | 這張發票由哪一家 AI、哪個模型辨識（手動輸入則為 `manual`） |
| note | text | 備註 |
| created_at / updated_at | timestamptz | 時間戳記 |

### `receipt_items`：品項明細
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵 |
| receipt_id | uuid | 所屬發票 |
| name_original | text | 品名（原文） |
| name_translated | text | 品名（譯文） |
| quantity | numeric | 數量 |
| unit_price | numeric | 單價 |
| subtotal | numeric | 小計 |

### `ai_providers`：AI 服務設定
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | text | 主鍵，例如 `ollama-cloud`、`gemini`、`openai`、`claude`、`ollama-self` |
| display_name | text | 顯示名稱（例如：Google Gemini） |
| model | text | 使用的模型名稱，可以隨時更換 |
| enabled | boolean | 是否啟用 |
| fallback_order | integer | 自動備援的順序（數字小的先試） |
| is_default | boolean | 是否為系統預設 |
| daily_limit_per_user | integer | 每人每日使用上限（選用） |
| timeout_seconds | integer | 逾時秒數，超過就改用下一家 |
| note | text | 備註（例如：免費額度說明） |

> 這張表只存設定，**不存 API 金鑰**。所有使用者可以讀取已啟用的項目（用來顯示下拉選單），只有管理員可以修改。

### `ai_scan_logs`：辨識紀錄
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid | 主鍵 |
| user_id | uuid | 使用者 |
| trip_id | uuid | 旅程 |
| receipt_id | uuid | 對應的發票（存檔後回填，選用） |
| provider / model | text | 使用的 AI 與模型 |
| status | text | `success`／`failed`／`timeout`／`quota_exceeded` |
| is_fallback | boolean | 是否為自動備援後的結果 |
| duration_ms | integer | 花費時間 |
| fields_corrected | integer | 使用者存檔前修改了幾個欄位，可以用來比較各家的準確度 |
| error_message | text | 失敗原因 |
| created_at | timestamptz | 時間 |

> 所有資料表都要開啟 **Row Level Security (RLS)**，依 `trip_members` 的角色控管讀寫權限（見 5.4）。

---

## 7. 功能規劃

0. **登入與帳號**：Google 登入（之後加 Apple）、個人資料設定、刪除帳號（見第 5 節）。

1. **拍照上傳**：使用 `<input type="file" accept="image/*" capture="environment">` 直接開啟手機相機，前端先壓縮再送出。
2. **辨識＋翻譯**：多個 AI 共存，可以每次自選、使用預設、自動備援、換一家重新辨識，或兩家比對（見 3.1）。
3. **AI 管理後台**（管理員）：啟用／停用各家 AI、更換模型、調整備援順序與使用上限，並查看各家的成功率、平均速度和需要修正的比例。
4. **資料修正儲存**：辨識結果先顯示在可編輯的表單上，使用者確認後才存入資料庫；之後也可以再編輯。
   - 修正方式有兩種，可以混用：**換一個 AI 重新辨識**，或**直接手動編輯**欄位。
   - 手動編輯可以修改所有欄位，也可以新增、刪除、調整品項。
   - 品項小計加總和總金額對不上時，畫面會提示，方便發現辨識錯誤。
   - 存檔後仍可隨時修改（依旅程權限），系統記錄最後修改者與時間。
5. **旅程管理**：建立、編輯、刪除旅程；新增發票前先選擇旅程，發票之後也可以改到其他旅程。旅程列表同時顯示「我建立的」和「別人分享給我的」。
6. **分享旅程**：邀請成員、設定角色、即時同步（見 5.3）。
7. **旅程統計**：見下方 7.1。
8. **匯出 Excel**：見下方 7.2。旅程的所有成員（包含檢視者）都可以匯出。

### 7.1 旅程統計

進入某一次旅程後，統計頁顯示：

| 統計項目 | 內容 |
|---|---|
| 旅程總覽 | 發票張數、旅遊天數、**各幣別的總金額**、平均每日花費 |
| 依類別 | 餐飲、交通、住宿、購物、門票、其他的金額與比例（圓餅圖） |
| 依日期 | 每天花費（長條圖），可以看出哪一天花最多 |
| 依付款方式 | 現金、信用卡、電子支付各自的金額 |
| 依店家 | 消費最多的店家排行 |
| 預算對照 | 有設定預算時，顯示已花費與剩餘金額（以預設幣別計） |
| 依成員 | 每位成員新增或付款的發票張數與金額（分享旅程時） |

> 因為不做匯率換算，**不同幣別的金額分開加總，不會混在一起**。例如一次旅遊同時用了日圓和台幣，會分別顯示「JPY 85,000」和「TWD 3,200」。

另外提供**旅程列表**，每一次旅程顯示期間、發票張數和各幣別總金額，方便比較不同旅程。

### 7.2 匯出 Excel（以旅程為單位）

選擇一次旅程後匯出，檔名例如 `2026東京行_發票統計.xlsx`，包含以下工作表：

| 工作表 | 內容 |
|---|---|
| 總覽 | 旅程名稱、期間、發票張數、各幣別總金額 |
| 發票明細 | 每張發票一列：日期、店名（原文／譯文）、類別、幣別、金額、付款方式、新增者、備註 |
| 品項明細 | 每個品項一列：所屬發票、品名（原文／譯文）、數量、單價、小計 |
| 類別統計 | 依類別與幣別的金額加總 |
| 每日統計 | 依日期與幣別的金額加總 |

也可以選擇一次匯出多個旅程，每個旅程各自一組工作表，或合併成一張總表並加上「旅程」欄位。

---

## 8. 部署步驟（概要）

1. 在 Supabase 建立專案，執行建立資料表與 RLS 的 SQL。
   - 在 Authentication 設定中**關閉 Email 登入**，只開啟 Google 登入（需要到 Google Cloud Console 建立 OAuth 用戶端）；上架 iOS 前再開啟 Apple 登入（需要 Apple Developer 帳號）。
   - 把 GitHub Pages 網址和 App 的回呼網址加到允許的 Redirect URLs。
   - 對 `receipts`、`receipt_items` 開啟 Realtime。
   - 建立 Edge Function `accept-invite` 處理邀請連結。
2. 建立 Edge Function（例如 `scan-receipt`），在 Supabase Secrets 設定：
   - 每一家要啟用的服務的金鑰（可以同時設定多家）：`OLLAMA_API_KEY`、`GEMINI_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`
   - 在 `ai_providers` 表新增各家的設定（模型、是否啟用、備援順序、系統預設）；之後調整都改這張表，不用重新部署
   - 只有設定了金鑰的服務才能啟用；金鑰缺少時，Edge Function 會自動跳過該家
   - 自架 Ollama 時另外設定 `OLLAMA_SELF_URL` 與驗證密鑰
3. 前端專案設定 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`（這兩個可以公開）。
4. 在 GitHub repo 設定 GitHub Actions：推送時自動 build，然後部署到 GitHub Pages。
5. 設定 PWA manifest 與 Service Worker，讓手機可以安裝到主畫面。
6. （選用）用 Capacitor 打包成 Android／iOS App 上架。

---

## 9. 預估成本

| 項目 | 費用 |
|---|---|
| GitHub Pages | 免費 |
| Supabase 免費方案 | 免費 |
| AI 辨識：Ollama Cloud | 免費起步，超過額度可升級付費 |
| AI 辨識：Gemini | 有免費額度，超過依用量計費 |
| AI 辨識：OpenAI／Claude | 依用量計費 |
| AI 辨識：自架 Ollama | 免費（硬體與電費另計） |
| 不用 AI（Tesseract／ML Kit） | 免費 |

個人或小團隊使用的話，先用 Ollama Cloud 或 Gemini 的免費額度，每月成本可以是 0 元。用量變大時再改用付費方案。實際價格請以各官方網站為準。
