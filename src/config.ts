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
