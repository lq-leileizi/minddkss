import { DAILY_CHECKIN_REWARD, START_COINS } from "./config";
import { DEFAULT_EQUIP, SKINS, type SkinType } from "./shop/catalog";

const KEY = "minddkss_save_v1";

export type SaveData = {
  coins: number;
  owned: string[];
  equip: Record<SkinType, string>;
  /** 上次签到日期 YYYY-MM-DD（本地时区） */
  lastCheckin: string | null;
};

function defaults(): SaveData {
  return {
    coins: START_COINS,
    owned: SKINS.filter((s) => s.price === 0).map((s) => s.id),
    equip: { ...DEFAULT_EQUIP },
    lastCheckin: null,
  };
}

/** 本地日历日，用于每日签到判定 */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...defaults(),
      ...data,
      owned: [...new Set([...(defaults().owned), ...(data.owned ?? [])])],
      equip: { ...DEFAULT_EQUIP, ...(data.equip ?? {}) },
      lastCheckin: data.lastCheckin ?? null,
    };
  } catch {
    return defaults();
  }
}

export function writeSave(s: SaveData) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function canCheckinToday(save: SaveData): boolean {
  return save.lastCheckin !== todayKey();
}

/** 成功返回奖励金币数，已签到返回 null */
export function claimDailyCheckin(save: SaveData): number | null {
  if (!canCheckinToday(save)) return null;
  save.coins += DAILY_CHECKIN_REWARD;
  save.lastCheckin = todayKey();
  writeSave(save);
  return DAILY_CHECKIN_REWARD;
}

export function buySkin(save: SaveData, id: string): string | null {
  const item = SKINS.find((x) => x.id === id);
  if (!item) return "商品不存在";
  if (save.owned.includes(id)) return "已拥有";
  if (save.coins < item.price) return "金币不足";
  save.coins -= item.price;
  save.owned.push(id);
  writeSave(save);
  return null;
}

export function equipSkin(save: SaveData, id: string): string | null {
  const item = SKINS.find((x) => x.id === id);
  if (!item) return "商品不存在";
  if (!save.owned.includes(id)) return "未拥有";
  save.equip[item.type] = id;
  writeSave(save);
  return null;
}
