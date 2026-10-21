import type { Persona } from "../config";
import type { Action, Engine } from "../game/engine";
import { legalActions, raiseSize } from "../game/engine";
import { bestHand, strength01 } from "../game/handEval";
import type { Card } from "../game/cards";

const PREFLOP: Record<string, number> = {};
function key(a: number, b: number, suited: boolean) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return `${hi}-${lo}-${suited ? "s" : "o"}`;
}
(function init() {
  const pairs = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const r of pairs) PREFLOP[key(r, r, false)] = 0.55 + (r - 2) * 0.035;
  for (const hi of pairs) {
    for (const lo of pairs) {
      if (hi === lo) continue;
      const gap = hi - lo;
      let s = 0.22 + hi * 0.02 - gap * 0.03;
      let o = s - 0.08;
      if (hi === 14) {
        s += 0.12;
        o += 0.08;
      }
      PREFLOP[key(hi, lo, true)] = Math.min(0.95, s);
      PREFLOP[key(hi, lo, false)] = Math.min(0.9, o);
    }
  }
})();

function preflopScore(hole: Card[]): number {
  const [a, b] = hole;
  return PREFLOP[key(a.r, b.r, a.s === b.s)] ?? 0.15;
}

function postflopScore(hole: Card[], board: Card[]): number {
  if (board.length < 3) return preflopScore(hole);
  const made = strength01(bestHand([...hole, ...board]));
  // 简单听牌加成
  let draw = 0;
  const all = [...hole, ...board];
  const suits = new Map<string, number>();
  for (const c of all) suits.set(c.s, (suits.get(c.s) ?? 0) + 1);
  if ([...suits.values()].some((n) => n === 4)) draw += 0.12;
  return Math.min(0.98, made + draw);
}

const MOD: Record<Persona, { fold: number; raise: number; bluff: number }> = {
  standard: { fold: 0.28, raise: 0.62, bluff: 0.08 },
  tight: { fold: 0.4, raise: 0.72, bluff: 0.03 },
  loose: { fold: 0.18, raise: 0.52, bluff: 0.14 },
  calling: { fold: 0.22, raise: 0.78, bluff: 0.05 },
  bluff: { fold: 0.2, raise: 0.48, bluff: 0.22 },
};

export type BotDecision = { action: Action; raiseTo?: number };

export function decide(e: Engine, persona: Persona): BotDecision {
  const acts = legalActions(e);
  if (!acts.length) return { action: "check" };
  const p = e.players[e.toAct];
  const m = MOD[persona];
  const score =
    e.street === "preflop"
      ? preflopScore(p.hole)
      : postflopScore(p.hole, e.board);
  const jitter = (Math.random() - 0.5) * 0.06;
  const s = Math.max(0, Math.min(1, score + jitter));
  const toCall = e.currentBet - p.bet;
  const potOdds = toCall <= 0 ? 0 : toCall / (e.pot + toCall);

  const bluffing = Math.random() < m.bluff && e.street !== "preflop";

  if (acts.includes("check") && toCall <= 0) {
    if (s > m.raise || bluffing) {
      if (acts.includes("raise")) {
        const to = Math.min(p.chips + p.bet, Math.max(raiseSize(e), Math.floor(e.pot * 0.6) + e.currentBet));
        return { action: "raise", raiseTo: to };
      }
      if (acts.includes("allin")) return { action: "allin" };
    }
    return { action: "check" };
  }

  // 面对下注
  if (s < m.fold && s < potOdds + 0.05 && !bluffing) {
    if (acts.includes("fold")) return { action: "fold" };
  }
  if ((s > m.raise || bluffing) && acts.includes("raise")) {
    const to = Math.min(
      p.chips + p.bet,
      Math.max(raiseSize(e), e.currentBet + Math.max(e.bb, Math.floor(e.pot * 0.55))),
    );
    return { action: "raise", raiseTo: to };
  }
  if (acts.includes("call")) return { action: "call" };
  if (acts.includes("allin") && s > 0.7) return { action: "allin" };
  if (acts.includes("fold")) return { action: "fold" };
  if (acts.includes("check")) return { action: "check" };
  return { action: acts[0] };
}
