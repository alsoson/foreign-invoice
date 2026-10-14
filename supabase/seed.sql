-- 初始 AI 設定（模型名稱請依各家最新可用的視覺模型填寫）
insert into public.ai_providers (id, display_name, adapter, model, enabled, fallback_order, is_default, daily_limit_per_user) values
  ('ollama-cloud', 'Ollama Cloud',  'ollama', '<cloud 視覺模型>',   true,  10, true,  50),
  ('gemini',       'Google Gemini', 'gemini', '<Flash 系列模型>',   true,  20, false, 50),
  ('openai',       'OpenAI',        'openai', '<mini 系列模型>',    false, 30, false, 30),
  ('claude',       'Claude',        'claude', '<Haiku 系列模型>',   false, 40, false, 30),
  ('ollama-self',  '自架 Ollama',   'ollama', 'qwen2.5vl:7b',       false, 50, false, null);
