import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";

type MouthModel = {
  addParameterValueById(id: string, value: number, weight?: number): void;
  setParameterValueById(id: string, value: number, weight?: number): void;
  setPartOpacityById(id: string, opacity: number): void;
};

type TalkModel = {
  on(event: "beforeModelUpdate" | "afterMotionUpdate", fn: () => void): void;
  pixelsPerUnit: number;
  coreModel: MouthModel & {
    getModel(): {
      canvasinfo: { CanvasWidth: number; CanvasHeight: number; PixelsPerUnit: number };
      drawables: { vertexPositions: ArrayLike<ArrayLike<number>> };
    };
  };
};

type Pose = Record<string, number>;

function pose(values: Pose): Pose {
  return values;
}

type Rig = {
  url: string;
  mouth: string;
  eyeX: string;
  eyeY: string;
  /** 全身模型放大，让头和手填满荷官位置，腿画到画布下面。 */
  zoom?: number;
  /** 朝某一侧抬自己的手臂。1 是画面右侧。 */
  reach: (side: 1 | -1) => { params: Pose; parts: Pose };
};

const RIGS: Record<string, Rig> = {
  dealer_default: {
    url: "./live2d/Hiyori/hiyori_pro_t11.model3.json",
    mouth: "ParamMouthOpenY",
    eyeX: "ParamEyeBallX",
    eyeY: "ParamEyeBallY",
    zoom: 2.15,
    reach: (side) => ({
      params: pose({
        PartArmA: 0,
        PartArmB: 1,
        ...(side > 0 ? { ParamArmLB: 1.3, ParamHandLB: 8 } : { ParamArmRB: 1.3, ParamHandRB: 8 }),
      }),
      parts: {},
    }),
  },
  dealer_cool: {
    url: "./live2d/Haru/haru.model3.json",
    mouth: "PARAM_MOUTH_OPEN_Y",
    zoom: 1.45,
    eyeX: "PARAM_EYE_BALL_X",
    eyeY: "PARAM_EYE_BALL_Y",
    reach: (side) => ({
      params:
        side > 0
          ? pose({ PARAM_ARM_L_B: 4, PARTS_01_ARM_L_A_001: 0, PARTS_01_ARM_L_B_001: 1 })
          : pose({ PARAM_ARM_R_B: 4, PARTS_01_ARM_R_A_001: 0, PARTS_01_ARM_R_B_001: 1 }),
      parts: {},
    }),
  },
  dealer_queen: {
    url: "./live2d/Epsilon/Epsilon.model3.json",
    mouth: "PARAM_MOUTH_OPEN_Y",
    eyeX: "PARAM_EYE_BALL_X",
    eyeY: "PARAM_EYE_BALL_Y",
    reach: (side) => ({
      params: side > 0 ? pose({ PARAM_ARM_L: 20 }) : pose({ PARAM_ARM_R: 20 }),
      parts: {},
    }),
  },
};

let app: PIXI.Application | null = null;
let model: Live2DModel | null = null;
let hostEl: HTMLElement | null = null;
let rig: Rig | null = null;
let token = 0;
let talking = false;
/** 发牌时只看向座位，身体不跟着转。 */
let aimPose: { eyeX: number; eyeY: number } | null = null;
/** 发牌时压过动作，抬起模型自己的手。 */
let handPose: { params: Pose; parts: Pose } | null = null;
let restX = 0;
let restScale = 1;

Live2DModel.registerTicker(PIXI.Ticker);

type CubismCore = {
  __leiShim?: boolean;
  Model: {
    fromMoc(moc: unknown): {
      renderOrders?: ArrayLike<number>;
      drawables: { count: number; renderOrders?: ArrayLike<number> };
    } | null;
  };
};

/** Cubism 5.3 把绘制顺序放到了模型上，旧渲染器仍从 drawable 上读。 */
function shimCubismCore() {
  const core = (window as unknown as { Live2DCubismCore?: CubismCore }).Live2DCubismCore;
  if (!core || core.__leiShim) return;
  const orig = core.Model.fromMoc;
  core.Model.fromMoc = function (moc: unknown) {
    const loaded = orig.call(core.Model, moc);
    if (loaded?.renderOrders && loaded.drawables && !loaded.drawables.renderOrders) {
      const count = loaded.drawables.count;
      const orders = loaded.renderOrders;
      const copy = new Int32Array(count);
      for (let i = 0; i < count; i++) copy[i] = orders[i];
      loaded.drawables.renderOrders = copy;
    }
    return loaded;
  };
  core.__leiShim = true;
}

