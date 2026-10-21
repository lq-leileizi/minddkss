import {
  DAILY_CHECKIN_REWARD,
  ENTRY_FEE,
  MAX_HANDS,
  PRIZE,
  blindsForHand,
} from "./config";
import { cardLabel, isRed, type Card } from "./game/cards";
import {
  legalActions,
  raiseBounds,
  type Action,
} from "./game/engine";
import {
  afterHand,
  botAct,
  createTournament,
  humanAct,
  isHumanBusted,
  isHumanTurn,
  startHand,
  type ActInfo,
  type Tournament,
} from "./game/tournament";
import { SKINS } from "./shop/catalog";
import {
  buySkin,
  canCheckinToday,
  claimDailyCheckin,
  equipSkin,
  loadSave,
  writeSave,
} from "./store";
import { SEAT_POS } from "./ui/seats";
import {
  announceAction,
  announceResult,
  announceStreet,
  unlockAudio,
} from "./audio";

type Screen = "lobby" | "shop" | "table" | "result";

/** 思考停顿；真正节奏由荷官语音控 */
const BOT_DELAY_MIN = 350;
const BOT_DELAY_MAX = 700;
const CHIP_FLY_MS = 520;

export function boot(root: HTMLElement) {
  let save = loadSave();
  let screen: Screen = "lobby";
  let t: Tournament | null = null;
  let busy = false;
  let timer: number | null = null;
  let prevBets: number[] = Array(8).fill(0);
  let prevBoardLen = 0;
  let prevPot = 0;
  let tableBuilt = false;
  let lastMsg = "";
  let prizePaid = false;
  let raiseOpen = false;
  let autoSettleScheduled = false;

  function paint() {
    if (screen === "lobby") {
      tableBuilt = false;
      renderLobby();
    } else if (screen === "shop") {
      tableBuilt = false;
      renderShop();
    } else if (screen === "table") {
      renderTable();
    } else {
      tableBuilt = false;
      renderResult();
    }
  }

  function go(s: Screen) {
    screen = s;
    paint();
  }

  function renderLobby() {
    const checkinReady = canCheckinToday(save);
    root.innerHTML = `
      <div class="lobby">
        <h1>德州扑克</h1>
        <p>8 人单桌淘汰 · 最多 ${MAX_HANDS} 把 · AI 每把换人设</p>
        <div class="coins">金币 <strong>${save.coins}</strong></div>
        <button class="btn checkin" type="button" data-checkin ${checkinReady ? "" : "disabled"}>
          ${checkinReady ? `每日签到 +${DAILY_CHECKIN_REWARD}` : "今日已签到"}
        </button>
        <button class="btn" type="button" data-play ${save.coins < ENTRY_FEE ? "disabled" : ""}>
          进入牌桌（-${ENTRY_FEE}）
        </button>
        <button class="btn secondary" type="button" data-shop>皮肤商城</button>
        <p class="hint">冠军 ${PRIZE[1]} · 第4名 ${PRIZE[4]}（净+${PRIZE[4] - ENTRY_FEE}）</p>
      </div>`;
    root.querySelector("[data-checkin]")?.addEventListener("click", () => {
      const got = claimDailyCheckin(save);
      if (got == null) return;
      save = loadSave();
      paint();
    });
    root.querySelector("[data-play]")?.addEventListener("click", () => {
      if (save.coins < ENTRY_FEE) return;
      unlockAudio();
      save.coins -= ENTRY_FEE;
      writeSave(save);
      t = createTournament();
      startHand(t);
      prevBets = Array(8).fill(0);
      prevBoardLen = 0;
      prevPot = 0;
      tableBuilt = false;
      prizePaid = false;
      raiseOpen = false;
      autoSettleScheduled = false;
      go("table");
      schedule();
    });
    root.querySelector("[data-shop]")?.addEventListener("click", () => go("shop"));
  }

  function renderShop() {
    const groups = (["table", "card", "dealer"] as const).map((type) => {
      const items = SKINS.filter((s) => s.type === type)
        .map((s) => {
          const owned = save.owned.includes(s.id);
          const eq = save.equip[type] === s.id;
          return `<div class="shop-item ${eq ? "equipped" : ""}">
            <div class="shop-name">${s.name}</div>
            <div class="shop-price">${s.price === 0 ? "免费" : s.price + " 金币"}</div>
            <div class="shop-actions">
              ${
                owned
                  ? `<button class="btn secondary" data-eq="${s.id}" ${eq ? "disabled" : ""}>${eq ? "使用中" : "装备"}</button>`
                  : `<button class="btn" data-buy="${s.id}" ${save.coins < s.price ? "disabled" : ""}>购买</button>`
              }
            </div>
          </div>`;
        })
        .join("");
      const title = type === "table" ? "牌桌" : type === "card" ? "卡片" : "荷官";
      return `<section class="shop-sec"><h2>${title}</h2><div class="shop-grid">${items}</div></section>`;
    });

    root.innerHTML = `
      <div class="shop">
        <div class="hud">
          <button class="btn secondary" type="button" data-back>返回</button>
          <span>金币 <strong>${save.coins}</strong></span>
        </div>
        <div class="shop-body">${groups.join("")}</div>
      </div>`;
    root.querySelector("[data-back]")?.addEventListener("click", () => go("lobby"));
    root.querySelectorAll("[data-buy]").forEach((el) => {
      el.addEventListener("click", () => {
        const err = buySkin(save, (el as HTMLElement).dataset.buy!);
        if (err) alert(err);
        save = loadSave();
        paint();
      });
    });
    root.querySelectorAll("[data-eq]").forEach((el) => {
      el.addEventListener("click", () => {
        equipSkin(save, (el as HTMLElement).dataset.eq!);
        save = loadSave();
        paint();
      });
    });
  }

  function cardEl(c: Card | null | "back", animate = false, delay = 0): string {
    const delayStyle = animate ? ` style="animation-delay:${delay}ms"` : "";
    if (!c) return `<div class="card empty"></div>`;
    if (c === "back") {
      return `<div class="card back skin-${save.equip.card}${animate ? " deal" : ""}"${delayStyle}></div>`;
    }
    return `<div class="card ${isRed(c) ? "red" : ""}${animate ? " deal" : ""}"${delayStyle}><span>${cardLabel(c)}</span></div>`;
  }

  function ensureTableShell() {
    if (tableBuilt && root.querySelector(".table-screen")) return;
    const theme = save.equip.table;
    const dealer = save.equip.dealer;
    // catalog id: dealer_queen → CSS 修饰类 dealer-queen（勿拼成 dealer-dealer_queen）
    const dealerMod = dealer.replace(/^dealer_/, "dealer-");
    const seats = Array.from({ length: 8 }, (_, i) => {
      const pos = SEAT_POS[i];
      return `<div class="seat" data-seat="${i}" style="left:${pos.x}%;top:${pos.y}%">
        <div class="seat-bet-chip" data-bet-chip hidden></div>
        <div class="seat-avatar"></div>
        <div class="seat-name"></div>
        <div class="seat-chips"></div>
        <div class="seat-status"></div>
        <div class="seat-cards"></div>
      </div>`;
    }).join("");

    root.innerHTML = `
      <div class="table-screen theme-${theme}">
        <div class="hud">
          <span data-hud-hand></span>
          <span data-hud-blind></span>
          <span data-hud-coins></span>
        </div>
        <div class="dealer-bar">
          <div class="dealer dealer-beauty ${dealerMod}" data-dealer>
            <div class="dealer-figure">
              <div class="dealer-hair-back"></div>
              <div class="dealer-tail left"></div>
              <div class="dealer-tail right"></div>
              <div class="dealer-face">
                <div class="dealer-brow left"></div>
                <div class="dealer-brow right"></div>
                <div class="dealer-eye left"><span class="shine"></span><i class="lid"></i></div>
                <div class="dealer-eye right"><span class="shine"></span><i class="lid"></i></div>
                <div class="dealer-blush left"></div>
                <div class="dealer-blush right"></div>
                <div class="dealer-nose"></div>
                <div class="dealer-mouth"></div>
              </div>
              <div class="dealer-bang"></div>
              <div class="dealer-ahoge"></div>
              <div class="dealer-maid-band">
                <span class="frill"></span>
                <span class="flower"></span>
              </div>
              <div class="dealer-neck"></div>
              <div class="dealer-collar"></div>
              <div class="dealer-dress"></div>
              <div class="dealer-apron"></div>
              <div class="dealer-hand"></div>
            </div>
            <div class="dealer-meta">
              <div class="dealer-name">${SKINS.find((x) => x.id === dealer)?.name ?? "荷官"}</div>
              <div class="dealer-line" data-dealer-line>主人，请入座～</div>
            </div>
          </div>
        </div>
        <div class="stage">
          <div class="felt"></div>
          <div class="pot">
            <div class="pot-stack" data-pot-stack></div>
            <div class="label">底池</div>
            <div class="value" data-pot>0</div>
          </div>
          <div class="msg" data-msg></div>
          <div class="board" data-board></div>
          <div class="fx-layer" data-fx></div>
          ${seats}
        </div>
        <div class="raise-sheet" data-raise-sheet hidden>
          <div class="raise-card">
            <div class="raise-title">加注到</div>
            <div class="raise-value" data-raise-value>0</div>
            <input class="raise-range" type="range" data-raise-range />
            <input class="raise-input" type="number" data-raise-input inputmode="numeric" />
            <p class="raise-hint" data-raise-hint></p>
            <div class="raise-btns">
              <button class="btn secondary" type="button" data-raise-cancel>取消</button>
              <button class="btn" type="button" data-raise-ok>确认加注</button>
            </div>
          </div>
        </div>
        <div class="actions" data-actions></div>
      </div>`;
    tableBuilt = true;
    bindTableActions();
  }

  function bindTableActions() {
    const screenEl = root.querySelector(".table-screen");
    if (!screenEl || (screenEl as HTMLElement).dataset.bound) return;
    (screenEl as HTMLElement).dataset.bound = "1";

    screenEl.addEventListener("click", (ev) => {
      const el = (ev.target as HTMLElement).closest(
        "[data-act],[data-nexthand],[data-result],[data-raise-ok],[data-raise-cancel]",
      ) as HTMLElement | null;
      if (!el || !t) return;

      if (el.dataset.raiseCancel !== undefined) {
        hideRaiseSheet();
        return;
      }
      if (el.dataset.raiseOk !== undefined) {
        confirmRaise();
        return;
      }
      if (el.dataset.result !== undefined) {
        go("result");
        return;
      }
      if (el.dataset.nexthand !== undefined) {
        finishOrNextHand();
        return;
      }
      if (el.dataset.act && t.engine && !busy) {
        const act = el.dataset.act as Action;
        if (act === "raise") {
          openRaiseSheet();
          return;
        }
        void playHuman(act);
      }
    });

    const range = root.querySelector("[data-raise-range]") as HTMLInputElement | null;
    const input = root.querySelector("[data-raise-input]") as HTMLInputElement | null;
    range?.addEventListener("input", () => syncRaiseUI(Number(range.value)));
    input?.addEventListener("input", () => syncRaiseUI(Number(input.value)));
  }

  function openRaiseSheet() {
    if (!t?.engine) return;
    const { min, max } = raiseBounds(t.engine);
    const sheet = root.querySelector("[data-raise-sheet]") as HTMLElement | null;
    const range = root.querySelector("[data-raise-range]") as HTMLInputElement | null;
    const input = root.querySelector("[data-raise-input]") as HTMLInputElement | null;
    const hint = root.querySelector("[data-raise-hint]");
    if (!sheet || !range || !input) return;
    range.min = String(min);
    range.max = String(max);
    range.step = "1";
    range.value = String(min);
    input.min = String(min);
    input.max = String(max);
    input.value = String(min);
    if (hint) hint.textContent = `最小 ${min} · 最大 ${max}（全下）`;
    syncRaiseUI(min);
    sheet.hidden = false;
    raiseOpen = true;
  }

  function hideRaiseSheet() {
    const sheet = root.querySelector("[data-raise-sheet]") as HTMLElement | null;
    if (sheet) sheet.hidden = true;
    raiseOpen = false;
  }

  function syncRaiseUI(raw: number) {
    if (!t?.engine) return;
    const { min, max } = raiseBounds(t.engine);
    const v = Math.max(min, Math.min(max, Math.floor(raw) || min));
    const range = root.querySelector("[data-raise-range]") as HTMLInputElement | null;
    const input = root.querySelector("[data-raise-input]") as HTMLInputElement | null;
    const val = root.querySelector("[data-raise-value]");
    if (range) range.value = String(v);
    if (input) input.value = String(v);
    if (val) val.textContent = String(v);
  }

  function confirmRaise() {
    if (!t?.engine || busy) return;
    const input = root.querySelector("[data-raise-input]") as HTMLInputElement | null;
    const { min, max } = raiseBounds(t.engine);
    const raiseTo = Math.max(min, Math.min(max, Math.floor(Number(input?.value) || min)));
    hideRaiseSheet();
    void playHuman("raise", raiseTo);
  }

  async function playHuman(act: Action, raiseTo?: number) {
    if (!t?.engine || busy) return;
    busy = true;
    const before = t.engine.players.map((p) => p.bet);
    const info = humanAct(t, act, raiseTo);
    updateTable(false, before);
    if (info) await narrate(info);
    schedule();
  }

  async function narrate(info: ActInfo) {
    pokeDealer("talk");
    await announceAction(info.name, info.action, info.amount);
    if (info.streetAfter !== info.streetBefore) {
      if (info.streetAfter === "flop" || info.streetAfter === "turn" || info.streetAfter === "river") {
        pokeDealer("deal");
        await announceStreet(info.streetAfter);
      } else if (info.streetAfter === "done") {
        await announceResult(info.message);
      }
    } else if (info.streetAfter === "done") {
      await announceResult(info.message);
    }
  }

  function finishOrNextHand() {
    if (!t) return;
    afterHand(t);
    if (t.over || isHumanBusted(t)) {
      settlePrize();
      go("result");
      return;
    }
    startHand(t);
    prevBets = Array(8).fill(0);
    prevBoardLen = 0;
    prevPot = 0;
    raiseOpen = false;
    updateTable(true);
    schedule();
  }

  function pokeDealer(kind: "talk" | "deal") {
    const d = root.querySelector("[data-dealer]");
    if (!d) return;
    d.classList.remove("is-talk", "is-deal");
    void (d as HTMLElement).offsetWidth;
    d.classList.add(kind === "deal" ? "is-deal" : "is-talk");
  }

  function flyChip(fromSeat: number, amount: number) {
    const stage = root.querySelector(".stage") as HTMLElement | null;
    const fx = root.querySelector("[data-fx]") as HTMLElement | null;
    const seat = root.querySelector(`[data-seat="${fromSeat}"]`) as HTMLElement | null;
    const pot = root.querySelector(".pot") as HTMLElement | null;
    if (!stage || !fx || !seat || !pot || amount <= 0) return;

    const sr = seat.getBoundingClientRect();
    const pr = pot.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const x0 = sr.left + sr.width / 2 - st.left;
    const y0 = sr.top + sr.height / 2 - st.top;
    const x1 = pr.left + pr.width / 2 - st.left;
    const y1 = pr.top + pr.height / 2 - st.top;

    const chip = document.createElement("div");
    chip.className = "fly-chip";
    chip.textContent = String(amount);
    chip.style.left = `${x0}px`;
    chip.style.top = `${y0}px`;
    chip.style.setProperty("--dx", `${x1 - x0}px`);
    chip.style.setProperty("--dy", `${y1 - y0}px`);
    fx.appendChild(chip);
    window.setTimeout(() => chip.remove(), CHIP_FLY_MS + 40);
  }

  function updateTable(resetCards = false, betsBefore?: number[]) {
    if (!t) return;
    ensureTableShell();
    const e = t.engine;
    const [sb, bb] = blindsForHand(Math.max(1, t.hand));

    const handEl = root.querySelector("[data-hud-hand]");
    const blindEl = root.querySelector("[data-hud-blind]");
    const coinsEl = root.querySelector("[data-hud-coins]");
    if (handEl) handEl.innerHTML = `第 <strong>${t.hand}</strong> / ${MAX_HANDS} 把`;
    if (blindEl) blindEl.innerHTML = `盲注 <strong>${sb}/${bb}</strong>`;
    if (coinsEl) coinsEl.innerHTML = `金币 <strong>${save.coins}</strong>`;

    const msgText = e?.message ?? "";
    const msg = root.querySelector("[data-msg]");
    if (msg) msg.textContent = msgText;
    const line = root.querySelector("[data-dealer-line]");
    if (line && msgText && msgText !== lastMsg) {
      line.textContent = msgText;
      pokeDealer("talk");
    }
    lastMsg = msgText;

    const potEl = root.querySelector("[data-pot]");
    const potNow = e?.pot ?? 0;
    if (potEl) potEl.textContent = String(potNow);

    // 筹码飞入
    if (e && betsBefore) {
      e.players.forEach((p, i) => {
        const delta = p.bet - (betsBefore[i] ?? 0);
        if (delta > 0) flyChip(i, delta);
      });
    } else if (e) {
      e.players.forEach((p, i) => {
        const delta = p.bet - (prevBets[i] ?? 0);
        if (delta > 0) flyChip(i, delta);
      });
    }

    const board = e?.board ?? [];
    const boardWrap = root.querySelector("[data-board]");
    if (boardWrap) {
      const grew = board.length > prevBoardLen;
      if (grew) pokeDealer("deal");
      boardWrap.innerHTML = [0, 1, 2, 3, 4]
        .map((i) => cardEl(board[i] ?? null, grew && i >= prevBoardLen, (i - prevBoardLen) * 80))
        .join("");
      prevBoardLen = board.length;
    }

    t.seats.forEach((s, i) => {
      const node = root.querySelector(`[data-seat="${i}"]`) as HTMLElement | null;
      if (!node) return;
      const ep = e?.players[i];
      const chips = ep ? ep.chips : s.chips;
      const bet = ep?.bet ?? 0;
      const folded = !!(ep?.folded || s.place !== null);
      const out = s.place !== null || (ep?.out ?? (s.chips <= 0 && !e));
      const turn = !!(e && e.street !== "done" && e.toAct === i);

      node.className = [
        "seat",
        s.isHuman ? "you" : "",
        folded ? "folded" : "",
        out ? "out" : "",
        turn ? "turn" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const av = node.querySelector(".seat-avatar");
      if (av) av.textContent = s.isHuman ? "你" : String(i);
      const name = node.querySelector(".seat-name");
      if (name) name.textContent = s.name;
      const atShowdown = !!(e && (e.street === "done" || e.street === "showdown"));
      const ch = node.querySelector(".seat-chips");
      if (ch) ch.textContent = String(chips);
      const st = node.querySelector(".seat-status");
      if (st) {
        st.textContent = out ? `第${s.place ?? "?"}名` : "";
      }

      const betChip = node.querySelector("[data-bet-chip]") as HTMLElement | null;
      if (betChip) {
        if (bet > 0 && !out) {
          betChip.hidden = false;
          betChip.textContent = String(bet);
        } else {
          betChip.hidden = true;
        }
      }

      const cards = node.querySelector(".seat-cards");
      if (cards && ep && !out) {
        // 摊牌只亮未弃牌者的牌；弃牌的不展示
        const showFace =
          s.isHuman || (atShowdown && !ep.folded);
        if (ep.folded && atShowdown) {
          cards.innerHTML = "";
        } else if (showFace) {
          cards.innerHTML = ep.hole.map((c) => cardEl(c, resetCards)).join("");
        } else if (!ep.folded) {
          cards.innerHTML = cardEl("back") + cardEl("back");
        } else {
          cards.innerHTML = "";
        }
      } else if (cards) {
        cards.innerHTML = "";
      }
    });

    if (e) prevBets = e.players.map((p) => p.bet);
    prevPot = potNow;

    const actions = root.querySelector("[data-actions]");
    if (actions && !raiseOpen) {
      const acts = e && isHumanTurn(t) ? legalActions(e) : [];
      const toCall = e && e.players[0] ? Math.max(0, e.currentBet - e.players[0].bet) : 0;
      if (t.over) {
        actions.innerHTML = `<button class="btn" type="button" data-result>查看结算</button>`;
      } else if (e?.street === "done") {
        if (isHumanBusted(t)) {
          actions.innerHTML = `<button class="btn" type="button" data-nexthand>你已淘汰 · 立即结算</button>`;
        } else {
          actions.innerHTML = `<button class="btn" type="button" data-nexthand>下一把</button>`;
        }
      } else {
        actions.innerHTML = `
          <button class="btn danger" type="button" data-act="fold" ${acts.includes("fold") ? "" : "disabled"}>弃牌</button>
          <button class="btn secondary" type="button" data-act="check" ${acts.includes("check") ? "" : "disabled"}>过牌</button>
          <button class="btn secondary" type="button" data-act="call" ${acts.includes("call") ? "" : "disabled"}>跟注${toCall > 0 ? " " + toCall : ""}</button>
          <button class="btn" type="button" data-act="raise" ${acts.includes("raise") ? "" : "disabled"}>加注</button>
          <button class="btn secondary" type="button" data-act="allin" ${acts.includes("allin") ? "" : "disabled"}>全下</button>`;
      }
    }

    // 一手结束且你已输光：自动结算离场（不必等其他人）
    if (e?.street === "done" && isHumanBusted(t) && !t.over && !autoSettleScheduled) {
      autoSettleScheduled = true;
      const line = root.querySelector("[data-dealer-line]");
      if (line) line.textContent = "你已淘汰，正在结算…";
      pokeDealer("talk");
      window.setTimeout(() => {
        if (!t || t.over) return;
        finishOrNextHand();
      }, 1000);
    }
  }

  function renderTable() {
    updateTable(true);
  }

  function settlePrize() {
    if (!t || prizePaid) return;
    prizePaid = true;
    const me = t.seats[0];
    const place = me.place ?? 8;
    const prize = PRIZE[place] ?? 0;
    save.coins += prize;
    writeSave(save);
  }

  function renderResult() {
    if (!t) return;
    const rows = t.ranking
      .map((id) => {
        const s = t!.seats[id];
        const prize = PRIZE[s.place ?? 8] ?? 0;
        const you = s.isHuman ? "（你）" : "";
        return `<tr class="${s.isHuman ? "you-row" : ""}">
          <td>${s.place}</td><td>${s.name}${you}</td><td>${s.chips}</td><td>+${prize}</td>
        </tr>`;
      })
      .join("");
    const myPlace = t.seats[0].place ?? 8;
    const bustHint = myPlace > 1 ? `<p class="hint">你已出局，按淘汰名次结算</p>` : "";
    root.innerHTML = `
      <div class="result">
        <h1>本局结束</h1>
        <p>你获得第 <strong>${myPlace}</strong> 名 · 奖金 <strong>${PRIZE[myPlace]}</strong></p>
        ${bustHint}
        <p class="coins">当前金币 <strong>${save.coins}</strong></p>
        <table class="rank-table">
          <thead><tr><th>名次</th><th>玩家</th><th>筹码</th><th>奖金</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="btn" type="button" data-home>返回大厅</button>
      </div>`;
    root.querySelector("[data-home]")?.addEventListener("click", () => {
      t = null;
      go("lobby");
    });
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!t || !t.engine || t.over || raiseOpen) return;
    if (t.engine.street === "done") {
      updateTable(false);
      busy = false;
      return;
    }
    if (isHumanTurn(t)) {
      busy = false;
      updateTable(false);
      return;
    }
    busy = true;
    const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
    timer = window.setTimeout(() => {
      void (async () => {
        if (!t?.engine || raiseOpen) return;
        const before = t.engine.players.map((p) => p.bet);
        const info = botAct(t);
        updateTable(false, before);
        // 先等筹码动画一点，再播荷官语音；说完才轮下一位
        await new Promise((r) => setTimeout(r, CHIP_FLY_MS * 0.45));
        if (info) await narrate(info);
        schedule();
      })();
    }, delay);
  }

  paint();
}
