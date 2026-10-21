import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadNetConfig } from "./config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const cfg = loadNetConfig();
  if (!cfg) throw new Error("未配置 Supabase");
  if (!client) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export function resetSupabase() {
  client = null;
}

export function isNetConfigured(): boolean {
  return !!loadNetConfig();
}
