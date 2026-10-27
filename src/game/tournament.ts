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

const AI_NAMES = ["阿强", "Lisa", "老周", "Mia", "阿杰", "Nina", "大飞", "小北"];

export type SeatState = {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  place: number | null; // 已定名次 1..8
  persona?: Persona;
  playerId?: string;
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
  /** 单机：你在 0 号位；联机：本机座位 */
  localSeat: number;
};

export type CreateTournamentOpts = {
  /** 真人座位；缺省则仅 0 号为「你」 */
  humans?: { seat: number; name: string; playerId?: string }[];
  localSeat?: number;
};

export function createTournament(opts: CreateTournamentOpts = {}): Tournament {
  const humans = opts.humans ?? [{ seat: 0, name: "你" }];
  const humanBySeat = new Map(humans.map((h) => [h.seat, h]));
  let aiNameIdx = 0;
  const seats: SeatState[] = Array.from({ length: PLAYERS }, (_, id) => {
    const h = humanBySeat.get(id);
    if (h) {
      return {
        id,
        name: h.name,
        isHuman: true,
        chips: START_CHIPS,
        place: null,
        playerId: h.playerId,
      };
    }
    return {
      id,
      name: AI_NAMES[aiNameIdx++ % AI_NAMES.length],
      isHuman: false,
      chips: START_CHIPS,
      place: null,
    };
  });
  return {
    hand: 0,
    button: 0,
    seats,
    finishOrder: [],
    engine: null,
    personas: [],
    over: false,
    ranking: [],
    localSeat: opts.localSeat ?? humans[0]?.seat ?? 0,
  };
}

function alive(t: Tournament) {
  return t.seats.filter((s) => s.chips > 0 && s.place === null);
}

/** 金币场开一局新牌：沿用各自剩下的筹码。AI 输光才补到买入额，真人筹码不动。 */
export function beginCashHand(t: Tournament, sb: number, bb: number, aiRefill: number): Engine {
  t.over = false;
  t.finishOrder = [];
  t.ranking = [];
  t.engine = null;
  for (const s of t.seats) {
    s.place = null;
    if (!s.isHuman && s.chips <= 0) s.chips = aiRefill;
  }
  t.hand += 1;
  let b = t.button;
  for (let i = 0; i < PLAYERS; i++) {
    b = (t.button + 1 + i) % PLAYERS;
    if (t.seats[b].chips > 0) break;
  }
  t.button = b;
  const ai = t.seats.filter((s) => !s.isHuman).length;
  t.personas = rollPersonas(ai);
  let aiIdx = 0;
  for (const s of t.seats) {
    s.persona = s.isHuman ? undefined : t.personas[aiIdx++];
  }
  t.engine = createEngine(
    t.seats.map((s) => ({
      name: s.name,
      isHuman: s.isHuman,
      chips: s.chips,
    })),
    t.button,
    sb,
    bb,
  );
  return t.engine;
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
  if (t.engine.street !== "done") return;
  for (const s of t.seats) {
    if (s.place !== null) continue;
    if (s.chips <= 0 && !t.finishOrder.includes(s.id)) {
      t.finishOrder.push(s.id);
    }
  }
}

export function isSeatBusted(t: Tournament, seatId: number): boolean {
  return t.seats[seatId].chips <= 0 || t.finishOrder.includes(seatId);
}

/** 本机玩家是否已出局 */
export function isHumanBusted(t: Tournament): boolean {
  return isSeatBusted(t, t.localSeat);
}

export function afterHand(t: Tournament, opts?: { endIfLocalBusted?: boolean }) {
  syncChipsFromEngine(t);
  t.engine = null;
  const living = alive(t);
  const localBust = opts?.endIfLocalBusted && isHumanBusted(t);
  if (localBust || living.length <= 1 || t.hand >= MAX_HANDS) {
    endTournament(t);
  }
}

export function endTournament(t: Tournament) {
  if (t.over) return;
  t.over = true;
  t.engine = null;
  const placed = new Set<number>();
  let place = PLAYERS;
  for (const id of t.finishOrder) {
    if (placed.has(id)) continue;
    t.seats[id].place = place--;
    placed.add(id);
  }
  const survivors = t.seats
    .filter((s) => !placed.has(s.id))
    .sort((a, b) => b.chips - a.chips || a.id - b.id);
  for (const s of survivors) {
    s.place = place--;
    placed.add(s.id);
  }
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
  const p = t.engine.players[t.engine.toAct];
  return !!p?.isHuman && p.id === t.localSeat && legalActions(t.engine).length > 0;
}

/** 当前是否轮到任意真人（房主等待远端动作） */
export function isRemoteHumanTurn(t: Tournament): boolean {
  if (!t.engine || t.engine.street === "done") return false;
  const p = t.engine.players[t.engine.toAct];
  return !!p?.isHuman && p.id !== t.localSeat && legalActions(t.engine).length > 0;
}
