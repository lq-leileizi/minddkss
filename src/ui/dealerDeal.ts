import { lowerLive2DHand, raiseLive2DHand } from "./live2dDealer";

/** 身体不动，抬起模型自己的手，牌从手边飞向座位。 */
export function dealFromHand(
  layer: HTMLElement,
  dealer: HTMLElement,
  to: HTMLElement,
  skinClass: string,
): Promise<void> {
  const lr = layer.getBoundingClientRect();
  const fr = dealer.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const targetX = tr.left + tr.width / 2 - lr.left;
  const midX = fr.left + fr.width / 2 - lr.left;
  const side = targetX >= midX ? 1 : -1;
  raiseLive2DHand(side);
  const origin = {
    x: fr.left + fr.width * (side > 0 ? 0.84 : 0.16) - lr.left,
    y: fr.top + fr.height * 0.46 - lr.top,
  };
  return wait(200)
    .then(() => flyDealCard(layer, dealer, to, skinClass, origin))
    .then(() => {
      lowerLive2DHand();
    });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function flyDealCard(
  layer: HTMLElement,
  from: HTMLElement,
  to: HTMLElement,
  skinClass: string,
  origin?: { x: number; y: number },
): Promise<void> {
  const lr = layer.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const x0 = origin?.x ?? fr.left + fr.width * 0.55 - lr.left;
  const y0 = origin?.y ?? fr.top + fr.height * 0.78 - lr.top;
  const x1 = tr.left + tr.width / 2 - lr.left;
  const y1 = tr.top + tr.height / 2 - lr.top;
  const card = document.createElement("div");
  card.className = `fly-card card back ${skinClass}`;
  card.style.left = `${x0}px`;
  card.style.top = `${y0}px`;
  layer.appendChild(card);
  const anim = card.animate(
    [
      {
        left: `${x0}px`,
        top: `${y0}px`,
        transform: "translate(-50%, -50%) rotate(-16deg) scale(0.82)",
      },
      {
        left: `${x1}px`,
        top: `${y1}px`,
        transform: "translate(-50%, -50%) rotate(8deg) scale(1)",
      },
    ],
    { duration: 300, easing: "cubic-bezier(.22,.7,.2,1)", fill: "forwards" },
  );
  return anim.finished.then(
    () => card.remove(),
    () => card.remove(),
  );
}

