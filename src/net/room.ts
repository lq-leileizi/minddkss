import type { RealtimeChannel } from "@supabase/supabase-js";
import { PLAYERS } from "../config";
import { getNickname, getPlayerId } from "./config";
import { getSupabase } from "./supabase";
import type { GameMsg, SeatPresence } from "./types";

function tableChannelName(tableNo: number) {
  return `table:${String(tableNo).padStart(2, "0")}`;
}

export type RoomMember = SeatPresence & { isHost: boolean };

export type RoomHandle = {
  tableNo: number;
  getMembers: () => RoomMember[];
  getMySeat: () => number | null;
  amHost: () => boolean;
  setReady: (ready: boolean) => Promise<void>;
  send: (msg: GameMsg) => Promise<void>;
  leave: () => Promise<void>;
};

export type RoomCallbacks = {
  onMembers: (members: RoomMember[]) => void;
  onMessage: (msg: GameMsg) => void;
};

export async function joinTable(tableNo: number, cbs: RoomCallbacks): Promise<RoomHandle> {
  const sb = getSupabase();
  const playerId = getPlayerId();
  const name = getNickname();
  const joinedAt = Date.now();

  let channel: RealtimeChannel = sb.channel(tableChannelName(tableNo), {
    config: { presence: { key: playerId } },
  });

  let mySeat: number | null = null;
  let ready = false;

  const listMembers = (): RoomMember[] => {
    const state = channel.presenceState<SeatPresence>();
    const raw: SeatPresence[] = [];
    for (const metas of Object.values(state)) {
      for (const m of metas) raw.push(m);
    }
    raw.sort((a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId));
    const hostId = raw[0]?.playerId;
    return raw.map((m) => ({ ...m, isHost: m.playerId === hostId }));
  };

  const emitMembers = () => cbs.onMembers(listMembers());

  const assignSeat = (occupied: Set<number>): number | null => {
    for (let i = 0; i < PLAYERS; i++) {
      if (!occupied.has(i)) return i;
    }
    return null;
  };

  channel = channel
    .on("presence", { event: "sync" }, emitMembers)
    .on("presence", { event: "join" }, emitMembers)
    .on("presence", { event: "leave" }, emitMembers)
    .on("broadcast", { event: "game" }, ({ payload }) => {
      cbs.onMessage(payload as GameMsg);
    });

  await new Promise<void>((resolve, reject) => {
    void channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          const occupied = new Set(listMembers().map((m) => m.seat));
          mySeat = assignSeat(occupied);
          if (mySeat == null) {
            reject(new Error("本桌已满"));
            return;
          }
          await channel.track({
            playerId,
            name,
            seat: mySeat,
            ready: false,
            joinedAt,
          } satisfies SeatPresence);
          emitMembers();
          resolve();
        } catch (e) {
          reject(e);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error("连接牌桌失败"));
      }
    });
  });

  return {
    tableNo,
    getMembers: listMembers,
    getMySeat: () => mySeat,
    amHost: () => listMembers().find((m) => m.playerId === playerId)?.isHost ?? false,
    async setReady(r) {
      ready = r;
      if (mySeat == null) return;
      await channel.track({
        playerId,
        name,
        seat: mySeat,
        ready,
        joinedAt,
      } satisfies SeatPresence);
      emitMembers();
    },
    async send(msg) {
      await channel.send({ type: "broadcast", event: "game", payload: msg });
    },
    async leave() {
      await channel.untrack();
      await sb.removeChannel(channel);
    },
  };
}

/** 桌上所有真人是否都已准备（至少 1 人） */
export function allHumansReady(members: RoomMember[]): boolean {
  return members.length >= 1 && members.every((m) => m.ready);
}
