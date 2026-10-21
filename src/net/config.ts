import type { NetConfig } from "./types";

const KEY = "minddkss_net_v1";

export function loadNetConfig(): NetConfig | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as NetConfig;
    if (data.url && data.anonKey) return data;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveNetConfig(cfg: NetConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function clearNetConfig() {
  localStorage.removeItem(KEY);
}

const PID_KEY = "minddkss_pid_v1";
const NAME_KEY = "minddkss_nick_v1";

export function getPlayerId(): string {
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export function getNickname(): string {
  const n = localStorage.getItem(NAME_KEY);
  if (n?.trim()) return n.trim().slice(0, 12);
  const fallback = `玩家${getPlayerId().slice(-4)}`;
  localStorage.setItem(NAME_KEY, fallback);
  return fallback;
}

export function setNickname(name: string) {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 12) || getNickname());
}
