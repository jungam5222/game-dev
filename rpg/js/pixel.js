// 픽셀 그림 도구. 모든 그림은 이 파일의 팔레트(ENDESGA 32, 32색)만 쓴다.
// 그림은 글자 한 칸 = 픽셀 한 칸인 문자열로 적고(spr), 처음 그릴 때 작은 캔버스로 한 번 만들어 둔다.
// 화면은 픽셀 1칸 = 그림판 3칸으로 키워서 보여 준다(game.js의 S).

// 글자 → 색. '.'와 ' '는 투명.
export const PAL = {
  R: "#be4a2f", // 벽돌 주황
  o: "#d77643", // 주황 갈색
  c: "#ead4aa", // 크림
  t: "#e4a672", // 황토
  k: "#b86f50", // 흙갈색
  b: "#733e39", // 갈색
  d: "#3e2731", // 짙은 갈색 (따뜻한 외곽선)
  m: "#a22633", // 검붉은
  r: "#e43b44", // 빨강
  O: "#f77622", // 주황
  g: "#feae34", // 금색
  y: "#fee761", // 노랑
  L: "#63c74d", // 연두
  G: "#3e8948", // 초록
  F: "#265c42", // 짙은 초록
  D: "#193c3e", // 가장 짙은 초록
  u: "#124e89", // 짙은 파랑
  B: "#0099db", // 파랑
  C: "#2ce8f5", // 하늘
  W: "#ffffff", // 흰
  s: "#c0cbdc", // 밝은 회색
  e: "#8b9bb4", // 회색
  S: "#5a6988", // 짙은 회색
  l: "#3a4466", // 청회색
  n: "#262b44", // 남색
  K: "#181425", // 거의 검정 (차가운 외곽선)
  h: "#ff0044", // 진분홍
  p: "#68386c", // 보라
  M: "#b55088", // 자주
  P: "#f6757a", // 분홍
  1: "#e8b796", // 밝은 피부
  2: "#c28569", // 피부 그늘
};

const cache = new Map();

// 문자열 그림 → 그림 조각 {w, h, rows}. 줄 앞뒤 공백은 무시하고 짧은 줄은 투명으로 채운다.
// map으로 이 그림에서만 쓰는 글자(반투명 색 등)를 더할 수 있다.
export function spr(text, map) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const w = Math.max(...lines.map((l) => l.length));
  const rows = lines.map((l) => l.padEnd(w, "."));
  const pal = map ? { ...PAL, ...map } : PAL;
  for (const r of rows) for (const ch of r) if (ch !== "." && ch !== " " && !(ch in pal)) throw new Error(`픽셀 그림에 모르는 글자 '${ch}'`);
  return { w, h: rows.length, rows, pal, _c: null };
}

// 그림 조각 → 캔버스 (한 번만 만든다)
export function canvasOf(s) {
  if (s._c) return s._c;
  const c = document.createElement("canvas");
  c.width = s.w;
  c.height = s.h;
  const x = c.getContext("2d");
  for (let j = 0; j < s.h; j++)
    for (let i = 0; i < s.w; i++) {
      const ch = s.rows[j][i];
      if (ch === "." || ch === " ") continue;
      x.fillStyle = s.pal[ch];
      x.fillRect(i, j, 1, 1);
    }
  s._c = c;
  return c;
}

// 글자 바꾸기(색 바꾸기). from→to 예: {G: "B", F: "u"}
export function recolor(s, swap) {
  const key = s;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = new Map()));
  const k = JSON.stringify(swap);
  if (m.has(k)) return m.get(k);
  const rows = s.rows.map((r) => [...r].map((ch) => (ch in swap ? swap[ch] : ch)).join(""));
  const out = { w: s.w, h: s.h, rows, pal: s.pal, _c: null };
  m.set(k, out);
  return out;
}

