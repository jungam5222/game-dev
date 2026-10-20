// 그림 모음: 픽셀 그림(art/*)을 한 곳에서 내보내고, 글자·체력 막대·떠오르는 숫자를 그린다.
// 픽셀 그림은 작은 그림판(픽셀 단위), 글자는 그 위 큰 그림판(그림판 540 기준 좌표)에 쓴다.
import { G } from "./game.js";
import { PAL, rect, canvasOf } from "./pixel.js";
export { drawHero, drawMonster, drawSpirit, HERO_TOP, MONSTER_TOP, SPIRIT_TOP } from "./art/units.js";
export { drawRoom, drawRoomFront, ROOM_W, ROOM_H } from "./art/dungeon.js";
export { Effects } from "./art/fx.js";

export const FONT = "Galmuri11";

// 글자. 갈무리11은 11px가 한 칸이라 11의 배수 크기가 가장 또렷하다.
// o: size, color, bold, align, base, outline(테두리 색, null이면 없음), alpha
export function text(ctx, str, x, y, o = {}) {
  const size = o.size || 11;
  const k = Math.max(1, Math.round(size / 11));
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
  ctx.font = `${o.bold ? 700 : 400} ${size}px ${FONT}, sans-serif`;
  ctx.textAlign = o.align || "center";
  ctx.textBaseline = o.base || "middle";
  x = Math.round(x);
  y = Math.round(y);
  const ol = o.outline === undefined ? PAL.K : o.outline;
  if (ol) {
    ctx.fillStyle = ol;
    for (let dx = -k; dx <= k; dx += k) for (let dy = -k; dy <= k; dy += k) if (dx || dy) ctx.fillText(str, x + dx, y + dy);
    ctx.fillText(str, x + k, y + k * 2);
  }
  ctx.fillStyle = o.color || PAL.W;
  ctx.fillText(str, x, y);
  ctx.restore();
}

// 픽셀 모양 판 (모서리를 한 칸씩 깎은 네모). 가운데 기준
export function box(ctx, cx, cy, w, h, bg = "rgba(24,20,37,0.72)", edge = null) {
  const l = Math.round(cx - w / 2);
  const t = Math.round(cy - h / 2);
  ctx.fillStyle = bg;
  ctx.fillRect(l + 2, t, w - 4, h);
  ctx.fillRect(l, t + 2, w, h - 4);
  ctx.fillRect(l + 1, t + 1, w - 2, h - 2);
  if (edge) {
    ctx.fillStyle = edge;
    ctx.fillRect(l + 2, t + h - 1, w - 4, 1);
  }
}

// 이름표: 어두운 판 위 글자
export function plate(ctx, str, x, y, o = {}) {
  const size = o.size || 11;
  ctx.save();
  ctx.font = `${o.bold ? 700 : 400} ${size}px ${FONT}, sans-serif`;
  const w = Math.ceil(ctx.measureText(str).width) + 10;
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  box(ctx, x, y, w, size + 7, o.bg, o.edge);
  ctx.restore();
  text(ctx, str, x, y + 0.5, { ...o, outline: null, alpha: o.alpha });
}

// 체력 막대 (픽셀 그림판). kind: e 적, p 우리 편, s 정령
const BAR = { e: [PAL.r, PAL.m, PAL.P], p: [PAL.L, PAL.G, PAL.y], s: [PAL.C, PAL.B, PAL.W] };
export function hpBar(ctx, cx, y, w, hp, max, kind = "e") {
  const x = Math.round(cx - w / 2);
  y = Math.round(y);
  rect(ctx, x - 1, y - 1, w + 2, 6, PAL.K);
  rect(ctx, x, y, w, 4, PAL.n);
  const f = Math.max(0, Math.round((w * Math.max(0, hp)) / max));
  const [c, dk, hi] = BAR[kind] || BAR.e;
  if (f > 0) {
    rect(ctx, x, y, f, 4, c);
    rect(ctx, x, y + 3, f, 1, dk);
    rect(ctx, x, y, f, 1, hi);
  }
}

// 떠오르는 글자 (피해 숫자, "회피!" 등). 좌표는 큰 그림판.
export class Floats {
  constructor() {
    this.list = [];
  }
  add(x, y, str, color = PAL.W, size = 22, dur = 1.1, icon = null) {
    // 같은 자리에 겹치면 조금 위로 올린다
    let yy = y;
    for (const f of this.list) if (Math.abs(f.x - x) < 40 && Math.abs(f.y - yy) < size && f.age < 0.3) yy -= size + 2;
    this.list.push({ x, y: yy, str, color, size, dur, age: 0, icon });
  }
  update(dt) {
    for (const f of this.list) f.age += dt;
    this.list = this.list.filter((f) => f.age < f.dur);
  }
  draw(ctx) {
    for (const f of this.list) {
      const p = f.age / f.dur;
      const rise = Math.round(Math.min(1, p * 2.2) * 26);
      // 처음에 살짝 튀어 오르기
      const pop = p < 0.08 ? -4 : 0;
      const alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      let x = f.x;
      if (f.icon) {
        // 글자 왼쪽에 아이콘 (2배)
        ctx.font = `700 ${f.size}px ${FONT}, sans-serif`;
        const w = ctx.measureText(f.str).width;
        const iw = f.icon.w * 2;
        x = f.x + (iw + 4) / 2;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvasOf(f.icon), Math.round(x - w / 2 - iw - 4), Math.round(f.y - rise + pop - f.icon.h), iw, f.icon.h * 2);
        ctx.restore();
      }
      text(ctx, f.str, x, f.y - rise + pop, { size: f.size, color: f.color, bold: true, alpha });
    }
  }
}

// 화면 가운데 큰 글자 ("전투 시작!")
export function banner(ctx, str, color, p) {
  const a = p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) / 0.25 : 1;
  const y = Math.round(G.H * 0.36);
  ctx.save();
  ctx.globalAlpha = a * 0.6;
  ctx.fillStyle = PAL.K;
  ctx.fillRect(0, y - 30, G.W, 60);
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillRect(0, y - 30, G.W, 3);
  ctx.fillRect(0, y + 27, G.W, 3);
  ctx.restore();
  text(ctx, str, G.W / 2, y, { size: 33, bold: true, color, alpha: a });
}
