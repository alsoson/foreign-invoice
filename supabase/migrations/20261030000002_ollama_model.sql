-- =========================================================
-- 0006_ollama_model.sql：Ollama Cloud 預設模型改為 gemma4:31b
-- 只更新仍是舊預設值（qwen3-vl:235b-cloud）的設定，
-- 管理員已在「AI 管理」頁改成其他模型時不覆蓋。
-- =========================================================

update public.ai_providers
   set model = 'gemma4:31b'
 where id = 'ollama-cloud'
   and model = 'qwen3-vl:235b-cloud';
