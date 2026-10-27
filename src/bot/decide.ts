import type { Persona } from "../config";
import type { Action, Engine, HandAction } from "../game/engine";
import { legalActions, raiseSize } from "../game/engine";
import { bestHand } from "../game/handEval";
import type { Card } from "../game/cards";

const PREFLOP: Record<string, number> = {};
function pfKey(a: number, b: number, suited: boolean) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return `${hi}-${lo}-${suited ? "s" : "o"}`;
}
(function initPreflop() {
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const r of ranks) PREFLOP[pfKey(r, r, false)] = 0.52 + (r - 2) * 0.036;
  for (const hi of ranks) {
    for (const lo of ranks) {
      if (lo >= hi) continue;
      const gap = hi - lo;
      let suited = 0.2 + hi * 0.018 - gap * 0.028;
      let off = suited - 0.09;
      if (hi === 14 && lo >= 13) {
        suited += 0.36;
        off += 0.28;
      } else if (hi === 14 && lo >= 11) {
        suited += 0.18;
        off += 0.12;
      } else if (hi === 14) {
        suited += 0.12;
        off += 0.06;
      } else if (hi >= 13 && lo >= 10) {
        suited += 0.1;
        off += 0.05;
      }
      PREFLOP[pfKey(hi, lo, true)] = Math.min(0.96, suited);
      PREFLOP[pfKey(hi, lo, false)] = Math.min(0.92, off);
    }
  }
})();

/** 人设只轻轻偏一点，主逻辑看牌和场面。 */
const STYLE: Record<Persona, { tight: number; raiseShy: number; bluff: number }> = {
  standard: { tight: 0, raiseShy: 0, bluff: 0.1 },
  tight: { tight: 0.07, raiseShy: 0.02, bluff: 0.03 },
  loose: { tight: -0.07, raiseShy: -0.02, bluff: 0.13 },
  calling: { tight: -0.04, raiseShy: 0.14, bluff: 0.04 },
  bluff: { tight: -0.02, raiseShy: -0.05, bluff: 0.22 },
};

export type BotDecision = { action: Action; raiseTo?: number };

export function decide(e: Engine, persona: Persona): BotDecision {
  const acts = legalActions(e);
  if (!acts.length) return { action: "check" };
  const style = STYLE[persona] ?? STYLE.standard;
  if (e.street === "preflop") return preflop(e, style);
  return postflop(e, style);
}

type Style = (typeof STYLE)["standard"];

function preflopScore(hole: Card[]): number {
  const [a, b] = hole;
  return PREFLOP[pfKey(a.r, b.r, a.s === b.s)] ?? 0.12;
}

function preflop(e: Engine, style: Style): BotDecision {
  const me = e.players[e.toAct];
  const score = clamp(preflopScore(me.hole) + jitter(0.04) + (stillToAct(e) <= 1 ? 0.06 : 0) - (stillToAct(e) >= 4 ? 0.05 : 0));
  const street = thisStreet(e);
  const raises = street.filter((h) => h.raised);
  const limps = street.filter((h) => h.action === "call" || (h.action === "allin" && !h.raised && h.paid > 0)).length;
  const folds = street.filter((h) => h.action === "fold").length;
  const toCall = e.currentBet - me.bet;
  const bb = Math.max(1, e.bb);

  if (raises.length === 0) {
    let openAt = stillToAct(e) <= 1 ? 0.36 : stillToAct(e) >= 4 ? 0.54 : 0.45;
    openAt += style.tight;
    if (folds >= 3 && stillToAct(e) <= 2) openAt -= 0.06;
    if (score >= openAt + 0.2 + style.raiseShy) {
      const to = openSize(e, 2.5 + limps);
      return raiseOr(e, to);
    }
    if (score >= openAt) {
      if (limps > 0 && score >= openAt + 0.06) return raiseOr(e, openSize(e, 3 + limps * 0.8));
      if (limps > 0 && toCall > 0 && toCall <= bb) return callOr(e);
      if (toCall > 0 && toCall < bb && score >= openAt - 0.08) return callOr(e);
      if (toCall <= 0) return stillToAct(e) <= 2 ? raiseOr(e, openSize(e, 2.5)) : checkOr(e);
      return raiseOr(e, openSize(e, 2.5 + limps));
    }
    if (toCall <= 0) return checkOr(e);
    if (toCall > 0 && toCall < bb && score >= openAt - 0.14) return callOr(e);
    return foldOr(e);
  }

  const last = raises[raises.length - 1];
  const sizeBb = last.betTo / bb;
  if (raises.length === 1) {
    let need = 0.5 + style.tight;
    if (sizeBb >= 4) need += 0.08;
    if (sizeBb >= 6) need += 0.08;
    if (sizeBb >= 9) need += 0.1;
    if (limps >= 2) need += 0.04;
    if (stillToAct(e) === 0) need -= 0.04;
    if (score >= need + 0.2 + style.raiseShy) {
      const to = Math.round(last.betTo * 3 + limps * bb);
      return raiseOr(e, Math.max(raiseSize(e), to));
    }
    if (score >= need) return callOr(e);
    if (score >= need - 0.08 && sizeBb <= 3 && style.tight < 0) return callOr(e);
    return foldOr(e);
  }

  let need = 0.78 + style.tight;
  if (sizeBb >= 12) need += 0.05;
  if (sizeBb >= 20) need += 0.06;
  const stackBb = (me.chips + me.bet) / bb;
  if (score >= 0.9 && stackBb < 40) return shove(e);
  if (score >= need + 0.08 + style.raiseShy) {
    if (stackBb < 45) return shove(e);
    return raiseOr(e, Math.max(raiseSize(e), Math.round(last.betTo * 2.4)));
  }
  if (score >= need && sizeBb < 22) return callOr(e);
  return foldOr(e);
}

