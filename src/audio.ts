import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import type { Action } from "./game/engine";

let unlocked = false;
let ctx: AudioContext | null = null;
const useNativeTts = Capacitor.isNativePlatform();

function getCtx(): AudioContext | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** 进桌点击时解锁音频（安卓 WebView / 原生 TTS 需要） */
export function unlockAudio() {
  unlocked = true;
  const c = getCtx();
  void c?.resume();
  if (useNativeTts) {
    // 预热原生 TTS 引擎，避免第一句被吞
    void TextToSpeech.speak({
      text: "。",
      lang: "zh-CN",
      rate: 1.1,
      pitch: 1.1,
      volume: 0.01,
      category: "playback",
      queueStrategy: 1,
    }).catch(() => undefined);
    return;
  }
  try {
    window.speechSynthesis?.cancel();
    const warm = new SpeechSynthesisUtterance("。");
    warm.volume = 0.01;
    warm.lang = "zh-CN";
    window.speechSynthesis?.speak(warm);
  } catch {
    /* ignore */
  }
}

function beep(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  const c = getCtx();
  if (!c || !unlocked) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 动作短音效 */
export function playActionSfx(action: Action) {
  if (action === "fold") {
    beep(180, 0.12, "triangle", 0.06);
  } else if (action === "check") {
    beep(520, 0.08, "sine", 0.05);
  } else if (action === "call") {
    beep(400, 0.07, "square", 0.04);
    setTimeout(() => beep(320, 0.1, "square", 0.04), 70);
  } else if (action === "raise") {
    beep(360, 0.08, "square", 0.05);
    setTimeout(() => beep(480, 0.1, "square", 0.05), 80);
    setTimeout(() => beep(600, 0.12, "square", 0.045), 160);
  } else if (action === "allin") {
    beep(280, 0.15, "sawtooth", 0.05);
    setTimeout(() => beep(420, 0.18, "sawtooth", 0.055), 100);
    setTimeout(() => beep(560, 0.22, "sawtooth", 0.05), 200);
  }
}

export function playChipSfx() {
  beep(700, 0.05, "triangle", 0.035);
  setTimeout(() => beep(540, 0.06, "triangle", 0.03), 40);
}

export function playDealSfx() {
  beep(880, 0.04, "sine", 0.03);
  setTimeout(() => beep(990, 0.04, "sine", 0.025), 50);
}

async function speakNative(line: string): Promise<void> {
  await TextToSpeech.stop().catch(() => undefined);
  await TextToSpeech.speak({
    text: line,
    lang: "zh-CN",
    rate: 1.05,
    pitch: 1.12,
    volume: 1,
    category: "playback",
    queueStrategy: 1,
  });
}

function speakWeb(line: string): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(done, Math.min(7000, 700 + line.length * 220));

    try {
      if (!window.speechSynthesis) {
        done();
        return;
      }
      const speak = () => {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(line);
        u.lang = "zh-CN";
        u.rate = 1.08;
        u.pitch = 1.15;
        u.volume = 1;
        const voices = window.speechSynthesis.getVoices();
        const zh =
          voices.find(
            (v) =>
              /zh-CN|zh_CN|Chinese|中文/.test(v.lang) &&
              /female|女|Xiaoyi|Xiaoxiao|Tingting|Huihui/i.test(v.name),
          ) || voices.find((v) => /zh-CN|zh_CN|Chinese|中文/.test(v.lang));
        if (zh) u.voice = zh;
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      };
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.onvoiceschanged = null;
          speak();
        };
        window.setTimeout(speak, 400);
      } else {
        speak();
      }
    } catch {
      done();
    }
  });
}

/** 荷官语音：说完才 resolve，下个行动要等这里结束 */
export async function dealerSay(text: string): Promise<void> {
  const line = text.trim();
  if (!line || !unlocked) return;

  if (useNativeTts) {
    try {
      await speakNative(line);
    } catch {
      await speakWeb(line);
    }
    return;
  }

  await speakWeb(line);
}

const ACTION_LINE: Record<Action, (name: string, amount?: number) => string> = {
  fold: (n) => `${n}，弃牌`,
  check: (n) => `${n}，过牌`,
  call: (n) => `${n}，跟注`,
  raise: (n, a) => (a != null ? `${n}，加注到${a}` : `${n}，加注`),
  allin: (n) => `${n}，全下`,
};

export async function announceAction(name: string, action: Action, amount?: number): Promise<void> {
  playActionSfx(action);
  await dealerSay(ACTION_LINE[action](name, amount));
}

export async function announceStreet(street: string): Promise<void> {
  const map: Record<string, string> = {
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
  };
  const t = map[street];
  if (!t) return;
  playDealSfx();
  await dealerSay(t);
}

export async function announceResult(message: string): Promise<void> {
  playChipSfx();
  await dealerSay(message.replace(/（.*?）/g, "") || "本手结束");
}
