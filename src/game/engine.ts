import { type Card, freshDeck, shuffle } from "./cards";
import { bestHand, cmpHand } from "./handEval";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "done";

export type Player = {
  id: number;
  name: string;
  isHuman: boolean;
  chips: number;
  hole: Card[];
  bet: number; // 本街已投入
  contributed: number; // 本手总投入（边池）
  folded: boolean;
  allIn: boolean;
  out: boolean; // 整场淘汰
  /** 联机嘉宾视角：底牌未知，UI 画牌背 */
  hidden?: boolean;
};

export type Action = "fold" | "check" | "call" | "raise" | "allin";

/** 本手已经发生的行动，供 AI 看弃牌、跟注和加注尺度。 */
export type HandAction = {
  street: "preflop" | "flop" | "turn" | "river";
  seat: number;
  action: Action;
  /** 这次实际投入的筹码 */
  paid: number;
  /** 行动后本街自己的下注额 */
  betTo: number;
  /** 行动前的底池 */
  potBefore: number;
  /** 这次把本街最高注抬上去了（加注或加注型全下） */
  raised: boolean;
};

export type Engine = {
  players: Player[];
  deck: Card[];
  board: Card[];
  pot: number;
  street: Street;
  button: number; // 庄位 index
  sb: number;
  bb: number;
  toAct: number; // 当前行动玩家
  currentBet: number; // 本街需跟到的额度
  minRaise: number;
  lastAggressor: number;
  acted: Set<number>;
  history: HandAction[];
  winners: { ids: number[]; amount: number; handName?: string }[];
  message: string;
};

function inHand(p: Player) {
  return !p.out && !p.folded;
}

function canAct(p: Player) {
  return inHand(p) && !p.allIn && p.chips > 0;
}

function nextSeat(e: Engine, from: number, pred: (p: Player) => boolean): number {
  const n = e.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (pred(e.players[idx])) return idx;
  }
  return from;
}

function activeCount(e: Engine) {
  return e.players.filter(inHand).length;
}

export function createEngine(
  seats: { name: string; isHuman: boolean; chips: number }[],
  button: number,
  sb: number,
  bb: number,
): Engine {
  const players: Player[] = seats.map((s, id) => ({
    id,
    name: s.name,
    isHuman: s.isHuman,
    chips: s.chips,
    hole: [],
    bet: 0,
    contributed: 0,
    folded: s.chips <= 0,
    allIn: false,
    out: s.chips <= 0,
  }));

  const e: Engine = {
    players,
    deck: shuffle(freshDeck()),
    board: [],
    pot: 0,
    street: "preflop",
    button,
    sb,
    bb,
    toAct: 0,
    currentBet: 0,
    minRaise: bb,
    lastAggressor: -1,
    acted: new Set(),
    history: [],
    winners: [],
    message: "",
  };
  dealHole(e);
  postBlinds(e);
  return e;
}

function take(e: Engine, p: Player, amount: number): number {
  const pay = Math.min(amount, p.chips);
  p.chips -= pay;
  p.bet += pay;
  p.contributed += pay;
  e.pot += pay;
  if (p.chips === 0) p.allIn = true;
  return pay;
}

function dealHole(e: Engine) {
  for (let r = 0; r < 2; r++) {
    for (const p of e.players) {
      if (p.out) continue;
      p.hole.push(e.deck.pop()!);
    }
  }
}

function postBlinds(e: Engine) {
  const sbI = nextSeat(e, e.button, (p) => !p.out);
  const bbI = nextSeat(e, sbI, (p) => !p.out);
  take(e, e.players[sbI], e.sb);
  take(e, e.players[bbI], e.bb);
  e.currentBet = Math.max(e.players[sbI].bet, e.players[bbI].bet);
  e.minRaise = e.bb;
  e.lastAggressor = bbI;
  e.toAct = nextSeat(e, bbI, canAct);
  e.acted = new Set();
  e.message = `盲注 ${e.sb}/${e.bb}`;
  // 短桌：若只剩 1 人能行动，直接进翻牌
  if (activeCount(e) < 2) finishByFold(e);
}

export function legalActions(e: Engine): Action[] {
  const p = e.players[e.toAct];
  if (!canAct(p) || e.street === "showdown" || e.street === "done") return [];
  const toCall = e.currentBet - p.bet;
  const acts: Action[] = ["fold"];
  if (toCall <= 0) acts.push("check");
  else if (p.chips > toCall) acts.push("call");
  if (p.chips > toCall) acts.push("raise");
  if (p.chips > 0) acts.push("allin");
  return acts;
}

export function raiseSize(e: Engine): number {
  // 最小加注到：currentBet + minRaise
  return e.currentBet + e.minRaise;
}

/** 加注目标总额（本街 bet 加总后的数值）：最小加注 ~ 全下 */
export function raiseBounds(e: Engine): { min: number; max: number } {
  const p = e.players[e.toAct];
  const min = raiseSize(e);
  const max = p.bet + p.chips;
  return { min, max: Math.max(min, max) };
}

