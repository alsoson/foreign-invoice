# AI 辨識設定

拍照辨識由 Edge Function `scan-receipt` 處理：照片送到 AI 服務，回傳辨識＋翻譯好的發票內容。**照片不會儲存**，只在辨識時轉送。

API 金鑰只放在 Supabase 的 Edge Function Secrets，**不會出現在網站程式或資料庫裡**。

## 一、設定系統管理員

「AI 管理」頁只有系統管理員看得到。第一次要在 Supabase 後台手動指定：

1. 先用 Google 帳號登入網站一次（系統會自動建立你的個人資料）。
2. Supabase 後台 → **SQL Editor** → 執行（把 email 換成你的）：

   ```sql
   update public.profiles set is_admin = true
    where id = (select id from auth.users where email = 'you@gmail.com');
   ```

3. 重新整理網站，左側（或下方）導覽列會出現「🛠️ AI 管理」。

## 二、申請金鑰並設定到 Supabase

至少設定一家即可，建議先用有免費額度的 **Ollama Cloud** 或 **Google Gemini**。

| 服務 | 申請位置 | Secret 名稱 |
| --- | --- | --- |
| Ollama Cloud | ollama.com → Settings → API Keys | `OLLAMA_API_KEY` |
| Google Gemini | Google AI Studio → Get API key | `GEMINI_API_KEY` |
| OpenAI | platform.openai.com → API keys（需儲值） | `OPENAI_API_KEY` |
| Anthropic Claude | console.anthropic.com → API Keys（需儲值） | `ANTHROPIC_API_KEY` |
| 自架 Ollama | 你的伺服器網址（例如 Cloudflare Tunnel 的網址） | `OLLAMA_SELF_URL`，有驗證時另加 `OLLAMA_SELF_TOKEN` |

設定方式（擇一）：

- **後台**：Supabase 後台 → **Edge Functions** → **Secrets**（或 Project Settings → Edge Functions）→ 新增上表的名稱與金鑰。
- **指令**：

  ```bash
  npx supabase secrets set GEMINI_API_KEY=你的金鑰 --project-ref yzzbilxzpjyhxgiilzaw
  ```

設定後**立即生效**，不需要重新部署。到「AI 管理」頁，該服務會顯示「金鑰已設定」。

> Edge Function 本身由 GitHub Actions 的 **Deploy Supabase** 自動部署（見 [github-supabase-setup.md](github-supabase-setup.md)）。

## 三、在「AI 管理」頁調整

| 設定 | 說明 |
| --- | --- |
| 啟用 | 關閉後，使用者的選單裡不會出現，也不會被自動備援使用 |
| 模型 | 各家的模型名稱，可隨時更換（例如 Gemini 換成新的 Flash 版本）。**請到各家官網確認目前可用、支援圖片輸入的模型** |
| 備援順序 | 自動模式時，數字小的先試；失敗（逾時、額度用完、回傳格式錯誤）就換下一家 |
| 每人每日上限 | 以「最近 24 小時」計算，留空表示不限。超過時自動改用下一家 |
| 逾時 | 超過秒數沒回應就換下一家（5～60 秒） |
| 設為系統預設 | 沒有個人或旅程預設時，第一個嘗試的服務 |

初始設定（migration `20261015000001_app.sql` 建立）：

| 服務 | 預設模型 | 啟用 | 備援順序 | 每日上限 |
| --- | --- | --- | --- | --- |
| Ollama Cloud（系統預設） | `qwen3-vl:235b-cloud` | ✔ | 10 | 50 |
| Google Gemini | `gemini-2.5-flash` | ✔ | 20 | 50 |
| OpenAI | `gpt-5-mini` | ✘ | 30 | 30 |
| Claude | `claude-haiku-4-5` | ✘ | 40 | 30 |
| 自架 Ollama | `qwen2.5vl:7b` | ✘ | 50 | 不限 |

有啟用但沒設定金鑰的服務會被自動跳過，不會出錯。

## 四、使用哪一家 AI 的順序

使用者沒有指定時，依序嘗試：

1. 個人設定的「慣用的 AI」
2. 旅程設定的「旅程預設 AI」
3. 系統預設
4. 其餘已啟用的服務，依備援順序

使用者也可以在拍照頁自選一家（只用那一家，不備援）、辨識後「換一個 AI 重新辨識」，或開啟「比對模式」同時用兩家並逐欄挑選。

## 五、成效統計

「AI 管理」頁下方的「各家成效」會顯示最近 7／30／90 天：

- **成功率**、**平均速度**
- **備援成功**：前一家失敗後由這一家接手成功的次數
- **需要修正**：辨識成功後，使用者存檔前還修改了欄位的比例（越低越準確）

每次辨識的詳細紀錄（含失敗原因）在資料表 `ai_scan_logs`，只有管理員能查看。給一般使用者看的錯誤訊息不會包含服務網址或回應內容。