type Made =
  | "nuts"
  | "full"
  | "flush"
  | "straight"
  | "set"
  | "trips"
  | "twopair"
  | "overpair"
  | "top"
  | "middle"
  | "weak"
  | "air";

function postflop(e: Engine, style: Style): BotDecision {
  const me = e.players[e.toAct];
  const board = e.board;
  const made = classify(me.hole, board);
  const draw = made.cat >= 4 ? 0 : drawValue(me.hole, board, e.street);
  let hand = made.score + jitter(0.03);
  const alive = e.players.filter((p) => !p.out && !p.folded).length;
  const behind = stillToAct(e);
  if (alive >= 4) hand -= 0.05;
  if (alive === 2 && behind === 0) hand += 0.03;

  const street = thisStreet(e);
  const raises = street.filter((h) => h.raised);
  const calls = street.filter((h) => h.action === "call" || (h.action === "allin" && !h.raised && h.paid > 0)).length;
  const toCall = e.currentBet - me.bet;
  const pot = Math.max(1, e.pot);
  const frac = toCall <= 0 ? 0 : toCall / pot;
  const spr = me.chips / pot;
  const scary = boardTexture(board);
  const stuckAround = priorCalls(e);

  if (toCall <= 0) {
    return checkedTo(e, style, made.kind, hand, draw, alive, behind, spr, scary, stuckAround);
  }

  let need = 0.42 + style.tight + scary * (made.kind === "top" || made.kind === "middle" || made.kind === "weak" ? 1 : 0.3);
  if (frac > 0.28) need = 0.52;
  if (frac > 0.55) need = 0.66;
  if (frac > 0.9) need = 0.78;
  if (frac > 1.3) need = 0.86;
  if (raises.length >= 2) need += 0.12;
  if (raises.length >= 3) need += 0.08;
  if (e.street === "turn") need += 0.04;
  if (e.street === "river") need += draw > 0 ? 0.2 : 0.07;
  if (alive >= 4) need += 0.05;
  if (calls >= 2) need += 0.04;
  need += style.tight * 0.4;

  const equity = hand + (e.street === "river" ? 0 : draw);
  const odds = toCall / (pot + toCall);

  if (made.kind === "nuts" || made.kind === "full" || (made.kind === "set" && raises.length < 2)) {
    if (frac < 0.45 && raises.length < 2 && style.raiseShy < 0.1) return raiseOr(e, pressSize(e));
    if (spr < 1.2) return shove(e);
    return callOr(e);
  }

  if (equity >= need + 0.18 + style.raiseShy && raises.length < 2 && frac < 0.75 && draw < 0.2) {
    return raiseOr(e, pressSize(e));
  }
  if (equity + 0.02 >= Math.max(need, odds + 0.02)) {
    if (spr < 1.1 && equity >= 0.6) return shove(e);
    return callOr(e);
  }
  if (draw >= 0.16 && e.street !== "river" && frac < 0.6 && equity + draw >= odds) return callOr(e);
  return foldOr(e);
}