export function applyAction(e: Engine, action: Action, raiseTo?: number): void {
  const p = e.players[e.toAct];
  if (!canAct(p)) return;
  const toCall = e.currentBet - p.bet;
  const potBefore = e.pot;
  const prevBet = e.currentBet;

  if (action === "fold") {
    p.folded = true;
    e.message = `${p.name} 弃牌`;
  } else if (action === "check") {
    if (toCall > 0) return;
    e.message = `${p.name} 过牌`;
  } else if (action === "call") {
    take(e, p, toCall);
    e.message = `${p.name} 跟注`;
  } else if (action === "raise") {
    const target = Math.max(raiseTo ?? raiseSize(e), raiseSize(e));
    const need = Math.min(target - p.bet, p.chips);
    const prev = e.currentBet;
    take(e, p, need);
    if (p.bet > e.currentBet) {
      e.minRaise = Math.max(e.bb, p.bet - prev);
      e.currentBet = p.bet;
      e.lastAggressor = p.id;
      e.acted = new Set([p.id]);
    }
    e.message = `${p.name} 加注到 ${e.currentBet}`;
  } else if (action === "allin") {
    const prev = e.currentBet;
    take(e, p, p.chips);
    if (p.bet > e.currentBet) {
      e.minRaise = Math.max(e.bb, p.bet - prev);
      e.currentBet = p.bet;
      e.lastAggressor = p.id;
      e.acted = new Set([p.id]);
    }
    e.message = `${p.name} 全下`;
  }

  if (e.street === "preflop" || e.street === "flop" || e.street === "turn" || e.street === "river") {
    e.history.push({
      street: e.street,
      seat: p.id,
      action,
      paid: e.pot - potBefore,
      betTo: p.bet,
      potBefore,
      raised: (action === "raise" || action === "allin") && p.bet > prevBet,
    });
  }

  e.acted.add(p.id);
  advance(e);
}

function everyoneMatched(e: Engine): boolean {
  const needAct = e.players.filter(canAct);
  if (needAct.length === 0) return true;
  for (const p of needAct) {
    if (p.bet !== e.currentBet) return false;
    if (!e.acted.has(p.id)) return false;
  }
  return true;
}

function advance(e: Engine) {
  const contenders = e.players.filter(inHand);
  if (contenders.length === 1) {
    finishByFold(e);
    return;
  }
  if (!everyoneMatched(e)) {
    e.toAct = nextSeat(e, e.toAct, canAct);
    return;
  }
  // 进入下一街
  nextStreet(e);
}

function clearBets(e: Engine) {
  for (const p of e.players) p.bet = 0;
  e.currentBet = 0;
  e.minRaise = e.bb;
  e.acted = new Set();
  e.lastAggressor = -1;
}

function dealBoard(e: Engine, n: number) {
  e.deck.pop(); // burn
  for (let i = 0; i < n; i++) e.board.push(e.deck.pop()!);
}

function nextStreet(e: Engine) {
  clearBets(e);
  if (e.street === "preflop") {
    e.street = "flop";
    dealBoard(e, 3);
    e.message = "翻牌";
  } else if (e.street === "flop") {
    e.street = "turn";
    dealBoard(e, 1);
    e.message = "转牌";
  } else if (e.street === "turn") {
    e.street = "river";
    dealBoard(e, 1);
    e.message = "河牌";
  } else if (e.street === "river") {
    showdown(e);
    return;
  }

  const actors = e.players.filter(canAct);
  if (actors.length === 0) {
    // 全员 all-in，直接发完
    while (e.street !== "river" && e.street !== "showdown") {
      if (e.street === "flop") {
        e.street = "turn";
        dealBoard(e, 1);
      } else if (e.street === "turn") {
        e.street = "river";
        dealBoard(e, 1);
      } else break;
    }
    showdown(e);
    return;
  }
  e.toAct = nextSeat(e, e.button, canAct);
}

function finishByFold(e: Engine) {
  const w = e.players.find(inHand)!;
  w.chips += e.pot;
  e.winners = [{ ids: [w.id], amount: e.pot }];
  e.pot = 0;
  e.street = "done";
  e.message = `${w.name} 赢得底池`;
}

function showdown(e: Engine) {
  e.street = "showdown";
  const contenders = e.players.filter(inHand);
  // 主池简化：按贡献分层边池
  const levels = [...new Set(contenders.map((p) => p.contributed))].sort((a, b) => a - b);
  let prev = 0;
  const pots: { amount: number; eligible: Player[] }[] = [];
  for (const lvl of levels) {
    const eligible = e.players.filter((p) => !p.out && p.contributed >= lvl);
    let am = 0;
    for (const p of e.players) {
      if (p.out) continue;
      am += Math.max(0, Math.min(p.contributed, lvl) - prev);
    }
    if (am > 0) pots.push({ amount: am, eligible: eligible.filter(inHand) });
    prev = lvl;
  }

  e.winners = [];
  for (const pot of pots) {
    if (!pot.eligible.length) continue;
    let best = pot.eligible.map((p) => ({
      p,
      h: bestHand([...p.hole, ...e.board]),
    }));
    best.sort((a, b) => cmpHand(b.h, a.h));
    const top = best[0].h;
    const winners = best.filter((x) => cmpHand(x.h, top) === 0).map((x) => x.p);
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const w of winners) {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      w.chips += share + extra;
    }
    e.winners.push({
      ids: winners.map((w) => w.id),
      amount: pot.amount,
      handName: best[0].h.name,
    });
  }
  e.pot = 0;
  e.street = "done";
  const names = e.winners[0]
    ? e.players
        .filter((p) => e.winners[0].ids.includes(p.id))
        .map((p) => p.name)
        .join(",")
    : "";
  e.message = `摊牌：${names} 获胜` + (e.winners[0]?.handName ? `（${e.winners[0].handName}）` : "");
}

export function snapshotChips(e: Engine): number[] {
  return e.players.map((p) => p.chips);
}
