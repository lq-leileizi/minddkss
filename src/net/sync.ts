import type { Card } from "../game/cards";
import { legalActions, raiseBounds, type Engine } from "../game/engine";
import type { Tournament } from "../game/tournament";
import type { PublicState } from "./types";

function holeForViewer(
  e: Engine | null,
  seatId: number,
  viewerSeat: number,
  atShowdown: boolean,
): Card[] | null {
  if (!e) return null;
  const p = e.players[seatId];
  if (!p || p.out) return [];
  if (p.folded && atShowdown) return [];
  if (seatId === viewerSeat) return p.hole.map((c) => ({ ...c }));
  if (atShowdown && !p.folded) return p.hole.map((c) => ({ ...c }));
  if (p.folded) return [];
  return null;
}

/** 为某视角序列化公开状态（含该座位合法动作） */
export function serializePublic(t: Tournament, viewerSeat: number): PublicState {
  const e = t.engine;
  const atShowdown = !!(e && (e.street === "done" || e.street === "showdown"));
  const seats = t.seats.map((s, i) => {
    const ep = e?.players[i];
    return {
      id: i,
      name: s.name,
      isHuman: s.isHuman,
      chips: ep ? ep.chips : s.chips,
      place: s.place,
      bet: ep?.bet ?? 0,
      folded: !!(ep?.folded || s.place !== null),
      out: s.place !== null || (ep?.out ?? false),
      hole: holeForViewer(e, i, viewerSeat, atShowdown),
    };
  });

  const state: PublicState = {
    hand: t.hand,
    button: t.button,
    over: t.over,
    street: e?.street ?? "done",
    pot: e?.pot ?? 0,
    board: (e?.board ?? []).map((c) => ({ ...c })),
    toAct: e?.toAct ?? -1,
    message: e?.message ?? "",
    currentBet: e?.currentBet ?? 0,
    seats,
    ranking: [...t.ranking],
  };

  if (e && e.street !== "done" && e.toAct === viewerSeat && e.players[viewerSeat]?.isHuman) {
    state.myLegal = legalActions(e);
    const b = raiseBounds(e);
    state.raiseMin = b.min;
    state.raiseMax = b.max;
  }
  return state;
}

/**
 * 嘉宾侧：用快照填充本地 Tournament（仅供 UI）。
 * hole===null → 引擎里 hole 空且标记 hidden，UI 画牌背。
 */
export function applyPublicState(t: Tournament, state: PublicState) {
  t.hand = state.hand;
  t.button = state.button ?? t.button;
  t.over = state.over;
  t.ranking = [...state.ranking];
  for (const s of state.seats) {
    const seat = t.seats[s.id];
    if (!seat) continue;
    seat.name = s.name;
    seat.isHuman = s.isHuman;
    seat.chips = s.chips;
    seat.place = s.place;
  }

  t.engine = {
    players: state.seats.map((s) => ({
      id: s.id,
      name: s.name,
      isHuman: s.isHuman,
      chips: s.chips,
      hole: s.hole ? s.hole.map((c) => ({ ...c })) : [],
      bet: s.bet,
      contributed: 0,
      folded: s.folded,
      allIn: false,
      out: s.out,
      hidden: s.hole === null,
    })),
    deck: [],
    board: state.board.map((c) => ({ ...c })),
    pot: state.pot,
    street: state.street as Engine["street"],
    button: state.button ?? 0,
    sb: 0,
    bb: 0,
    toAct: state.toAct,
    currentBet: state.currentBet,
    minRaise: 0,
    lastAggressor: -1,
    acted: new Set(),
    history: [],
    winners: [],
    message: state.message,
  };
}

export function mergeHoleIntoState(state: PublicState, seat: number, cards: Card[]): PublicState {
  return {
    ...state,
    seats: state.seats.map((s) =>
      s.id === seat ? { ...s, hole: cards.map((c) => ({ ...c })) } : s,
    ),
  };
}
