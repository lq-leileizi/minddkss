import type { Card, Rank } from "./cards";

/** category 越高越好；values 为比较键（降序） */
export type HandValue = { cat: number; vals: number[]; name: string };

const CAT_NAME = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
];

function combos5(cards: Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}

function eval5(cards: Card[]): HandValue {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const flush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length >= 5) {
    for (let i = 0; i <= uniq.length - 5; i++) {
      if (uniq[i] - uniq[i + 4] === 4) {
        straightHigh = uniq[i];
        break;
      }
    }
  }
  // A-5 wheel
  if (!straightHigh && uniq.includes(14) && [5, 4, 3, 2].every((r) => uniq.includes(r as Rank))) {
    straightHigh = 5;
  }

  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (flush && straightHigh) {
    return { cat: 8, vals: [straightHigh], name: CAT_NAME[8] };
  }
  if (groups[0][1] === 4) {
    const k = groups.find((g) => g[1] === 1)![0];
    return { cat: 7, vals: [groups[0][0], k], name: CAT_NAME[7] };
  }
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { cat: 6, vals: [groups[0][0], groups[1][0]], name: CAT_NAME[6] };
  }
  if (flush) return { cat: 5, vals: ranks, name: CAT_NAME[5] };
  if (straightHigh) return { cat: 4, vals: [straightHigh], name: CAT_NAME[4] };
  if (groups[0][1] === 3) {
    const kick = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { cat: 3, vals: [groups[0][0], ...kick], name: CAT_NAME[3] };
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const hi = Math.max(groups[0][0], groups[1][0]);
    const lo = Math.min(groups[0][0], groups[1][0]);
    const k = groups.find((g) => g[1] === 1)![0];
    return { cat: 2, vals: [hi, lo, k], name: CAT_NAME[2] };
  }
  if (groups[0][1] === 2) {
    const kick = groups.filter((g) => g[1] === 1).map((g) => g[0]);
    return { cat: 1, vals: [groups[0][0], ...kick], name: CAT_NAME[1] };
  }
  return { cat: 0, vals: ranks, name: CAT_NAME[0] };
}

export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    const pad: number[] = cards.map((c) => c.r).sort((a, b) => b - a);
    while (pad.length < 5) pad.push(0);
    return { cat: 0, vals: pad, name: "不足五张" };
  }
  if (cards.length === 5) return eval5(cards);
  let best: HandValue | null = null;
  for (const five of combos5(cards)) {
    const v = eval5(five);
    if (!best || cmpHand(v, best) > 0) best = v;
  }
  return best!;
}

export function cmpHand(a: HandValue, b: HandValue): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.vals.length, b.vals.length);
  for (let i = 0; i < n; i++) {
    const d = (a.vals[i] ?? 0) - (b.vals[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 0~1 粗略成牌强度，供 AI */
export function strength01(v: HandValue): number {
  return Math.min(1, (v.cat + Math.min(1, v.vals[0] / 14) * 0.4) / 8.5);
}