function checkedTo(
  e: Engine,
  style: Style,
  kind: Made,
  hand: number,
  draw: number,
  alive: number,
  behind: number,
  spr: number,
  scary: number,
  stuckAround: number,
): BotDecision {
  const value =
    kind === "nuts" || kind === "full" || kind === "flush" || kind === "straight" || kind === "set" || kind === "trips";
  const decent = kind === "twopair" || kind === "overpair" || kind === "top";
  if (value) {
    if (spr < 1.4) return shove(e);
    const frac = e.street === "river" ? 0.85 : kind === "set" || kind === "nuts" || kind === "full" ? 0.75 : 0.62;
    return raiseOr(e, betFrac(e, alive >= 4 ? frac * 0.75 : frac));
  }
  if (decent) {
    if (e.street === "river" && alive >= 4 && (kind !== "twopair" || scary > 0.06)) return checkOr(e);
    if (e.street === "river" && scary > 0.08 && kind === "top") return checkOr(e);
    if (spr < 1.6 && hand >= 0.62) return shove(e);
    const frac = kind === "twopair" ? 0.66 : alive >= 4 ? 0.4 : 0.55;
    return raiseOr(e, betFrac(e, frac));
  }
  if (draw >= 0.15 && e.street !== "river" && alive <= 3 && behind <= 1) {
    return raiseOr(e, betFrac(e, draw >= 0.28 ? 0.7 : 0.55));
  }
  const bluffOk = alive === 2 && behind === 0 && (e.street !== "river" || stuckAround === 0);
  if (bluffOk && kind === "air" && Math.random() < style.bluff * (e.street === "river" ? 0.45 : 1)) {
    return raiseOr(e, betFrac(e, e.street === "flop" ? 0.6 : 0.5));
  }
  return checkOr(e);
}

function classify(hole: Card[], board: Card[]): { kind: Made; score: number; cat: number } {
  const hand = bestHand([...hole, ...board]);
  const boardRanks = board.map((c) => c.r).sort((a, b) => b - a);
  const top = boardRanks[0] ?? 0;
  const paired = hole[0].r === hole[1].r;
  const pairRank = hand.cat === 1 || hand.cat === 2 || hand.cat === 3 ? hand.vals[0] : 0;
  let kind: Made = "air";
  if (hand.cat >= 7) kind = "nuts";
  else if (hand.cat === 6) kind = "full";
  else if (hand.cat === 5) kind = "flush";
  else if (hand.cat === 4) kind = "straight";
  else if (hand.cat === 3) kind = paired && boardRanks.includes(hole[0].r) ? "set" : "trips";
  else if (hand.cat === 2) kind = "twopair";
  else if (hand.cat === 1) {
    if (paired && pairRank > top) kind = "overpair";
    else if (pairRank === top) kind = "top";
    else if (pairRank >= (boardRanks[1] ?? 0)) kind = "middle";
    else kind = "weak";
  }
  const kicker = hand.cat === 1 ? (hand.vals[1] ?? 0) / 14 : 0;
  const score: Record<Made, number> = {
    nuts: 0.97,
    full: 0.94,
    set: 0.9,
    flush: 0.86,
    straight: 0.82,
    trips: 0.78,
    twopair: 0.72,
    overpair: 0.66,
    top: 0.58 + kicker * 0.06,
    middle: 0.44,
    weak: 0.32,
    air: 0.1,
  };
  return { kind, score: score[kind], cat: hand.cat };
}

function drawValue(hole: Card[], board: Card[], street: Engine["street"]): number {
  if (street === "river") return 0;
  let v = 0;
  const flush = flushDraw(hole, board);
  if (flush === "nut") v += 0.22;
  else if (flush === "draw") v += 0.17;
  const straight = straightDraw(hole, board);
  if (straight === "open") v += 0.16;
  else if (straight === "gut") v += 0.07;
  if (street === "turn") v *= 0.72;
  const top = Math.max(...board.map((c) => c.r));
  if (hole.every((c) => c.r > top) && hole[0].r !== hole[1].r && street === "flop") v += 0.05;
  return Math.min(0.36, v);
}

function flushDraw(hole: Card[], board: Card[]): "nut" | "draw" | "none" {
  const bySuit = new Map<string, Card[]>();
  for (const c of [...hole, ...board]) {
    const list = bySuit.get(c.s) ?? [];
    list.push(c);
    bySuit.set(c.s, list);
  }
  for (const [suit, cards] of bySuit) {
    if (cards.length !== 4) continue;
    const held = hole.filter((c) => c.s === suit);
    if (!held.length) continue;
    const topHeld = Math.max(...held.map((c) => c.r));
    const boardTop = Math.max(0, ...board.filter((c) => c.s === suit).map((c) => c.r));
    return topHeld === 14 || topHeld > boardTop ? "nut" : "draw";
  }
  return "none";
}

