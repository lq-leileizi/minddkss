export type Suit = "s" | "h" | "d" | "c";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Card = { r: Rank; s: Suit };

const SUITS: Suit[] = ["s", "h", "d", "c"];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const RANK_CHAR: Record<number, string> = {
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};
const SUIT_SYM: Record<Suit, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

export function cardLabel(c: Card): string {
  const r = RANK_CHAR[c.r] ?? String(c.r);
  return r + SUIT_SYM[c.s];
}

export function isRed(c: Card): boolean {
  return c.s === "h" || c.s === "d";
}

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return d;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
