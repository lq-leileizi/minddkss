import {
  PERSONA_MAX_SAME,
  PERSONA_WEIGHT,
  type Persona,
} from "../config";

const POOL = Object.keys(PERSONA_WEIGHT) as Persona[];

function pick(excludeCount: Map<Persona, number>): Persona {
  const weights = POOL.map((p) => {
    const used = excludeCount.get(p) ?? 0;
    if (used >= PERSONA_MAX_SAME) return 0;
    return PERSONA_WEIGHT[p];
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < POOL.length; i++) {
    r -= weights[i];
    if (r <= 0) return POOL[i];
  }
  return "standard";
}

/** 为桌上 AI 每人抽一个人设（同人设最多 PERSONA_MAX_SAME） */
export function rollPersonas(aiCount: number): Persona[] {
  const count = new Map<Persona, number>();
  const out: Persona[] = [];
  for (let i = 0; i < aiCount; i++) {
    const p = pick(count);
    count.set(p, (count.get(p) ?? 0) + 1);
    out.push(p);
  }
  return out;
}
