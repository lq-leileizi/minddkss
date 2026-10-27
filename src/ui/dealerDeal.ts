/** 立绘朝目标转，并从荷官手边把牌背飞到目标 */
export function aimDealer(portrait: HTMLElement, target: HTMLElement) {
  const pr = portrait.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  const dx = tr.left + tr.width / 2 - (pr.left + pr.width / 2);
  const dy = tr.top + tr.height / 2 - (pr.top + pr.height / 2);
  const yaw = Math.max(-46, Math.min(46, dx / 5.5));
  const nod = Math.max(-6, Math.min(14, dy / 28));
  const slide = Math.max(-22, Math.min(22, dx / 9));
  portrait.classList.add("is-aim");
  portrait.style.transform = `perspective(520px) translateX(${slide.toFixed(1)}px) rotateY(${(-yaw).toFixed(1)}deg) rotate(${(yaw * 0.22).toFixed(1)}deg) translateY(${nod.toFixed(1)}px)`;
}

export function resetDealerAim(portrait: HTMLElement | null) {
  if (!portrait) return;
  portrait.style.transform = "";
  portrait.classList.remove("is-aim");
}

export function flyDealCard(
  layer: HTMLElement,
  from: HTMLElement,
  to: HTMLElement,
  skinClass: string,
): Promise<void> {
  const lr = layer.getBoundingClientRect();
  const fr = from.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const x0 = fr.left + fr.width * 0.55 - lr.left;
  const y0 = fr.top + fr.height * 0.78 - lr.top;
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
    { duration: 380, easing: "cubic-bezier(.22,.7,.2,1)", fill: "forwards" },
  );
  return anim.finished.then(
    () => card.remove(),
    () => card.remove(),
  );
}
