import type { Action } from "../game/engine";
import type { Card } from "../game/cards";

export type NetConfig = {
  url: string;
  anonKey: string;
};

export type LobbyPresence = {
  playerId: string;
  name: string;
  /** null = 仅在大厅浏览 */
  table: number | null;
};

export type SeatPresence = {
  playerId: string;
  name: string;
  seat: number;
  ready: boolean;
  joinedAt: number;
};

export type PublicSeatView = {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  place: number | null;
  bet: number;
  folded: boolean;
  out: boolean;
  /** 有牌面则展示；null 表示盖牌；空数组表示无牌 */
  hole: Card[] | null;
};

export type PublicState = {
  hand: number;
  button: number;
  over: boolean;
  street: string;
  pot: number;
  board: Card[];
  toAct: number;
  message: string;
  currentBet: number;
  seats: PublicSeatView[];
  ranking: number[];
  myLegal?: Action[];
  raiseMin?: number;
  raiseMax?: number;
};

export type GameMsg =
  | { type: "match_start"; seats: { seat: number; name: string; playerId: string }[]; fee: number }
  | { type: "state"; state: PublicState; forSeat: number }
  | { type: "hole"; seat: number; cards: Card[] }
  | { type: "action"; seat: number; action: Action; amount?: number; from: string }
  | { type: "match_over"; ranking: number[]; places: Record<number, number> }
  | { type: "chat_line"; text: string };
