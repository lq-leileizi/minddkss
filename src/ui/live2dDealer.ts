import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";

type MouthModel = {
  addParameterValueById(id: string, value: number, weight?: number): void;
  setParameterValueById(id: string, value: number, weight?: number): void;
};

type TalkModel = {
  on(event: "beforeModelUpdate", fn: () => void): void;
  pixelsPerUnit: number;
  coreModel: MouthModel & {
    getModel(): {
      canvasinfo: { CanvasWidth: number; CanvasHeight: number; PixelsPerUnit: number };
      drawables: { vertexPositions: ArrayLike<ArrayLike<number>> };
    };
  };
};

let app: PIXI.Application | null = null;
let model: Live2DModel | null = null;
let hostEl: HTMLElement | null = null;
let token = 0;
let talking = false;
/** 发牌时压过待机动作，让头和身体转到目标方向。 */
let aimPose: { x: number; y: number; z: number; bodyX: number; bodyY: number; eyeX: number; eyeY: number; nx: number } | null = null;
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
    const model = orig.call(core.Model, moc);
    if (model?.renderOrders && model.drawables && !model.drawables.renderOrders) {
      const count = model.drawables.count;
      const orders = model.renderOrders;
      const copy = new Int32Array(count);
      for (let i = 0; i < count; i++) copy[i] = orders[i];
      model.drawables.renderOrders = copy;
    }
    return model;
  };
  core.__leiShim = true;
}

const MODELS: Record<string, string> = {
  dealer_default: "./live2d/Lei/character.model3.json",
};

/** 挂上小蕾的 Cubism 模型。其他皮肤或加载失败时返回 false，调用方保留静态图。 */
export async function mountLive2D(host: HTMLElement, dealerId = "dealer_default"): Promise<boolean> {
  const url = MODELS[dealerId];
  if (!url) return false;
  shimCubismCore();
  const my = ++token;
  destroyView();
  hostEl = host;
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
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
  app = pixi;
  try {
    const loaded = await Live2DModel.from(url, { autoInteract: false });
    if (my !== token) {
      loaded.destroy();
      pixi.destroy(true);
      return false;
    }
    model = loaded;
    const internal = loaded.internalModel as unknown as TalkModel;
    fitModelScale(internal);
    const modelHeight = loaded.height || internal.coreModel.getModel().canvasinfo.CanvasHeight || height;
    restScale = height / modelHeight;
    restX = width / 2;
    loaded.scale.set(restScale);
    loaded.anchor.set(0.5, 1);
    loaded.x = restX;
    loaded.y = height;
    pixi.stage.addChild(loaded);
    placeModel();
    internal.on("beforeModelUpdate", () => {
      const core = internal.coreModel;
      if (aimPose) {
        core.setParameterValueById("ParamAngleX", aimPose.x);
        core.setParameterValueById("ParamAngleY", aimPose.y);
        core.setParameterValueById("ParamAngleZ", aimPose.z);
        core.setParameterValueById("ParamBodyAngleX", aimPose.bodyX);
        core.setParameterValueById("ParamBodyAngleY", aimPose.bodyY);
        core.setParameterValueById("ParamBodyAngleZ", aimPose.z * 0.65);
        core.setParameterValueById("ParamEyeBallX", aimPose.eyeX);
        core.setParameterValueById("ParamEyeBallY", aimPose.eyeY);
      }
      if (!talking) return;
      const open = (Math.sin(performance.now() / 85) + 1) / 2;
      core.addParameterValueById("ParamMouthOpenY", open, 1);
    });
    void loaded.motion("Idle", 0);
    return true;
  } catch (err) {
    console.warn("Live2D load failed", err);
    if (my === token) destroyView();
    return false;
  }
}

/** PSD 导出的像素单位有时和顶点坐标重复放大，人物会画到画布外面。 */
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
  const nx = clamp(dx / 90, -1, 1);
  const ny = clamp(dy / 240, -0.35, 1);
  aimPose = {
    x: nx * 22,
    y: ny * 14,
    z: nx * -10,
    bodyX: nx * 16,
    bodyY: ny * 8,
    eyeX: nx,
    eyeY: clamp(ny, -1, 1),
    nx,
  };
  placeModel();
}

export function resetLive2DLook() {
  aimPose = null;
  placeModel();
  if (!model) return;
  const canvas = app?.view as HTMLCanvasElement | undefined;
  if (!canvas) return;
  const b = canvas.getBoundingClientRect();
  model.focus(b.left + b.width / 2, b.bottom + 40);
}

/** 整个人绕胸口转，并往出牌的一侧探过去。 */
function placeModel() {
  if (!model) return;
  const nx = aimPose?.nx ?? 0;
  model.scale.set(restScale);
  model.angle = nx * -18;
  model.x = restX + nx * 10;
  model.y = hostEl?.clientHeight || app?.renderer.height || 0;
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
  hostEl = null;
  model?.destroy();
  model = null;
  if (app) {
    app.destroy(true);
    app = null;
  }
}
