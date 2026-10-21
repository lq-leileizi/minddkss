import { MAX_HANDS, PLAYERS, START_CHIPS, blindsForHand, type Persona } from "../config";
import { rollPersonas } from "../bot/persona";
import {
  type Action,
  type Engine,
  applyAction,
  createEngine,
  legalActions,
} from "./engine";
import { decide } from "../bot/decide";

const NAMES = ["你", "阿强", "Lisa", "老周", "Mia", "阿杰", "Nina", "大飞"];

export type SeatState = {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  place: number | null; // 已定名次 1..8
  persona?: Persona;
};

export type Tournament = {
  hand: number; // 1..MAX
  button: number;
  seats: SeatState[];
  finishOrder: number[]; // 出局 id，先出局在前（第8名…）
  engine: Engine | null;
  personas: Persona[];
  over: boolean;
  ranking: number[]; // seatId by place index 0 = 冠军
};

export function createTournament(): Tournament {
  const seats: SeatState[] = Array.from({ length: PLAYERS }, (_, id) => ({
    id,
    name: NAMES[id],
    isHuman: id === 0,
    chips: START_CHIPS,
    place: null,
  }));
  return {
    hand: 0,
    button: 0,
    seats,
    finishOrder: [],
    engine: null,
    personas: [],
    over: false,
    ranking: [],
  };
}

function alive(t: Tournament) {
  return t.seats.filter((s) => s.chips > 0 && s.place === null);
}

export function startHand(t: Tournament): Engine | null {
  if (t.over) return null;
  const living = alive(t);
  if (living.length <= 1 || t.hand >= MAX_HANDS) {
    endTournament(t);
    return null;
  }
  t.hand += 1;
  const [sb, bb] = blindsForHand(t.hand);
  // 按钮轮转到仍存活
  let b = t.button;
  for (let i = 0; i < PLAYERS; i++) {
    b = (t.button + 1 + i) % PLAYERS;
    if (t.seats[b].chips > 0 && t.seats[b].place === null) break;
  }
  t.button = b;

  const ai = living.filter((s) => !s.isHuman).length;
  t.personas = rollPersonas(ai);
  let aiIdx = 0;
  for (const s of t.seats) {
    if (s.isHuman || s.place !== null || s.chips <= 0) {
      s.persona = undefined;
    } else {
      s.persona = t.personas[aiIdx++];
    }
  }

  t.engine = createEngine(
    t.seats.map((s) => ({
      name: s.name,
      isHuman: s.isHuman,
      chips: s.place !== null ? 0 : s.chips,
    })),
    t.button,
    sb,
    bb,
  );
  return t.engine;
}

export function syncChipsFromEngine(t: Tournament) {
  if (!t.engine) return;
  for (const p of t.engine.players) {
    const s = t.seats[p.id];
    if (s.place !== null) continue;
    s.chips = p.chips;
  }
  // 一手结束才判定淘汰（避免全下中途 chips=0 被误判）
  if (t.engine.street !== "done") return;
  for (const s of t.seats) {
    if (s.place !== null) continue;
    if (s.chips <= 0 && !t.finishOrder.includes(s.id)) {
      t.finishOrder.push(s.id);
    }
  }
}

/** 玩家是否已出局（筹码打光） */
export function isHumanBusted(t: Tournament): boolean {
  return t.seats[0].chips <= 0 || t.finishOrder.includes(0);
}

export function afterHand(t: Tournament) {
  syncChipsFromEngine(t);
  t.engine = null;
  const living = alive(t);
  // 你输光就立刻整场结算离场，不必等其他人打完
  if (isHumanBusted(t) || living.length <= 1 || t.hand >= MAX_HANDS) {
    endTournament(t);
  }
}

export function endTournament(t: Tournament) {
  if (t.over) return;
  t.over = true;
  t.engine = null;
  // 已出局：finishOrder 先出局 = 更差名次
  const placed = new Set<number>();
  const rankingAsc: number[] = []; // 从第8到第1过程中先收集差的
  // 先给归零的按出局顺序从差到好：第一个出局第8
  let place = PLAYERS;
  for (const id of t.finishOrder) {
    if (placed.has(id)) continue;
    t.seats[id].place = place--;
    placed.add(id);
    rankingAsc.push(id);
  }
  // 存活按筹码排序（多→少 = 更好名次）
  const survivors = t.seats
    .filter((s) => !placed.has(s.id))
    .sort((a, b) => b.chips - a.chips || a.id - b.id);
  for (const s of survivors) {
    s.place = place--;
    placed.add(s.id);
  }
  // ranking: 冠军在前
  t.ranking = [...t.seats].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)).map((s) => s.id);
}

export type ActInfo = {
  name: string;
  action: Action;
  amount?: number;
  streetBefore: string;
  streetAfter: string;
  message: string;
};

export function humanAct(t: Tournament, action: Action, raiseTo?: number): ActInfo | null {
  if (!t.engine || t.engine.street === "done") return null;
  const p = t.engine.players[t.engine.toAct];
  if (!p?.isHuman) return null;
  if (!legalActions(t.engine).includes(action) && action !== "allin") return null;
  const streetBefore = t.engine.street;
  applyAction(t.engine, action, raiseTo);
  syncChipsFromEngine(t);
  const amount =
    action === "raise" || action === "allin" || action === "call"
      ? t.engine.players[p.id].bet
      : undefined;
  return {
    name: p.name,
    action,
    amount,
    streetBefore,
    streetAfter: t.engine.street,
    message: t.engine.message,
  };
}

export function botAct(t: Tournament): ActInfo | null {
  if (!t.engine || t.engine.street === "done") return null;
  const p = t.engine.players[t.engine.toAct];
  if (!p || p.isHuman || !legalActions(t.engine).length) return null;
  const persona = t.seats[p.id].persona ?? "standard";
  const d = decide(t.engine, persona);
  const streetBefore = t.engine.street;
  applyAction(t.engine, d.action, d.raiseTo);
  syncChipsFromEngine(t);
  const amount =
    d.action === "raise" || d.action === "allin" || d.action === "call"
      ? t.engine.players[p.id].bet
      : undefined;
  return {
    name: p.name,
    action: d.action,
    amount,
    streetBefore,
    streetAfter: t.engine.street,
    message: t.engine.message,
  };
}

export function isHumanTurn(t: Tournament): boolean {
  if (!t.engine || t.engine.street === "done") return false;
  return !!t.engine.players[t.engine.toAct]?.isHuman && legalActions(t.engine).length > 0;
}
