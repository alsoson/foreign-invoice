// Supabase Edge Function 進入點（Deno）。主要邏輯在 handler.ts。
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler } from './handler.ts'

Deno.serve(createHandler({ env: (k) => Deno.env.get(k), fetch: (...a) => fetch(...a), createClient }))