/** 挂上带手臂的 Cubism 模型。未知皮肤或加载失败时返回 false，调用方保留静态图。 */
export async function mountLive2D(host: HTMLElement, dealerId = "dealer_default"): Promise<boolean> {
  const next = RIGS[dealerId];
  if (!next) return false;
  shimCubismCore();
  const my = ++token;
  destroyView();
  hostEl = host;
  rig = next;
  const canvas = document.createElement("canvas");
  canvas.className = "live2d-canvas";
  host.replaceChildren(canvas);
  const width = host.clientWidth || 112;
  const height = host.clientHeight || 148;
  const pixi = new PIXI.Application({
    view: canvas,
    width,
    height,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
  app = pixi;
  try {
    const loaded = await Live2DModel.from(next.url, { autoInteract: false });
    if (my !== token) {
      loaded.destroy();
      pixi.destroy(true);
      return false;
    }
    model = loaded;
    const internal = loaded.internalModel as unknown as TalkModel;
    fitModelScale(internal);
    const modelHeight = loaded.height || internal.coreModel.getModel().canvasinfo.CanvasHeight || height;
    restScale = (height / modelHeight) * (next.zoom ?? 1);
    restX = width / 2;
    loaded.scale.set(restScale);
    loaded.anchor.set(0.5, 1);
    loaded.x = restX;
    loaded.y = height;
    pixi.stage.addChild(loaded);
    placeModel();
    const poseRig = next;
    internal.on("afterMotionUpdate", () => {
      if (!handPose) return;
      const core = internal.coreModel;
      for (const [id, value] of Object.entries(handPose.params)) {
        core.setParameterValueById(id, value);
      }
      for (const [id, opacity] of Object.entries(handPose.parts)) {
        core.setPartOpacityById(id, opacity);
      }
    });
    internal.on("beforeModelUpdate", () => {
      const core = internal.coreModel;
      if (aimPose) {
        core.setParameterValueById(poseRig.eyeX, aimPose.eyeX);
        core.setParameterValueById(poseRig.eyeY, aimPose.eyeY);
      }
      if (!talking) return;
      const open = (Math.sin(performance.now() / 85) + 1) / 2;
      core.addParameterValueById(poseRig.mouth, open, 1);
    });
    void loaded.motion("Idle", 0);
    return true;
  } catch (err) {
    console.warn("Live2D load failed", err);
    if (my === token) destroyView();
    return false;
  }
}

/** 像素单位和顶点坐标对不上时，人物会画到画布外面。官方样本比例正常，这里不会改它们。 */
function fitModelScale(internal: TalkModel) {
  const info = internal.coreModel.getModel().canvasinfo;
  const drawables = internal.coreModel.getModel().drawables.vertexPositions as unknown as ArrayLike<ArrayLike<number>>;
  if (!drawables?.length || !info.CanvasWidth) return;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let d = 0; d < drawables.length; d++) {
    const verts = drawables[d];
    for (let i = 0; i < verts.length; i += 2) {
      const x = verts[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  const span = maxX - minX;
  if (!Number.isFinite(span) || span < 0.01) return;
  const projected = span * info.PixelsPerUnit;
  if (projected > info.CanvasWidth * 2.5 || projected < info.CanvasWidth * 0.2) {
    internal.pixelsPerUnit = info.CanvasWidth / span;
  }
}

export function lookLive2DAt(target: HTMLElement) {
  if (!hostEl) return;
  const origin = (hostEl.parentElement ?? hostEl).getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const dx = r.left + r.width / 2 - (origin.left + origin.width / 2);
  const dy = r.top + r.height / 2 - (origin.top + origin.height / 2);
  const nx = clamp(dx / 140, -1, 1);
  const ny = clamp(dy / 280, -0.4, 1);
  aimPose = { eyeX: nx * 0.85, eyeY: clamp(ny, -0.6, 0.8) };
}

/** 抬起角色自己的手。side 为 1 时朝画面右侧。 */
export function raiseLive2DHand(side: number) {
  if (!rig) return;
  handPose = rig.reach(side >= 0 ? 1 : -1);
}

export function lowerLive2DHand() {
  handPose = null;
}

export function resetLive2DLook() {
  aimPose = null;
  handPose = null;
  placeModel();
}

function placeModel() {
  if (!model) return;
  model.scale.set(restScale);
  model.angle = 0;
  model.x = restX;
  const height = hostEl?.clientHeight || app?.renderer.height || 0;
  const zoom = rig?.zoom ?? 1;
  model.y = height * (zoom > 1 ? zoom * 0.92 : 1);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function setLive2DTalking(on: boolean) {
  talking = on;
}

export function live2DReady() {
  return !!model;
}

export function destroyLive2D() {
  token += 1;
  talking = false;
  destroyView();
}

function destroyView() {
  aimPose = null;
  handPose = null;
  rig = null;
  hostEl = null;
  model?.destroy();
  model = null;
  if (app) {
    app.destroy(true);
    app = null;
  }
}
