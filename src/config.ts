/** 已定稿的玩法/经济数值 */

export const PLAYERS = 8;
export const START_CHIPS = 1500;
export const MAX_HANDS = 50;
export const BLIND_EVERY = 5; // 每 N 把涨盲

/** 把数区间起点 → [小盲, 大盲] */
export const BLINDS: [number, number][] = [
  [10, 20],
  [15, 30],
  [25, 50],
  [40, 80],
  [60, 120],
  [100, 200],
  [150, 300],
  [250, 500],
  [400, 800],
  [600, 1200],
];

export function blindsForHand(handIndex1: number): [number, number] {
  const i = Math.min(
    BLINDS.length - 1,
    Math.floor((handIndex1 - 1) / BLIND_EVERY),
  );
  return BLINDS[i];
}

export const ENTRY_FEE = 100;

/** 金币场：买入后打一小局，结束按剩余筹码结算，再准备就是新的一局 */
export const CASH_TABLES = [
  { id: "low", name: "初级场", sb: 10, bb: 20, buyin: 400 },
  { id: "mid", name: "中级场", sb: 25, bb: 50, buyin: 1000 },
  { id: "high", name: "高级场", sb: 100, bb: 200, buyin: 4000 },
] as const;

export type CashTableId = (typeof CASH_TABLES)[number]["id"];

/** 联机大厅桌子数量 */
export const TABLE_COUNT = 50;

/** 名次 1..8 → 奖金（第4净赚 +20） */
export const PRIZE = [0, 350, 220, 150, 120, 55, 35, 20, 10] as const;

export const START_COINS = 400;

/** 每日签到奖励 */
export const DAILY_CHECKIN_REWARD = 500;

export const SKIN_PRICE = { common: 150, rare: 400, legend: 800 } as const;

/** AI 人设：每把重抽；同桌同人设最多 2 个 */
export type Persona = "standard" | "tight" | "loose" | "calling" | "bluff";

export const PERSONA_WEIGHT: Record<Persona, number> = {
  standard: 35,
  tight: 20,
  loose: 20,
  calling: 15,
  bluff: 10,
};

export const PERSONA_MAX_SAME = 2;
