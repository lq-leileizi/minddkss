import type { RealtimeChannel } from "@supabase/supabase-js";
import { TABLE_COUNT } from "../config";
import { getNickname, getPlayerId } from "./config";
import { getSupabase } from "./supabase";
import type { LobbyPresence } from "./types";

export type LobbyHandle = {
  getCounts: () => number[];
  setTable: (table: number | null) => Promise<void>;
  stop: () => void;
};

/** 订阅大厅人数：presence.table = 桌号 */
export function joinLobby(onChange: (counts: number[]) => void): LobbyHandle {
  const sb = getSupabase();
  const playerId = getPlayerId();
  let channel: RealtimeChannel = sb.channel("lobby", {
    config: { presence: { key: playerId } },
  });
  let currentTable: number | null = null;

  const compute = (): number[] => {
    const counts = Array.from({ length: TABLE_COUNT }, () => 0);
    const state = channel.presenceState<LobbyPresence>();
    for (const metas of Object.values(state)) {
      for (const m of metas) {
        if (m.table != null && m.table >= 1 && m.table <= TABLE_COUNT) {
          counts[m.table - 1] = Math.min(8, counts[m.table - 1] + 1);
        }
      }
    }
    return counts;
  };

  const emit = () => onChange(compute());

  channel = channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit);

  void channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({
        playerId,
        name: getNickname(),
        table: currentTable,
      } satisfies LobbyPresence);
      emit();
    }
  });

  return {
    getCounts: compute,
    async setTable(table) {
      currentTable = table;
      await channel.track({
        playerId,
        name: getNickname(),
        table: currentTable,
      } satisfies LobbyPresence);
      emit();
    },
    stop() {
      void sb.removeChannel(channel);
    },
  };
}