// 한 가지 색으로 칠한 모양 (맞았을 때 번쩍임, 그림자)
const silCache = new Map();
export function silhouette(s, color = "#ffffff") {
  let m = silCache.get(s);
  if (!m) silCache.set(s, (m = new Map()));
  if (m.has(color)) return m.get(color);
  const src = canvasOf(s);
  const c = document.createElement("canvas");
  c.width = s.w;
  c.height = s.h;
  const x = c.getContext("2d");
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, s.w, s.h);
  m.set(color, c);
  return c;
}

// 그리기. (x, y) = 왼쪽 위. o: flip(좌우 뒤집기), alpha, flash(0~1 흰색 덮기), tint(덮을 색), rot(90도 단위 0~3)
export function blit(ctx, s, x, y, o = {}) {
  if (!s) return;
  x = Math.round(x);
  y = Math.round(y);
  const img = canvasOf(s);
  const a = o.alpha == null ? 1 : o.alpha;
  if (a <= 0) return;
  ctx.save();
  if (a < 1) ctx.globalAlpha = a;
  if (o.rot) {
    const r = ((o.rot % 4) + 4) % 4;
    const w = r % 2 ? s.h : s.w;
    const h = r % 2 ? s.w : s.h;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((r * Math.PI) / 2);
    if (o.flip) ctx.scale(-1, 1);
    ctx.translate(-s.w / 2, -s.h / 2);
  } else if (o.flip) {
    ctx.translate(x + s.w, y);
    ctx.scale(-1, 1);
  } else ctx.translate(x, y);
  ctx.drawImage(img, 0, 0);
  if (o.flash > 0 || o.tint) {
    ctx.globalAlpha = a * (o.flash > 0 ? Math.min(1, o.flash) : 1);
    ctx.drawImage(silhouette(s, o.tint || "#ffffff"), 0, 0);
  }
  ctx.restore();
}

// 발끝 가운데 (cx, by) 기준으로 그리기
export function blitFoot(ctx, s, cx, by, o = {}) {
  if (!s) return;
  blit(ctx, s, Math.round(cx) - Math.floor(s.w / 2), Math.round(by) - s.h, o);
}

// ───── 점·선·원 (모두 픽셀 단위, 번짐 없음) ─────
export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}
export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
export function line(ctx, x0, y0, x1, y1, color) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 2000; n++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
// 원 테두리
export function circle(ctx, cx, cy, r, color) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.round(r);
  ctx.fillStyle = color;
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) ctx.fillRect(cx + a, cy + b, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}
// 채운 타원 (rx, ry는 정수 권장)
export function oval(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  cx = Math.round(cx);
  cy = Math.round(cy);
  for (let j = -ry; j <= ry; j++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (j * j) / ((ry + 0.5) * (ry + 0.5)))));
    if (w > 0 || j === 0) ctx.fillRect(cx - w, cy + j, w * 2 + 1, 1);
  }
}
export const disc = (ctx, cx, cy, r, color) => oval(ctx, cx, cy, r, r, color);

// 발밑 그림자
export function shadowAt(ctx, cx, by, rx = 6, ry = 2, a = 0.28) {
  ctx.save();
  ctx.globalAlpha = a;
  oval(ctx, cx, by, rx, ry, PAL.K);
  ctx.restore();
}

// 같은 자리면 늘 같은 값 (0~1)
export function hash(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// DOM(<img>, CSS 배경)에 쓸 그림 주소. scale배로 키워서 만든다.
const urlCache = new Map();
export function spriteURL(s, scale = 1) {
  let m = urlCache.get(s);
  if (!m) urlCache.set(s, (m = new Map()));
  if (m.has(scale)) return m.get(scale);
  const c = document.createElement("canvas");
  c.width = s.w * scale;
  c.height = s.h * scale;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  x.drawImage(canvasOf(s), 0, 0, c.width, c.height);
  const url = c.toDataURL();
  m.set(scale, url);
  return url;
}

// 그림 여러 장을 한 캔버스에 미리 그려 두기 (바닥처럼 안 바뀌는 큰 그림)
export function bake(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  fn(x);
  return c;
}
