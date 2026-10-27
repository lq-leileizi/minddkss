import {
  DAILY_CHECKIN_REWARD,
  ENTRY_FEE,
  MAX_HANDS,
  PRIZE,
  TABLE_COUNT,
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
  isRemoteHumanTurn,
  startHand,
  type ActInfo,
  type Tournament,
} from "./game/tournament";
import {
  getNickname,
  loadNetConfig,
  saveNetConfig,
  setNickname,
} from "./net/config";
import { joinLobby, type LobbyHandle } from "./net/lobby";
import {
  allHumansReady,
  joinTable,
  type RoomHandle,
  type RoomMember,
} from "./net/room";
import { isNetConfigured, resetSupabase } from "./net/supabase";
import { applyPublicState, serializePublic } from "./net/sync";
import type { GameMsg } from "./net/types";
import { getPlayerId } from "./net/config";
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
import { aimDealer, flyDealCard, resetDealerAim } from "./ui/dealerDeal";
import {
  destroyLive2D,
  lookLive2DAt,
  mountLive2D,
  resetLive2DLook,
  setLive2DTalking,
} from "./ui/live2dDealer";
import {
  announceAction,
  announceResult,
  announceStreet,
  unlockAudio,
} from "./audio";

type Screen =
  | "lobby"
  | "shop"
  | "onlineSetup"
  | "onlineLobby"
  | "onlineRoom"
  | "table"
  | "result";

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

  /** 联机 */
  let onlineMatch = false;
  let lobbyH: LobbyHandle | null = null;
  let roomH: RoomHandle | null = null;
  let roomMembers: RoomMember[] = [];
  let tableCounts: number[] = Array(TABLE_COUNT).fill(0);
  let currentTableNo = 0;
  let guestLegal: Action[] | null = null;
  let guestRaise: { min: number; max: number } | null = null;
  let remoteResolver: ((msg: Extract<GameMsg, { type: "action" }>) => void) | null = null;
  let hostAdvancing = false;
  /** 已播过发牌动画的把数；-1 表示还没发过 */
  let animHand = -1;
  let holesShown = Array(8).fill(2);
  let boardShown = 5;
  let holeJob = 0;
  let boardJob = 0;
  let dealingHoles = false;
  let dealingBoard = false;
  let boardWaiters: (() => void)[] = [];

  function paint() {
    if (screen !== "table") destroyLive2D();
    if (screen === "lobby") {
      tableBuilt = false;
      renderLobby();
    } else if (screen === "shop") {
      tableBuilt = false;
      renderShop();
    } else if (screen === "onlineSetup") {
      tableBuilt = false;
      renderOnlineSetup();
    } else if (screen === "onlineLobby") {
      tableBuilt = false;
      renderOnlineLobby();
    } else if (screen === "onlineRoom") {
      tableBuilt = false;
      renderOnlineRoom();
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

  function stopLobby() {
    lobbyH?.stop();
    lobbyH = null;
  }

  async function leaveRoom() {
    remoteResolver = null;
    try {
      await roomH?.leave();
    } catch {
      /* ignore */
    }
    roomH = null;
    roomMembers = [];
    currentTableNo = 0;
    onlineMatch = false;
    guestLegal = null;
    guestRaise = null;
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
          单机牌桌（-${ENTRY_FEE}）
        </button>
        <button class="btn online" type="button" data-online>朋友联机大厅</button>
        <button class="btn secondary" type="button" data-shop>皮肤商城</button>
        <p class="hint">冠军 ${PRIZE[1]} · 第4名 ${PRIZE[4]}（净+${PRIZE[4] - ENTRY_FEE}）</p>
      </div>`;
    root.querySelector("[data-checkin]")?.addEventListener("click", () => {
      if (claimDailyCheckin(save) == null) return;
      save = loadSave();
      paint();
    });
    root.querySelector("[data-play]")?.addEventListener("click", () => {
      if (save.coins < ENTRY_FEE) return;
      unlockAudio();
      save.coins -= ENTRY_FEE;
      writeSave(save);
      onlineMatch = false;
      t = createTournament();
      startHand(t);
      resetTableRuntime();
      go("table");
      schedule();
    });
    root.querySelector("[data-online]")?.addEventListener("click", () => {
      unlockAudio();
      if (!isNetConfigured()) {
        go("onlineSetup");
        return;
      }
      void enterOnlineLobby();
    });
    root.querySelector("[data-shop]")?.addEventListener("click", () => go("shop"));
  }

  function renderOnlineSetup() {
    const cfg = loadNetConfig();
    root.innerHTML = `
      <div class="lobby online-setup">
        <h1>联机设置</h1>
        <p class="hint">建一个免费 Supabase 项目（区选新加坡），把 URL 与 anon key 填在下面。朋友共用同一套即可。</p>
        <label class="field">昵称<input data-nick value="${escapeAttr(getNickname())}" maxlength="12" /></label>
        <label class="field">Supabase URL<input data-url value="${escapeAttr(cfg?.url ?? "")}" placeholder="https://xxx.supabase.co" /></label>
        <label class="field">Anon Key<textarea data-key rows="3" placeholder="eyJhbGciOi...">${escapeAttr(cfg?.anonKey ?? "")}</textarea></label>
        <button class="btn" type="button" data-save>保存并进入大厅</button>
        <button class="btn secondary" type="button" data-back>返回</button>
      </div>`;
    root.querySelector("[data-back]")?.addEventListener("click", () => go("lobby"));
    root.querySelector("[data-save]")?.addEventListener("click", () => {
      const nick = (root.querySelector("[data-nick]") as HTMLInputElement).value;
      const url = (root.querySelector("[data-url]") as HTMLInputElement).value.trim();
      const anonKey = (root.querySelector("[data-key]") as HTMLTextAreaElement).value.trim();
      setNickname(nick);
      if (!url || !anonKey) {
        alert("请填写 URL 与 Anon Key");
        return;
      }
      saveNetConfig({ url, anonKey });
      resetSupabase();
      void enterOnlineLobby();
    });
  }

  async function enterOnlineLobby() {
    stopLobby();
    await leaveRoom();
    try {
      lobbyH = joinLobby((counts) => {
        tableCounts = counts;
        if (screen === "onlineLobby") paint();
      });
      go("onlineLobby");
    } catch (e) {
      alert(e instanceof Error ? e.message : "无法连接联机服务");
      go("onlineSetup");
    }
  }

  function renderOnlineLobby() {
    const cells = tableCounts
      .map((n, i) => {
        const no = i + 1;
        const full = n >= 8;
        return `<button type="button" class="table-cell ${n > 0 ? "hot" : ""} ${full ? "full" : ""}" data-join="${no}" ${full ? "disabled" : ""}>
          <span class="tn">桌 ${no}</span>
          <span class="tc">${n}/8</span>
        </button>`;
      })
      .join("");
    root.innerHTML = `
      <div class="online-lobby">
        <div class="hud">
          <button class="btn secondary" type="button" data-back>返回</button>
          <span>${escapeHtml(getNickname())} · 金币 <strong>${save.coins}</strong></span>
          <button class="btn secondary" type="button" data-cfg>设置</button>
        </div>
        <p class="ol-hint">选桌入座 · 全员准备后开赛（-${ENTRY_FEE}/人）· 空位补 AI</p>
        <div class="table-grid">${cells}</div>
      </div>`;
    root.querySelector("[data-back]")?.addEventListener("click", () => {
      stopLobby();
      go("lobby");
    });
    root.querySelector("[data-cfg]")?.addEventListener("click", () => {
      stopLobby();
      go("onlineSetup");
    });
    root.querySelectorAll("[data-join]").forEach((el) => {
      el.addEventListener("click", () => {
        const no = Number((el as HTMLElement).dataset.join);
        void enterTable(no);
      });
    });
  }

  async function enterTable(tableNo: number) {
    if (save.coins < ENTRY_FEE) {
      alert(`金币不足（需要 ${ENTRY_FEE}）`);
      return;
    }
    try {
      await leaveRoom();
      currentTableNo = tableNo;
      await lobbyH?.setTable(tableNo);
      roomH = await joinTable(tableNo, {
        onMembers: (m) => {
          roomMembers = m;
          if (screen === "onlineRoom") paint();
          if (onlineMatch && roomH?.amHost()) maybeHostStart();
        },
        onMessage: (msg) => void onGameMsg(msg),
      });
      roomMembers = roomH.getMembers();
      go("onlineRoom");
    } catch (e) {
      alert(e instanceof Error ? e.message : "入桌失败");
      await lobbyH?.setTable(null);
    }
  }

  function renderOnlineRoom() {
    const me = getPlayerId();
    const my = roomMembers.find((m) => m.playerId === me);
    const host = roomMembers.find((m) => m.isHost);
    const readyAll = allHumansReady(roomMembers);
    const seats = Array.from({ length: 8 }, (_, i) => {
      const m = roomMembers.find((x) => x.seat === i);
      if (!m) return `<div class="or-seat empty">空 · AI</div>`;
      return `<div class="or-seat ${m.playerId === me ? "me" : ""} ${m.ready ? "ready" : ""}">
        <div>${escapeHtml(m.name)}${m.isHost ? " ·房主" : ""}</div>
        <div class="or-st">${m.ready ? "已准备" : "未准备"}</div>
      </div>`;
    }).join("");
    root.innerHTML = `
      <div class="online-room">
        <div class="hud">
          <button class="btn secondary" type="button" data-leave>离桌</button>
          <span>桌 ${currentTableNo} · ${roomMembers.length}/8</span>
        </div>
        <p class="hint">房主：${escapeHtml(host?.name ?? "-")} · 真人全准备后自动开赛，空位补 AI</p>
        <div class="or-grid">${seats}</div>
        <button class="btn ${my?.ready ? "secondary" : "checkin"}" type="button" data-ready>
          ${my?.ready ? "取消准备" : "准备"}
        </button>
        <p class="hint">${readyAll ? "全员已准备，房主正在开局…" : `还需准备：${roomMembers.filter((m) => !m.ready).map((m) => m.name).join("、") || "—"}`}</p>
      </div>`;
    root.querySelector("[data-leave]")?.addEventListener("click", () => {
      void (async () => {
        await leaveRoom();
        await lobbyH?.setTable(null);
        go("onlineLobby");
      })();
    });
    root.querySelector("[data-ready]")?.addEventListener("click", () => {
      if (!my || !roomH) return;
      if (!my.ready && save.coins < ENTRY_FEE) {
        alert(`金币不足（需要 ${ENTRY_FEE}）`);
        return;
      }
      void roomH.setReady(!my.ready).then(() => {
        roomMembers = roomH!.getMembers();
        paint();
        if (roomH!.amHost()) maybeHostStart();
      });
    });
    if (roomH?.amHost()) maybeHostStart();
  }

  let starting = false;
  function maybeHostStart() {
    if (!roomH?.amHost() || onlineMatch || starting) return;
    if (!allHumansReady(roomMembers)) return;
    starting = true;
    void (async () => {
      try {
        const humans = roomMembers
          .slice()
          .sort((a, b) => a.seat - b.seat)
          .map((m) => ({ seat: m.seat, name: m.name, playerId: m.playerId }));
        await roomH!.send({ type: "match_start", seats: humans, fee: ENTRY_FEE });
        beginOnlineMatch(humans, true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "开局失败");
      } finally {
        starting = false;
      }
    })();
  }

  function beginOnlineMatch(
    humans: { seat: number; name: string; playerId: string }[],
    asHost: boolean,
  ) {
    if (save.coins < ENTRY_FEE) {
      alert("金币不足");
      return;
    }
    save.coins -= ENTRY_FEE;
    writeSave(save);
    const mySeat = roomH?.getMySeat() ?? humans.find((h) => h.playerId === getPlayerId())?.seat ?? 0;
    onlineMatch = true;
    t = createTournament({ humans, localSeat: mySeat });
    resetTableRuntime();
    go("table");
    if (asHost) {
      startHand(t);
      void hostPushState();
      schedule();
    }
  }

  async function onGameMsg(msg: GameMsg) {
    if (msg.type === "match_start") {
      // 房主已在本地开局；避免广播回环重复开局
      if (onlineMatch || roomH?.amHost()) return;
      beginOnlineMatch(msg.seats, false);
      return;
    }
    if (msg.type === "action") {
      if (roomH?.amHost() && remoteResolver) {
        remoteResolver(msg);
        remoteResolver = null;
      }
      return;
    }
    if (msg.type === "state") {
      if (roomH?.amHost()) return;
      const mySeat = roomH?.getMySeat();
      if (mySeat != null && msg.forSeat !== mySeat) return;
      if (!t) return;
      applyPublicState(t, msg.state);
      guestLegal = msg.state.myLegal ?? null;
      guestRaise =
        msg.state.raiseMin != null && msg.state.raiseMax != null
          ? { min: msg.state.raiseMin, max: msg.state.raiseMax }
          : null;
      if (t.over) {
        settlePrize();
        go("result");
        return;
      }
      busy = false;
      updateTable(false);
      return;
    }
    if (msg.type === "match_over") {
      if (!t) return;
      for (const [sid, place] of Object.entries(msg.places)) {
        t.seats[Number(sid)].place = place;
      }
      t.ranking = msg.ranking;
      t.over = true;
      t.engine = null;
      settlePrize();
      go("result");
    }
  }

  async function hostPushState() {
    if (!roomH || !t || !roomH.amHost()) return;
    for (const s of t.seats.filter((x) => x.isHuman)) {
      await roomH.send({
        type: "state",
        state: serializePublic(t, s.id),
        forSeat: s.id,
      });
    }
  }

  function resetTableRuntime() {
    prevBets = Array(8).fill(0);
    prevBoardLen = 0;
    prevPot = 0;
    tableBuilt = false;
    prizePaid = false;
    raiseOpen = false;
    autoSettleScheduled = false;
    lastMsg = "";
    hostAdvancing = false;
    guestLegal = null;
    guestRaise = null;
    animHand = -1;
    holesShown = Array(8).fill(2);
    boardShown = 5;
    holeJob += 1;
    boardJob += 1;
    dealingHoles = false;
    dealingBoard = false;
    const pending = boardWaiters;
    boardWaiters = [];
    pending.forEach((fn) => fn());
  }

  function renderShop() {
    const groups = (["table", "card", "dealer"] as const).map((type) => {
      const items = SKINS.filter((s) => s.type === type)
        .map((s) => {
          const owned = save.owned.includes(s.id);
          const eq = save.equip[type] === s.id;
          const art = type === "dealer" ? `<img class="shop-art" src="./dealers/${s.id}.jpg" alt="" />` : "";
          return `<div class="shop-item ${eq ? "equipped" : ""}">
            ${art}
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
    const dealerMod = dealer.replace(/^dealer_/, "dealer-");
    const dealerArt = `./dealers/${dealer}${dealer === "dealer_default" ? ".jpg" : ".png"}`;
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
          <div class="dealer ${dealerMod}" data-dealer>
            <div class="dealer-figure" data-live2d>
              <img class="dealer-portrait" src="${dealerArt}" alt="" />
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
        <div class="deal-layer" data-deal-fx></div>
      </div>`;
    tableBuilt = true;
    bindTableActions();
    const liveHost = root.querySelector("[data-live2d]") as HTMLElement | null;
    if (liveHost) {
      void mountLive2D(liveHost, dealer).then((ok) => {
        if (!ok && liveHost.isConnected) {
          liveHost.innerHTML = `<img class="dealer-portrait" src="${dealerArt}" alt="" />`;
        }
      });
    }
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
    const bounds =
      onlineMatch && !roomH?.amHost() && guestRaise
        ? guestRaise
        : raiseBounds(t.engine);
    const { min, max } = bounds;
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
    const bounds =
      onlineMatch && !roomH?.amHost() && guestRaise
        ? guestRaise
        : raiseBounds(t.engine);
    const { min, max } = bounds;
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
    const bounds =
      onlineMatch && !roomH?.amHost() && guestRaise
        ? guestRaise
        : raiseBounds(t.engine);
    const { min, max } = bounds;
    const raiseTo = Math.max(min, Math.min(max, Math.floor(Number(input?.value) || min)));
    hideRaiseSheet();
    void playHuman("raise", raiseTo);
  }

  async function playHuman(act: Action, raiseTo?: number) {
    if (!t?.engine || busy) return;
    // 嘉宾：只上报动作
    if (onlineMatch && roomH && !roomH.amHost()) {
      busy = true;
      const seat = roomH.getMySeat() ?? t.localSeat;
      await roomH.send({
        type: "action",
        seat,
        action: act,
        amount: raiseTo,
        from: getPlayerId(),
      });
      updateTable(false);
      return;
    }
    busy = true;
    const before = t.engine.players.map((p) => p.bet);
    const info = humanAct(t, act, raiseTo);
    updateTable(false, before);
    if (info) await narrate(info);
    await waitBoard();
    if (onlineMatch) await hostPushState();
    schedule();
  }

  async function narrate(info: ActInfo) {
    setLive2DTalking(true);
    pokeDealer("talk");
    try {
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
    } finally {
      setLive2DTalking(false);
    }
  }

  function finishOrNextHand() {
    if (!t) return;
    // 联机非房主不能推进
    if (onlineMatch && roomH && !roomH.amHost()) return;
    afterHand(t, { endIfLocalBusted: !onlineMatch });
    if (t.over || (!onlineMatch && isHumanBusted(t))) {
      settlePrize();
      if (onlineMatch && roomH?.amHost()) {
        void roomH.send({
          type: "match_over",
          ranking: t.ranking,
          places: Object.fromEntries(t.seats.map((s) => [s.id, s.place ?? 8])),
        });
      }
      go("result");
      return;
    }
    startHand(t);
    prevBets = Array(8).fill(0);
    prevBoardLen = 0;
    prevPot = 0;
    raiseOpen = false;
    updateTable(true);
    if (onlineMatch) void hostPushState();
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

  function pauseForDeal() {
    return dealingHoles || dealingBoard;
  }

  function waitBoard(): Promise<void> {
    if (!dealingBoard) return Promise.resolve();
    return new Promise((resolve) => boardWaiters.push(resolve));
  }

  function queueDealAnimations() {
    if (!t?.engine) return;
    if (t.hand !== animHand) {
      animHand = t.hand;
      const fresh = t.engine.street === "preflop" && t.engine.board.length === 0;
      if (fresh) {
        holesShown = Array(8).fill(0);
        boardShown = 0;
        holeJob += 1;
        dealingHoles = true;
        const job = holeJob;
        void runHoleDeal(job);
      } else {
        holesShown = Array(8).fill(2);
        boardShown = t.engine.board.length;
      }
      return;
    }
    if (!dealingHoles && !dealingBoard && t.engine.board.length > boardShown) {
      boardJob += 1;
      dealingBoard = true;
      const job = boardJob;
      void runBoardDeal(job);
    }
  }

  async function throwCardTo(target: Element | null) {
    const live = root.querySelector("[data-live2d]") as HTMLElement | null;
    const portrait = root.querySelector(".dealer-portrait") as HTMLElement | null;
    const from = live ?? portrait;
    const layer = root.querySelector("[data-deal-fx]") as HTMLElement | null;
    if (!from || !layer || !target) return;
    if (live) lookLive2DAt(target as HTMLElement);
    else if (portrait) aimDealer(portrait, target as HTMLElement);
    await flyDealCard(layer, from, target as HTMLElement, `skin-${save.equip.card}`);
  }

  function releaseDealerAim() {
    resetDealerAim(root.querySelector(".dealer-portrait"));
    resetLive2DLook();
  }

  async function runHoleDeal(job: number) {
    try {
      if (!t?.engine) return;
      const living: number[] = [];
      for (let k = 1; k <= 8; k++) {
        const id = (t.button + k) % 8;
        const p = t.engine.players[id];
        if (p && !p.out) living.push(id);
      }
      const order = [...living, ...living];
      for (const seat of order) {
        if (job !== holeJob || !t?.engine) return;
        const target =
          root.querySelector(`[data-seat="${seat}"] .seat-cards`) ??
          root.querySelector(`[data-seat="${seat}"]`);
        await throwCardTo(target);
        holesShown[seat] = Math.min(2, (holesShown[seat] ?? 0) + 1);
        updateTable(false);
      }
    } finally {
      if (job === holeJob) {
        dealingHoles = false;
        holesShown = Array(8).fill(2);
        releaseDealerAim();
        if (screen === "table") {
          updateTable(false);
          schedule();
        }
      }
    }
  }

  async function runBoardDeal(job: number) {
    try {
      while (t?.engine && boardShown < t.engine.board.length) {
        if (job !== boardJob) return;
        const index = boardShown;
        updateTable(false);
        const slot = root.querySelector(`[data-board-slot="${index}"]`);
        await throwCardTo(slot);
        if (job !== boardJob) return;
        boardShown += 1;
        updateTable(false);
      }
    } finally {
      if (job === boardJob) {
        dealingBoard = false;
        releaseDealerAim();
        if (t?.engine) boardShown = Math.max(boardShown, t.engine.board.length);
        if (screen === "table") updateTable(false);
        const waiters = boardWaiters;
        boardWaiters = [];
        waiters.forEach((fn) => fn());
      }
    }
  }

  function updateTable(resetCards = false, betsBefore?: number[]) {
    if (!t) return;
    ensureTableShell();
    queueDealAnimations();
    const e = t.engine;
    const [sb, bb] = blindsForHand(Math.max(1, t.hand));
    const local = t.localSeat;

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
      boardWrap.innerHTML = [0, 1, 2, 3, 4]
        .map((i) => {
          const card = i < boardShown ? (board[i] ?? null) : null;
          return `<div class="board-slot" data-board-slot="${i}">${cardEl(card)}</div>`;
        })
        .join("");
      prevBoardLen = boardShown;
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
      const isYou = i === local;

      node.className = [
        "seat",
        isYou ? "you" : "",
        folded ? "folded" : "",
        out ? "out" : "",
        turn ? "turn" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const av = node.querySelector(".seat-avatar");
      if (av) av.textContent = isYou ? "你" : String(i);
      const name = node.querySelector(".seat-name");
      if (name) name.textContent = s.name;
      const atShowdown = !!(e && (e.street === "done" || e.street === "showdown"));
      const ch = node.querySelector(".seat-chips");
      if (ch) ch.textContent = String(chips);
      const st = node.querySelector(".seat-status");
      if (st) st.textContent = out ? `第${s.place ?? "?"}名` : "";

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
      const nShow = holesShown[i] ?? 0;
      if (cards && ep && !out && nShow > 0) {
        const hidden = !!ep.hidden;
        const showFace = !hidden && (isYou || (atShowdown && !ep.folded));
        if (ep.folded && atShowdown) {
          cards.innerHTML = "";
        } else if (hidden || (!isYou && !atShowdown && !ep.folded)) {
          cards.innerHTML = Array.from({ length: nShow }, () => cardEl("back")).join("");
        } else if (showFace && ep.hole.length) {
          cards.innerHTML = ep.hole.slice(0, nShow).map((c) => cardEl(c)).join("");
        } else if (!ep.folded) {
          cards.innerHTML = Array.from({ length: nShow }, () => cardEl("back")).join("");
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
      if (dealingHoles || dealingBoard) {
        actions.innerHTML = `<button class="btn secondary" type="button" disabled>发牌中…</button>`;
      } else {
      const myTurn = isHumanTurn(t);
      const acts =
        myTurn
          ? onlineMatch && !roomH?.amHost() && guestLegal
            ? guestLegal
            : legalActions(e!)
          : [];
      const toCall =
        e && e.players[local]
          ? Math.max(0, e.currentBet - e.players[local].bet)
          : 0;
      if (t.over) {
        actions.innerHTML = `<button class="btn" type="button" data-result>查看结算</button>`;
      } else if (e?.street === "done") {
        if (onlineMatch && roomH && !roomH.amHost()) {
          actions.innerHTML = `<button class="btn secondary" type="button" disabled>等待房主继续…</button>`;
        } else if (isHumanBusted(t) && !onlineMatch) {
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
    }

    if (!onlineMatch && e?.street === "done" && isHumanBusted(t) && !t.over && !autoSettleScheduled) {
      autoSettleScheduled = true;
      const lineEl = root.querySelector("[data-dealer-line]");
      if (lineEl) lineEl.textContent = "你已淘汰，正在结算…";
      pokeDealer("talk");
      window.setTimeout(() => {
        if (!t || t.over) return;
        finishOrNextHand();
      }, 1000);
    }

    // 联机房主：一手结束自动下一把 / 结算
    if (
      onlineMatch &&
      roomH?.amHost() &&
      e?.street === "done" &&
      !t.over &&
      !hostAdvancing
    ) {
      hostAdvancing = true;
      window.setTimeout(() => {
        hostAdvancing = false;
        if (!t || t.over) return;
        finishOrNextHand();
      }, 1400);
    }
  }

  function renderTable() {
    updateTable(true);
  }

  function settlePrize() {
    if (!t || prizePaid) return;
    prizePaid = true;
    const me = t.seats[t.localSeat];
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
        const you = id === t!.localSeat ? "（你）" : "";
        return `<tr class="${id === t!.localSeat ? "you-row" : ""}">
          <td>${s.place}</td><td>${s.name}${you}</td><td>${s.chips}</td><td>+${prize}</td>
        </tr>`;
      })
      .join("");
    const myPlace = t.seats[t.localSeat].place ?? 8;
    root.innerHTML = `
      <div class="result">
        <h1>本局结束</h1>
        <p>你获得第 <strong>${myPlace}</strong> 名 · 奖金 <strong>${PRIZE[myPlace]}</strong></p>
        <p class="coins">当前金币 <strong>${save.coins}</strong></p>
        <table class="rank-table">
          <thead><tr><th>名次</th><th>玩家</th><th>筹码</th><th>奖金</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="btn" type="button" data-home>返回大厅</button>
      </div>`;
    root.querySelector("[data-home]")?.addEventListener("click", () => {
      void (async () => {
        t = null;
        if (onlineMatch) {
          await leaveRoom();
          await lobbyH?.setTable(null);
          onlineMatch = false;
          go(lobbyH ? "onlineLobby" : "lobby");
        } else {
          go("lobby");
        }
      })();
    });
  }

  function waitRemoteAction(): Promise<Extract<GameMsg, { type: "action" }>> {
    return new Promise((resolve) => {
      remoteResolver = resolve;
    });
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!t || !t.engine || t.over || raiseOpen || pauseForDeal()) return;
    // 嘉宾不驱动 AI
    if (onlineMatch && roomH && !roomH.amHost()) {
      busy = false;
      updateTable(false);
      return;
    }
    if (t.engine.street === "done") {
      updateTable(false);
      if (pauseForDeal()) return;
      busy = false;
      return;
    }
    if (isHumanTurn(t)) {
      busy = false;
      updateTable(false);
      if (pauseForDeal()) return;
      if (onlineMatch) void hostPushState();
      return;
    }
    if (onlineMatch && isRemoteHumanTurn(t)) {
      busy = true;
      updateTable(false);
      if (pauseForDeal()) return;
      void hostPushState();
      void (async () => {
        const needSeat = t!.engine!.toAct;
        const msg = await waitRemoteAction();
        if (!t?.engine || msg.seat !== needSeat) {
          schedule();
          return;
        }
        const before = t.engine.players.map((p) => p.bet);
        const info = humanAct(t, msg.action, msg.amount);
        updateTable(false, before);
        if (info) await narrate(info);
        await waitBoard();
        await hostPushState();
        schedule();
      })();
      return;
    }
    busy = true;
    updateTable(false);
    if (pauseForDeal()) return;
    const delay = BOT_DELAY_MIN + Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN);
    timer = window.setTimeout(() => {
      void (async () => {
        if (!t?.engine || raiseOpen) return;
        const before = t.engine.players.map((p) => p.bet);
        const info = botAct(t);
        updateTable(false, before);
        await new Promise((r) => setTimeout(r, CHIP_FLY_MS * 0.45));
        if (info) await narrate(info);
        await waitBoard();
        if (onlineMatch) await hostPushState();
        schedule();
      })();
    }, delay);
  }

  paint();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s);
}