function straightDraw(hole: Card[], board: Card[]): "open" | "gut" | "none" {
  const all = new Set<number>([...hole, ...board].map((c) => c.r));
  const holeR = new Set<number>(hole.map((c) => c.r));
  let gut = false;
  const windows: number[][] = [];
  for (let hi = 14; hi >= 5; hi--) windows.push([hi, hi - 1, hi - 2, hi - 3, hi - 4]);
  windows.push([14, 5, 4, 3, 2]);
  for (const w of windows) {
    if (w.filter((r) => all.has(r)).length !== 4) continue;
    if (!w.some((r) => holeR.has(r))) continue;
    const missing = w.find((r) => !all.has(r))!;
    const wheel = w[1] === 5 && w[0] === 14;
    const open = !wheel && (missing === w[0] || missing === w[4]);
    if (open) return "open";
    gut = true;
  }
  return gut ? "gut" : "none";
}

function boardTexture(board: Card[]): number {
  let n = 0;
  const suits = new Map<string, number>();
  const ranks = new Map<number, number>();
  for (const c of board) {
    suits.set(c.s, (suits.get(c.s) ?? 0) + 1);
    ranks.set(c.r, (ranks.get(c.r) ?? 0) + 1);
  }
  const suitMax = Math.max(0, ...suits.values());
  if (suitMax >= 3) n += 0.04;
  if (suitMax >= 4) n += 0.05;
  if ([...ranks.values()].some((c) => c >= 2)) n += 0.04;
  const ordered = board.map((c) => c.r).sort((a, b) => b - a);
  if (ordered.length >= 3 && ordered[0] - ordered[2] <= 4) n += 0.03;
  return n;
}

function thisStreet(e: Engine): HandAction[] {
  return (e.history ?? []).filter((h) => h.street === e.street);
}

function priorCalls(e: Engine): number {
  return (e.history ?? []).filter(
    (h) => h.street !== e.street && h.street !== "preflop" && (h.action === "call" || (h.action === "allin" && !h.raised)),
  ).length;
}

function stillToAct(e: Engine): number {
  let n = 0;
  const len = e.players.length;
  for (let i = 1; i < len; i++) {
    const p = e.players[(e.toAct + i) % len];
    if (p.out || p.folded || p.allIn || p.chips <= 0) continue;
    if (p.bet < e.currentBet || !e.acted.has(p.id)) n++;
  }
  return n;
}

function openSize(e: Engine, bbMul: number): number {
  return Math.max(raiseSize(e), Math.round(e.bb * bbMul));
}

function betFrac(e: Engine, frac: number): number {
  const add = Math.max(e.bb, Math.floor(e.pot * frac));
  return Math.max(raiseSize(e), e.currentBet + add);
}

function pressSize(e: Engine): number {
  const me = e.players[e.toAct];
  const facing = Math.max(e.bb, e.currentBet - me.bet);
  return Math.max(raiseSize(e), e.currentBet + Math.floor(facing * 2.3));
}

function raiseOr(e: Engine, target: number): BotDecision {
  const me = e.players[e.toAct];
  const max = me.bet + me.chips;
  const min = raiseSize(e);
  if (!legalActions(e).includes("raise") || max <= min) return shove(e);
  const to = Math.min(max, Math.max(min, target));
  if (to >= max * 0.82) return shove(e);
  return { action: "raise", raiseTo: to };
}

function shove(e: Engine): BotDecision {
  return callOr(e, true);
}

function callOr(e: Engine, preferAllin = false): BotDecision {
  const acts = legalActions(e);
  if (preferAllin && acts.includes("allin")) return { action: "allin" };
  if (acts.includes("call")) return { action: "call" };
  if (acts.includes("allin")) return { action: "allin" };
  if (acts.includes("check")) return { action: "check" };
  return foldOr(e);
}

function checkOr(e: Engine): BotDecision {
  const acts = legalActions(e);
  if (acts.includes("check")) return { action: "check" };
  if (acts.includes("call")) return { action: "call" };
  return foldOr(e);
}

function foldOr(e: Engine): BotDecision {
  const acts = legalActions(e);
  if (acts.includes("check")) return { action: "check" };
  if (acts.includes("fold")) return { action: "fold" };
  if (acts.includes("call")) return { action: "call" };
  return { action: acts[0] ?? "check" };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function jitter(n: number): number {
  return (Math.random() - 0.5) * n;
}
