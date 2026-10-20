// 마을 그림 (스타듀밸리 펠리컨 마을 같은 아늑한 마을). 지도는 40×28칸(한 칸 16픽셀) = 640×448 그림판 픽셀.
// 북쪽 절벽 가운데 던전 입구, 가운데 분수 광장, 서쪽 대장간, 동쪽 상점, 남서쪽 카드 보관소, 남쪽 집·연못, 남동쪽 텃밭.
// 지형(풀·흙길·돌바닥·물·절벽·그림자)은 처음 한 번 구워 두고, 건물·나무·소품은 그림 조각으로 만들어 발 높이(y)로 정렬해 그린다.
// 그림은 색 글자 버퍼(Pix)에 그리고 마지막에 한 번 캔버스로 바꾼다. 그늘은 팔레트 한 단계 어둡게(SH) 바꾸는 식이라 팔레트 밖 색이 안 생긴다.
import { PAL, hash } from "../pixel.js";

export const TOWN_W = 640;
export const TOWN_H = 448;
const MW = TOWN_W;
const MH = TOWN_H;

// ───── 색 번호 ─────
const CH = ["."];
const RGBA = [[0, 0, 0, 0]];
const IX = { ".": 0, " ": 0 };
function addColor(ch, hex, a) {
  IX[ch] = CH.length;
  CH.push(ch);
  RGBA.push([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), Math.round(a * 255)]);
}
for (const k in PAL) addColor(k, PAL[k], 1);
addColor("x", PAL.K, 0.28); // 그림자
addColor("z", PAL.y, 0.3); // 노란 불빛
addColor("Z", PAL.O, 0.22); // 주황 불빛
addColor("q", PAL.C, 0.3); // 마법 빛
addColor("w", PAL.s, 0.65); // 물보라
// 한 단계 어둡게 / 밝게
const SH = { L: "G", G: "F", F: "D", D: "n", y: "g", g: "o", O: "R", o: "k", c: "t", t: "k", k: "b", b: "d", d: "K", R: "m", r: "m", m: "d", P: "M", M: "p", p: "n", h: "m", W: "s", s: "e", e: "S", S: "l", l: "n", n: "K", K: "K", C: "B", B: "u", u: "n", 1: "2", 2: "k" };
const LI = { D: "F", F: "G", G: "L", L: "y", d: "b", b: "k", k: "t", t: "c", c: "W", K: "n", n: "l", l: "S", S: "e", e: "s", s: "W", u: "B", B: "C", m: "R", R: "o", o: "t", p: "M", M: "P", g: "y", O: "g" };

// 색 번호 → 캔버스 한 칸 (RGBA를 32비트 하나로, 리틀엔디언)
const RGBA32 = new Uint32Array(RGBA.map(([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0));
// 색 번호 → 한 단계 어두운 색 번호
const SHI = new Uint8Array(CH.length);
for (let i = 0; i < CH.length; i++) SHI[i] = SH[CH[i]] ? IX[SH[CH[i]]] : i;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = sm(x / cell - gx);
  const fy = sm(y / cell - gy);
  const a = hash(gx, gy, seed);
  const b = hash(gx + 1, gy, seed);
  const c = hash(gx, gy + 1, seed);
  const d = hash(gx + 1, gy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const H = (a, b, s) => hash(Math.round(a), Math.round(b), s);

// ───── 색 글자 버퍼 ─────
class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h);
    this.c = null;
  }
  g(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? "." : CH[this.d[x + y * this.w]];
  }
  s(x, y, ch) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[x + y * this.w] = IX[ch];
  }
  r(x, y, w, h, ch) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.s(i, j, ch);
  }
  oval(cx, cy, rx, ry, ch) {
    for (let j = -ry; j <= ry; j++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (j * j) / ((ry + 0.5) * (ry + 0.5)))));
      for (let i = -w; i <= w; i++) this.s(cx + i, cy + j, ch);
    }
  }
  m(x, y, M) {
    const c = this.g(x, y);
    if (c !== "." && M[c]) this.s(x, y, M[c]);
  }
  put(src, x, y, flip = false) {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const v = src.d[(flip ? src.w - 1 - i : i) + j * src.w];
        if (!v) continue;
        const X = x + i;
        const Y = y + j;
        if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) this.d[X + Y * this.w] = v;
      }
    return this;
  }
  // 바깥 테두리 (상하좌우 이웃이 칠해진 빈칸)
  outline(ch) {
    const src = this.d.slice();
    const { w, h } = this;
    const v = IX[ch];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (src[x + y * w]) continue;
        if ((x > 0 && src[x - 1 + y * w]) || (x < w - 1 && src[x + 1 + y * w]) || (y > 0 && src[x + (y - 1) * w]) || (y < h - 1 && src[x + (y + 1) * w])) this.d[x + y * w] = v;
      }
    return this;
  }
  canvas() {
    if (this.c) return this.c;
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const x = c.getContext("2d");
    const img = x.createImageData(this.w, this.h);
    const D = new Uint32Array(img.data.buffer);
    for (let i = 0; i < this.d.length; i++) if (this.d[i]) D[i] = RGBA32[this.d[i]];
    x.putImageData(img, 0, 0);
    return (this.c = c);
  }
}
// 문자열 그림 → 버퍼 ('.'은 빈칸)
function P(text) {
  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length);
  const w = Math.max(...rows.map((r) => r.length));
  const p = new Pix(w, rows.length);
  rows.forEach((r, j) =>
    [...r].forEach((ch, i) => {
      if (!(ch in IX)) throw new Error(`마을 그림에 모르는 글자 '${ch}'`);
      p.s(i, j, ch);
    }),
  );
  return p;
}
function drawPix(ctx, pix, x, y, alpha = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= ctx.canvas.width || y >= ctx.canvas.height || x + pix.w <= 0 || y + pix.h <= 0) return;
  if (alpha < 1) {
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    ctx.drawImage(pix.canvas(), x, y);
    ctx.globalAlpha = a0;
  } else ctx.drawImage(pix.canvas(), x, y);
}

// ═════════════ 나무 ═════════════
// 잎 덩어리: 큰 덩이를 작은 동글동글한 잎뭉치로 채우고, 뭉치마다 왼쪽 위는 밝게 오른쪽 아래는 어둡게.
const TONE = [
  ["D", "F", "D"],
  ["F", "G", "D"],
  ["G", "L", "F"],
  ["L", "L", "G"],
];
function crown(p, clumps, seed, shift = 0) {
  const q = new Pix(p.w, p.h);
  for (const [cx, cy, R, bias] of clumps) {
    const ms = [];
    const step = 3.3;
    for (let gy = -R; gy <= R + 0.01; gy += step)
      for (let gx = -R; gx <= R + 0.01; gx += step) {
        const jx = gx + (H((cx + gx) * 4, (cy + gy) * 4, seed) - 0.5) * 2.2;
        const jy = gy + (H((cx + gx) * 5, (cy + gy) * 3, seed + 1) - 0.5) * 2.2;
        if (jx * jx + jy * jy > (R - 0.6) * (R - 0.6)) continue;
        ms.push([cx + jx, cy + jy, 2.3 + H(jx * 9 + cx, jy * 9 + cy, seed + 2) * 1.1]);
      }
    ms.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [mx, my, mr] of ms) {
      const l = -((mx - cx) * 0.75 + (my - cy)) / R;
      const ti = clamp(Math.round(1.45 + l * 1.25 + bias + shift), 0, 3);
      const [b, li, dk] = TONE[ti];
      const r2 = mr * mr;
      for (let y = Math.floor(my - mr); y <= my + mr; y++)
        for (let x = Math.floor(mx - mr); x <= mx + mr; x++) {
          const dx = x + 0.5 - mx;
          const dy = y + 0.5 - my;
          if (dx * dx + dy * dy > r2) continue;
          let c = b;
          if ((dx - 1.25) ** 2 + (dy - 1.25) ** 2 > r2) c = li;
          else if ((dx + 1.2) ** 2 + (dy + 1.2) ** 2 > r2) c = dk;
          q.s(x, y, c);
        }
    }
  }
  q.outline("D");
  p.put(q, 0, 0);
}
function trunk(p, cx, y0, y1, w, seed) {
  const q = new Pix(p.w, p.h);
  for (let y = y0; y <= y1; y++) {
    const f = Math.max(0, y - (y1 - 2));
    const a = cx - Math.floor(w / 2) - f;
    const b = cx + Math.ceil(w / 2) - 1 + f;
    for (let x = a; x <= b; x++) {
      const u = (x - a) / Math.max(1, b - a);
      let c = u < 0.3 ? "k" : u > 0.72 ? "d" : "b";
      if (c === "b" && H(x, y >> 2, seed) > 0.75) c = "d";
      if (c === "k" && H(x, y >> 1, seed + 5) > 0.82) c = "t";
      q.s(x, y, c);
    }
  }
  q.outline("d");
  p.put(q, 0, 0);
}
// 참나무: size 0~2. 밑동(ax, ay) = 그림 안의 발 위치
function oak(size, seed, shift = 0) {
  const R = [9, 12, 15][size];
  const tH = [8, 10, 12][size];
  const W = R * 2 + 10;
  const Hh = Math.round(R * 2 + tH + 4);
  const p = new Pix(W, Hh);
  const cx = W >> 1;
  const base = Hh - 2;
  const cy = R + 3;
  trunk(p, cx, cy + Math.round(R * 0.5), base, [4, 5, 6][size], seed);
  const J = (k) => (hash(k, size, seed) - 0.5) * R * 0.2;
  crown(
    p,
    [
      [cx + J(1), cy - R * 0.42 + J(2), R * 0.6, 0.3],
      [cx - R * 0.5 + J(3), cy - R * 0.12 + J(4), R * 0.55, 0.15],
      [cx + R * 0.5 + J(5), cy - R * 0.06 + J(6), R * 0.52, -0.2],
      [cx + J(7), cy + R * 0.14, R * 0.62, 0],
      [cx - R * 0.62 + J(8), cy + R * 0.42 + J(9), R * 0.44, -0.15],
      [cx + R * 0.6 + J(10), cy + R * 0.44 + J(11), R * 0.44, -0.45],
      [cx - R * 0.18 + J(12), cy + R * 0.64, R * 0.44, -0.35],
      [cx + R * 0.3 + J(13), cy + R * 0.68, R * 0.4, -0.55],
    ],
    seed,
    shift,
  );
  return { pix: p, ax: cx, ay: base, r: R };
}
// 소나무: 층층이 세모, 아래층부터 그리고 위층의 들쭉날쭉한 끝이 아래층을 덮는다
function pine(h, seed, shift = 0) {
  const W = Math.round(h * 0.6) + 4;
  const p = new Pix(W, h);
  const cx = W >> 1;
  const base = h - 2;
  trunk(p, cx, base - 7, base, 4, seed);
  const q = new Pix(W, h);
  const tiers = 4;
  const top = 1;
  const bot = base - 5;
  for (let i = tiers - 1; i >= 0; i--) {
    const tb = top + ((bot - top) * (i + 1)) / tiers;
    const ta = top + ((bot - top) * i) / tiers - (i ? 5 : 0);
    const hw = ((W / 2 - 2) * (i + 1.6)) / (tiers + 0.6);
    for (let y = Math.floor(ta); y <= tb + 2; y++)
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - cx;
        const f = (y - ta + 1) / (tb - ta);
        const edge = tb + (Math.sin(x * 1.7 + i * 2) > 0.2 ? 1 : 0) + (Math.abs(dx) < hw * 0.5 ? 1 : 0);
        if (y > edge || Math.abs(dx) > hw * Math.min(1, f) + 0.4) continue;
        const u = dx / hw;
        let c = u < -0.3 ? "G" : u > 0.38 ? "D" : "F";
        if (u < -0.05 && H(x * 3, y * 2, seed + i) > 0.7) c = u < -0.45 ? "L" : "G";
        if (u > 0.1 && H(x * 2, y * 3, seed + i) > 0.75) c = "D";
        if (y >= edge - 1) c = u < -0.2 ? "F" : "D";
        if (y === Math.floor(ta) && Math.abs(dx) < 1.5) c = "G";
        q.s(x, y, c);
      }
    // 위층이 아래층에 드리우는 그늘
    if (i < tiers - 1)
      for (let x = 0; x < W; x++) {
        const y = Math.round(tb) + 2;
        if (q.g(x, y + 1) !== "." && q.g(x, y) === ".") q.s(x, y + 1, "D");
      }
  }
  if (shift < 0) for (let i = 0; i < q.d.length; i++) if (q.d[i]) q.d[i] = IX[SH[CH[q.d[i]]] || CH[q.d[i]]];
  q.outline("D");
  p.put(q, 0, 0);
  return { pix: p, ax: cx, ay: base, r: W / 2 - 2 };
}
// 덤불 (열매나 꽃이 조금)
function bush(w, seed, dots) {
  const Hh = Math.round(w * 0.75) + 4;
  const p = new Pix(w + 4, Hh);
  const cx = p.w / 2;
  const R = w / 2;
  const by = Hh - 2;
  crown(
    p,
    [
      [cx - R * 0.42, by - R * 0.7, R * 0.56, 0.1],
      [cx + R * 0.42, by - R * 0.66, R * 0.55, -0.3],
      [cx, by - R * 0.95, R * 0.6, 0.25],
      [cx + R * 0.05, by - R * 0.45, R * 0.55, -0.25],
    ],
    seed,
  );
  if (dots)
    for (let k = 0; k < Math.round(w / 3); k++) {
      const x = Math.round(cx + (hash(k, 1, seed) - 0.6) * w * 0.7);
      const y = Math.round(by - R * 0.4 - hash(k, 2, seed) * R * 0.9);
      if (p.g(x, y) === "G" || p.g(x, y) === "F" || p.g(x, y) === "L") {
        p.s(x, y, dots[0]);
        if (p.g(x + 1, y + 1) !== ".") p.s(x + 1, y + 1, dots[1]);
      }
    }
  return { pix: p, ax: Math.round(cx), ay: by, r: R };
}

const TREES = {
  oakL: oak(2, 11),
  oakL2: oak(2, 23),
  oakM: oak(1, 31),
  oakM2: oak(1, 47),
  oakS: oak(0, 53),
  pine: pine(46, 61),
  pine2: pine(40, 67),
  pineS: pine(32, 71),
  bush: bush(16, 81, ["r", "m"]),
  bush2: bush(14, 87, null),
  bushF: bush(18, 91, ["c", "t"]),
  // 절벽 위 (조금 어둡게)
  backOak: oak(2, 101, -0.45),
  backOak2: oak(1, 107, -0.45),
  backPine: pine(42, 113, -1),
};

// ═════════════ 집 짓기 공통 ═════════════
const RED = { o: "d", d: "m", s: "m", b: "R", l: "o", h: "t", e: "o" };
const SLATE = { o: "K", d: "n", s: "n", b: "l", l: "S", h: "e", e: "S" };
const PURPLE = { o: "n", d: "n", s: "n", b: "p", l: "M", h: "M", e: "M", lr: 0.09, alt: "l" };

function shingle(x, y, R, seed, u) {
  const rowH = 4;
  const w = 7;
  const row = Math.floor(y / rowH);
  const yy = y - row * rowH;
  const off = (row & 1) * 3 + Math.floor(hash(row, 1, seed) * 2);
  const sx = x + off;
  const id = Math.floor(sx / w);
  const xx = sx - id * w;
  const v = hash(id, row, seed);
  let base = R.b;
  if (v < (R.lr || 0.17) - u * 0.1) base = R.l;
  else if (v > 0.9 - u * 0.05) base = R.s;
  else if (R.alt && v > 0.78) base = R.alt;
  if (yy === 0) return R.s;
  if (xx === 0) return yy === rowH - 1 ? R.s : R.d;
  if (xx === 1 && yy === 1 && hash(id, row, seed + 7) > 0.4) return R.l;
  return base;
}
// 앞에서 비스듬히 보이는 지붕 (사다리꼴): 처마(아래)가 넓고 용마루(위)가 좁다
function roof(p, x0, x1, y0, y1, inset, R, seed) {
  const n = y1 - y0;
  const L = (y) => Math.round(x0 + inset * (1 - (y - y0) / n));
  const Rt = (y) => Math.round(x1 - inset * (1 - (y - y0) / n));
  for (let y = y0; y <= y1; y++)
    for (let x = L(y); x <= Rt(y); x++) {
      let c;
      const ry = y - y0;
      if (ry === 0 || y === y1) c = R.o;
      else if (ry === 1) c = R.h;
      else if (ry === 2) c = R.l;
      else if (ry === 3) c = R.d;
      else if (y === y1 - 1) c = R.e;
      else c = shingle(x - x0, ry - 4, R, seed, (x - x0) / (x1 - x0));
      p.s(x, y, c);
    }
  for (let y = y0; y <= y1; y++) {
    p.s(L(y), y, R.o);
    p.s(Rt(y), y, R.o);
    if (y > y0 + 1 && y < y1 - 1) {
      p.s(L(y) + 1, y, R.l);
      p.s(Rt(y) - 1, y, R.s);
    }
  }
  // 용마루 끝 장식
  p.s(L(y0 + 1), y0 + 1, R.o);
  p.s(Rt(y0 + 1), y0 + 1, R.o);
  return { L, R: Rt };
}
// 앞으로 튀어나온 세모 박공. 꼭대기 (cx, ay) ~ 아래 by, 반폭 hw, 지붕 띠 두께 th. inner(x,y) = 안쪽 벽 칠하기
function gable(p, cx, ay, by, hw, th, R, seed, inner) {
  for (let y = ay; y <= by; y++) {
    const half = (hw * (y - ay)) / (by - ay);
    const a = Math.round(cx - half);
    const b = Math.round(cx + half);
    for (let x = a; x <= b; x++) {
      const e = Math.min(x - a, b - x);
      const left = x < cx;
      if (e >= th + 1 && y < by - 1) {
        inner(x, y);
        continue;
      }
      let c;
      if (e === 0 || y === by) c = R.o;
      else if (y === by - 1 && e > th) c = R.o;
      else if (e === 1) c = left ? R.h : R.l;
      else if (e === th) c = R.o;
      else {
        c = shingle(left ? x - a : b - x, y - ay, R, seed, left ? 0 : 1);
        if (!left && c === R.b && hash(x, y, seed) > 0.4) c = R.s;
      }
      p.s(x, y, c);
    }
  }
  // 처마 끝 장식 (꼭대기 장식판)
  p.s(cx, ay - 1, R.o);
}
// 처마 밑 그늘: 벽 위쪽 몇 줄을 한 단계 어둡게 (맨 윗줄은 두 단계)
function shadeRows(p, x0, x1, y0, n) {
  for (let y = y0; y < y0 + n; y++)
    for (let x = x0; x <= x1; x++) {
      p.m(x, y, SH);
      if (y === y0) p.m(x, y, SH);
    }
}
// 돌벽: 크기가 조금씩 다른 돌을 엇갈려 쌓는다
function stoneWall(p, x0, y0, w, h, seed, tones, mortar, rh0 = 5, sw0 = 6, sw1 = 13) {
  let y = y0;
  let row = 0;
  while (y < y0 + h) {
    const rh = rh0 + (hash(row, 0, seed) > 0.55 ? 1 : 0);
    let x = x0 - Math.floor(hash(row, 1, seed) * sw0);
    while (x < x0 + w) {
      const sw = sw0 + Math.floor(hash(x, row, seed) * (sw1 - sw0));
      const tone = tones[Math.floor(hash(x, row, seed + 3) * tones.length)];
      for (let j = 0; j < rh; j++)
        for (let i = 0; i < sw; i++) {
          const X = x + i;
          const Y = y + j;
          if (X < x0 || X >= x0 + w || Y >= y0 + h) continue;
          let c;
          if (i === sw - 1 || j === rh - 1) c = mortar;
          else if (i === 0 && j === 0) c = mortar;
          else if (j === 0 || (i === 0 && j < rh - 2)) c = tone[1];
          else if (j === rh - 2 || i === sw - 2) c = tone[2];
          else c = tone[0];
          p.s(X, Y, c);
        }
      // 돌 무늬 한두 점
      if (sw > 8 && hash(x, row, seed + 9) > 0.6) p.s(x + 2 + Math.floor(hash(x, row, seed + 10) * (sw - 5)), y + 2, tone[2]);
      x += sw;
    }
    y += rh;
    row++;
  }
}
// 가로 판자벽
function planks(p, x0, y0, w, h, seed, C = { b: "k", l: "t", d: "b", k: "d" }) {
  for (let y = y0; y < y0 + h; y++) {
    const row = Math.floor((y - y0) / 4);
    const yy = (y - y0) % 4;
    for (let x = x0; x < x0 + w; x++) {
      let c = C.b;
      if (yy === 3) c = C.d;
      else if (yy === 0 && hash(x >> 3, row, seed) > 0.4) c = C.l;
      p.s(x, y, c);
    }
  }
  const rows = Math.ceil(h / 4);
  for (let r = 0; r < rows; r++) {
    const ry = y0 + r * 4;
    let x = x0 + 3 + Math.floor(hash(r, 1, seed) * 16);
    while (x < x0 + w - 3) {
      for (let yy = 0; yy < 3; yy++) p.s(x, ry + yy, C.d);
      p.s(x + 1, ry + 1, C.k);
      x += 15 + Math.floor(hash(x, r, seed + 2) * 14);
    }
    if (hash(r, 7, seed) > 0.55) {
      const kx = x0 + 4 + Math.floor(hash(r, 8, seed) * (w - 8));
      p.s(kx, ry + 1, C.d);
      p.s(kx + 1, ry + 1, C.d);
      p.s(kx + 1, ry + 2, C.d);
    }
  }
}
// 나무 기둥·들보 (왼쪽 위 밝게)
function beam(p, x, y, w, h) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let c = "b";
      if (w <= h ? i === 0 : j === 0) c = "k";
      if (w <= h ? i === w - 1 : j === h - 1) c = "d";
      p.s(x + i, y + j, c);
    }
}
// 유리창: 남색 유리에 비스듬한 빛 줄, 십자 창살, 창턱
function windowAt(p, x, y, w, h, o = {}) {
  p.r(x, y, w, h, "d");
  p.r(x + 1, y + 1, w - 2, h - 2, o.frame || "k");
  for (let i = x + 1; i < x + w - 1; i++) p.s(i, y + 1, o.frameL || "t");
  for (let j = y + 1; j < y + h - 1; j++) p.s(x + 1, j, o.frameL || "t");
  const gx = x + 2;
  const gy = y + 2;
  const gw = w - 4;
  const gh = h - 4;
  if (o.fill) o.fill(gx, gy, gw, gh);
  else
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        let c = j === 0 ? "n" : "u";
        const k = i + j;
        if (k === 3 || k === 4 || k === 8) c = "B";
        if (j > gh - 3 && c === "u") c = "B";
        p.s(gx + i, gy + j, c);
      }
  if (o.cross !== false) {
    const mx = gx + Math.floor(gw / 2);
    const my = gy + Math.floor(gh / 2);
    for (let j = gy; j < gy + gh; j++) p.s(mx, j, o.frame || "k");
    for (let i = gx; i < gx + gw; i++) p.s(i, my, o.frame || "k");
  }
  if (!o.fill) {
    p.s(gx + 1, gy + 1, "C");
    p.s(gx + 2, gy + 1, "W");
  }
  // 창턱
  p.r(x - 1, y + h - 1, w + 2, 1, "c");
  p.r(x - 1, y + h, w + 2, 1, "k");
  p.s(x - 2, y + h - 1, "d");
  p.s(x + w, y + h - 1, "d");
  p.s(x - 2, y + h, "d");
  p.s(x + w, y + h, "d");
  for (let i = x - 1; i <= x + w; i++) p.m(i, y + h + 1, SH);
  if (o.box) flowerBox(p, x - 1, y + h + 1, w + 2, o.box);
  if (o.shutter) {
    const S = o.shutter;
    for (const sx of [x - 5, x + w + 1])
      for (let j = y; j < y + h - 1; j++)
        for (let i = 0; i < 4; i++) {
          let c = i === 0 || i === 3 ? "d" : j === y ? "d" : (j - y) % 3 === 0 ? S[2] : i === 1 ? S[0] : S[1];
          if (j === y + h - 2) c = "d";
          p.s(sx + i, j, c);
        }
  }
}
// 창밑 꽃상자
function flowerBox(p, x, y, w, seed) {
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < w; i++) {
      let c = j === 0 ? "t" : j === 3 ? "d" : "k";
      if (i === 0 || i === w - 1) c = "d";
      if (j === 2 && i > 0 && i < w - 1) c = "b";
      p.s(x + i, y + j, c);
    }
  const cols = [["P", "M"], ["r", "m"], ["y", "g"], ["c", "t"]];
  for (let i = 1; i < w - 1; i++) {
    const h = 1 + Math.floor(hash(i, 1, seed) * 2.2);
    for (let j = 1; j <= h; j++) p.s(x + i, y - j, j === h && hash(i, 2, seed) > 0.5 ? "L" : hash(i, j, seed) > 0.5 ? "G" : "F");
  }
  for (let i = 2; i < w - 2; i += 2 + Math.floor(hash(i, 3, seed) * 2)) {
    const [a, b] = cols[Math.floor(hash(i, 4, seed) * cols.length)];
    const fy = y - 2 - Math.floor(hash(i, 5, seed) * 2);
    p.s(x + i, fy, a);
    p.s(x + i + 1, fy, a);
    p.s(x + i, fy - 1, a);
    p.s(x + i + 1, fy + 1, b);
  }
}
// 나무 문 (세로 판자, 손잡이, 문 앞 돌계단)
function doorAt(p, x, y, w, h, o = {}) {
  const C = o.paint || ["b", "k", "t"]; // 틈, 바탕, 밝음
  p.r(x - 1, y - 1, w + 2, h + 1, "d");
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const u = (i - x) % 4;
      let c = u === 0 && i > x ? C[0] : u === 1 ? C[2] : C[1];
      if (j === y) c = C[0];
      p.s(i, j, c);
    }
  if (o.arch) {
    const r = Math.floor(w / 2);
    for (let j = 0; j < r; j++)
      for (let i = 0; i < w; i++) {
        const dx = i + 0.5 - w / 2;
        const dy = r - j - 0.5;
        if (dx * dx + dy * dy > r * r) {
          const inside = dx * dx + (dy - 1) * (dy - 1) <= r * r || dx * dx + dy * dy <= (r + 1.2) * (r + 1.2);
          p.s(x + i, y + j, inside ? "d" : o.wall || "d");
        }
      }
  }
  if (o.win) {
    const wx = x + Math.floor(w / 2) - 2;
    const wy = y + (o.arch ? 4 : 3);
    p.r(wx - 1, wy - 1, 6, 6, "d");
    p.r(wx, wy, 4, 4, "u");
    p.s(wx, wy, "n");
    p.s(wx + 1, wy, "n");
    p.s(wx + 2, wy + 1, "B");
    p.s(wx + 1, wy + 2, "B");
    p.s(wx + 1, wy + 1, "C");
  }
  if (o.straps)
    for (const sy of o.straps) {
      for (let i = x; i < x + w; i++) p.s(i, y + sy, i % 3 === 0 ? "e" : "K");
      p.s(x, y + sy + 1, "K");
    }
  const hy = y + Math.floor(h * 0.55);
  if (o.ring) {
    for (const hx of o.ring) {
      p.s(hx, hy - 1, "S");
      p.s(hx - 1, hy, "S");
      p.s(hx + 1, hy, "S");
      p.s(hx, hy + 1, "e");
    }
  } else {
    const hx = o.left ? x + 2 : x + w - 3;
    p.s(hx, hy, "g");
    p.s(hx, hy - 1, "y");
    p.s(hx + (o.left ? -1 : 1), hy + 1, "b");
  }
  // 문 앞 돌계단
  const sy = y + h;
  for (let i = x - 2; i < x + w + 2; i++) {
    p.s(i, sy, i === x - 2 || i === x + w + 1 ? "S" : "s");
    p.s(i, sy + 1, "e");
    p.s(i, sy + 2, "S");
  }
  p.s(x - 3, sy + 1, "l");
  p.s(x + w + 2, sy + 1, "l");
  p.s(x - 3, sy + 2, "l");
  p.s(x + w + 2, sy + 2, "l");
}
// 걸린 간판 판 (아이콘 그림), 사슬 달린 판 하나를 반환
function signBoard(icon, w = 14, h = 10) {
  const p = new Pix(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let c = "t";
      if (j === 1) c = "c";
      if (j === h - 2) c = "k";
      if ((j === 4 || j === 7) && hash(i >> 2, j, 5) > 0.5) c = "k";
      if (i === 0 || j === 0 || i === w - 1 || j === h - 1) c = "d";
      p.s(i, j, c);
    }
  p.s(0, 0, ".");
  p.s(w - 1, 0, ".");
  p.s(0, h - 1, ".");
  p.s(w - 1, h - 1, ".");
  p.put(icon, Math.floor((w - icon.w) / 2), Math.floor((h - icon.h) / 2));
  return p;
}
const ICONS = {
  anvil: P(`
    KKKKKKKK
    .KlSSSlK
    ...KlK..
    ..KSSSK.
  `),
  bag: P(`
    ..d.d..
    ...d...
    .dgggd.
    dgyggOd
    dggOgOd
    .dOOOd.
  `),
  card: P(`
    .ppppp.
    pcccccp
    pccMccp
    pcMyMcp
    pccMccp
    .ppppp.
  `),
  skull: P(`
    .sss.
    sssss
    sKsKs
    .sss.
    .s.s.
  `),
};

// ═════════════ 대장간 ═════════════
const FORGE_WIN = { x: 14, y: 60, w: 27, h: 21 };
function buildSmithy() {
  const p = new Pix(110, 102);
  const wx0 = 7;
  const wx1 = 92;
  const wy0 = 46;
  const base = 97;
  // 돌벽
  stoneWall(p, wx0, wy0, wx1 - wx0 + 1, base - wy0 - 3, 11, [["e", "s", "S"], ["e", "s", "S"], ["S", "e", "l"], ["e", "s", "S"]], "l");
  for (let y = wy0; y <= base; y++) {
    p.s(wx0 - 1, y, "K");
    p.s(wx1 + 1, y, "K");
  }
  // 기초 (조금 튀어나온 큰 돌)
  stoneWall(p, wx0 - 2, base - 4, wx1 - wx0 + 5, 5, 12, [["S", "e", "l"], ["S", "e", "l"], ["l", "S", "n"]], "n", 4, 7, 14);
  for (let x = wx0 - 2; x <= wx1 + 2; x++) p.s(x, base, "K");
  // 지붕 (짙은 슬레이트) + 기와 틈에 낀 이끼
  roof(p, 1, 98, 12, 50, 8, SLATE, 13);
  for (const [mx, my, n] of [
    [14, 44, 5],
    [22, 36, 3],
    [70, 40, 4],
    [48, 24, 3],
    [84, 46, 4],
  ])
    for (let i = 0; i < n; i++) {
      p.s(mx + i, my, i % 2 ? "F" : "G");
      if (i > 0 && i < n - 1) p.s(mx + i, my - 1, i === 1 ? "L" : "F");
    }
  shadeRows(p, wx0, wx1, 51, 3);
  // 옆 굴뚝 (땅에서 지붕 위까지 쌓은 돌)
  const cx0 = 92;
  const cx1 = 106;
  stoneWall(p, cx0, 6, cx1 - cx0 + 1, base - 6, 14, [["e", "s", "S"], ["S", "e", "l"], ["e", "s", "S"]], "l", 5, 5, 9);
  for (let y = 6; y <= base; y++) {
    p.s(cx0 - 1, y, "K");
    p.s(cx1 + 1, y, "K");
    p.m(cx1, y, SH);
    p.m(cx1 - 1, y, SH);
  }
  // 굴뚝 머리
  for (let x = cx0 - 2; x <= cx1 + 2; x++) {
    p.s(x, 2, "K");
    p.s(x, 3, x < cx0 + 3 ? "s" : "e");
    p.s(x, 4, x > cx1 ? "l" : "S");
    p.s(x, 5, "K");
  }
  p.s(cx0 - 2, 3, "K");
  p.s(cx1 + 2, 3, "K");
  p.s(cx0 - 2, 4, "K");
  p.s(cx1 + 2, 4, "K");
  for (let x = cx0 + 2; x <= cx1 - 2; x++) p.s(x, 2, "n");
  for (let x = cx0 + 3; x <= cx1 - 3; x++) p.s(x, 1, "K");
  p.s(cx0 + 2, 1, "K");
  p.s(cx1 - 2, 1, "K");
  for (let x = cx0 + 3; x <= cx1 - 3; x++) p.s(x, 2, "K");
  // 지붕 아래 굴뚝 옆 그늘
  for (let y = 51; y < 54; y++) p.m(cx0 - 2, y, SH);
  // 화덕 창 (돌 이맛돌 + 쇠창살 + 불빛)
  const F = FORGE_WIN;
  for (let x = F.x - 2; x < F.x + F.w + 2; x++) {
    p.s(x, F.y - 4, "K");
    p.s(x, F.y - 3, x < F.x + 6 ? "s" : "e");
    p.s(x, F.y - 2, "e");
    p.s(x, F.y - 1, "S");
  }
  p.s(F.x - 2, F.y - 3, "K");
  p.s(F.x + F.w + 1, F.y - 3, "K");
  p.s(F.x + 12, F.y - 3, "K");
  p.s(F.x + 12, F.y - 2, "l");
  p.r(F.x - 1, F.y, F.w + 2, F.h + 1, "K");
  forgeFill(p, F, 0);
  // 창턱
  for (let x = F.x - 2; x < F.x + F.w + 2; x++) {
    p.s(x, F.y + F.h + 1, "s");
    p.s(x, F.y + F.h + 2, "S");
    p.m(x, F.y + F.h + 3, SH);
  }
  // 쌍여닫이 문 + 나무 이맛보
  const dx = 57;
  const dy = 67;
  const dw = 22;
  beam(p, dx - 4, dy - 4, dw + 8, 3);
  p.r(dx - 5, dy - 5, dw + 10, 1, "d");
  p.s(dx - 5, dy - 4, "d");
  p.s(dx + dw + 4, dy - 4, "d");
  doorAt(p, dx, dy, dw, base - dy, { paint: ["d", "b", "k"], straps: [5, 21], ring: [dx + 9, dx + 12] });
  for (let j = dy; j < base; j++) p.s(dx + 10, j, "d");
  for (let j = dy; j < base; j++) p.s(dx + 11, j, "K");
  // 이맛보 위 편자
  p.put(
    P(`
    e...e
    S...S
    .SeS.
  `),
    dx + 9,
    dy - 9,
  );
  // 걸린 간판 (쇠 팔 + 사슬 + 모루 그림 판)
  const sx = 43;
  for (let x = sx - 1; x <= sx + 12; x++) p.s(x, 54, "K");
  p.s(sx - 1, 55, "K");
  p.s(sx - 1, 53, "K");
  p.s(sx + 12, 53, "S");
  p.s(sx + 13, 53, "K");
  p.s(sx + 2, 55, "S");
  p.s(sx + 9, 55, "S");
  const board = signBoard(ICONS.anvil, 12, 9);
  p.put(board, sx, 56);
  return { pix: p, base, door: { x: dx + dw / 2, y: base }, sign: { x: sx + 6, y: 56 }, wall: [wx0 - 2, cx1 + 2], chimney: { x: (cx0 + cx1) / 2, y: 1 } };
}
// 화덕 불빛 (창 안쪽). f = 깜빡임 단계
function forgeFill(p, F, f) {
  for (let j = 0; j < F.h; j++)
    for (let i = 0; i < F.w; i++) {
      const X = F.x + i;
      const Y = F.y + j;
      const v = j / F.h;
      const n = hash(i >> 1, (j + f * 3) >> 1, 41 + f);
      let c = v < 0.3 ? "d" : v < 0.55 ? "m" : v < 0.75 ? "R" : "O";
      if (v > 0.55 && n > 0.72) c = v > 0.8 ? "g" : "O";
      // 화덕 불 (아래 가운데)
      const fx = Math.abs(i - F.w * 0.55) / (F.w * 0.4);
      if (v > 0.7 - (1 - fx) * 0.25 && fx < 1) c = n > 0.5 - f * 0.1 ? "g" : "O";
      if (v > 0.84 && fx < 0.55) c = n > 0.35 ? "y" : "g";
      if (i % 5 === 2) c = "K";
      if (i % 5 === 3 && v > 0.3) c = c === "d" ? "d" : "l";
      p.s(X, Y, c);
    }
  // 위쪽 창살 가로대
  for (let i = 0; i < F.w; i++) p.s(F.x + i, F.y + 1, "K");
  for (let i = 0; i < F.w; i++) if (i % 5 !== 2) p.s(F.x + i, F.y + 2, "l");
}
const FORGE_FRAMES = [0, 1, 2].map((f) => {
  const p = new Pix(FORGE_WIN.w, FORGE_WIN.h);
  forgeFill(p, { x: 0, y: 0, w: FORGE_WIN.w, h: FORGE_WIN.h }, f);
  return p;
});

// ═════════════ 상점 ═════════════
function buildShop() {
  const p = new Pix(120, 102);
  const wx0 = 8;
  const wx1 = 111;
  const wy0 = 44;
  const base = 96;
  planks(p, wx0, wy0, wx1 - wx0 + 1, base - wy0, 21);
  // 모서리 기둥
  for (const x of [wx0 - 2, wx1 - 1]) beam(p, x, wy0, 3, base - wy0);
  for (let y = wy0; y <= base; y++) {
    p.s(wx0 - 3, y, "d");
    p.s(wx1 + 2, y, "d");
  }
  // 기초 돌
  stoneWall(p, wx0 - 3, base - 3, wx1 - wx0 + 6, 4, 22, [["e", "s", "S"], ["S", "e", "l"]], "l", 3, 5, 11);
  for (let x = wx0 - 3; x <= wx1 + 2; x++) p.s(x, base, "K");
  // 지붕 (빨간 기와) + 작은 지붕창
  roof(p, 1, 118, 10, 48, 8, RED, 21);
  dormer(p, 30, 17);
  // 작은 벽돌 굴뚝
  for (let y = 4; y < 20; y++)
    for (let x = 90; x < 98; x++) {
      let c = (y + (x > 93 ? 2 : 0)) % 4 === 0 ? "b" : x === 90 ? "o" : x >= 96 ? "m" : "R";
      if (y === 4) c = "d";
      if (y === 5) c = x < 96 ? "k" : "b";
      p.s(x, y, c);
    }
  for (let y = 4; y < 20; y++) {
    p.s(89, y, "d");
    p.s(98, y, "d");
  }
  for (let x = 89; x <= 98; x++) p.s(x, 3, "d");
  shadeRows(p, wx0 - 2, wx1 + 1, 49, 3);
  // 진열창 + 줄무늬 차양
  windowAt(p, 14, 61, 33, 22, { fill: (x, y, w, h) => shopDisplay(p, x, y, w, h), cross: false });
  awning(p, 9, 50, 43, 12);
  // 문 (위에 작은 창)
  const dx = 61;
  const dy = 63;
  const dw = 16;
  beam(p, dx - 3, dy - 3, dw + 6, 2);
  for (let j = dy - 2; j < base; j++) {
    p.s(dx - 2, j, "b");
    p.s(dx + dw + 1, j, "d");
  }
  doorAt(p, dx, dy, dw, base - dy, { win: true });
  // 오른쪽 창 + 덧문 + 꽃상자
  windowAt(p, 88, 60, 16, 17, { box: 5, shutter: ["G", "F", "D"] });
  // 문 옆 벽등
  p.put(
    P(`
    .K.
    KSK
    KyK
    KgK
    .K.
  `),
    dx + dw + 4,
    dy + 2,
  );
  p.s(dx + dw + 5, dy + 1, "K");
  // 문 위 간판 (사슬 두 줄)
  const board = signBoard(ICONS.bag, 16, 10);
  const sx = dx + dw / 2 - 8;
  p.s(sx + 3, 49, "K");
  p.s(sx + 12, 49, "K");
  p.s(sx + 3, 50, "S");
  p.s(sx + 12, 50, "S");
  p.put(board, sx, 51);
  return { pix: p, base, door: { x: dx + dw / 2, y: base }, sign: { x: sx + 8, y: 51 }, wall: [wx0 - 3, wx1 + 2] };
}
// 진열창 속 물건 (병, 빵, 사과)
function shopDisplay(p, x, y, w, h) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let c = j < 2 ? "n" : "u";
      if (j > h - 6) c = "b";
      if (j === h - 6) c = "k";
      p.s(x + i, y + j, c);
    }
  // 선반 위 병들
  const items = [
    [2, "r", "m"],
    [5, "B", "u"],
    [8, "L", "G"],
    [20, "g", "o"],
    [23, "M", "p"],
    [26, "r", "m"],
  ];
  for (const [ix, a, b] of items) {
    const by = y + h - 7;
    p.s(x + ix, by - 4, "c");
    p.s(x + ix, by - 3, a);
    p.s(x + ix - 1, by - 2, a);
    p.s(x + ix, by - 2, "W");
    p.s(x + ix + 1, by - 2, b);
    p.s(x + ix - 1, by - 1, a);
    p.s(x + ix, by - 1, a);
    p.s(x + ix + 1, by - 1, b);
    p.s(x + ix - 1, by, b);
    p.s(x + ix, by, b);
    p.s(x + ix + 1, by, b);
  }
  // 빵 바구니
  const bx = x + 12;
  const by = y + h - 7;
  for (let i = 0; i < 7; i++) {
    p.s(bx + i, by, "k");
    p.s(bx + i, by - 1, i === 0 || i === 6 ? "k" : "t");
  }
  p.s(bx + 1, by - 2, "c");
  p.s(bx + 2, by - 2, "t");
  p.s(bx + 3, by - 2, "t");
  p.s(bx + 4, by - 2, "c");
  p.s(bx + 5, by - 2, "t");
  p.s(bx + 2, by - 3, "c");
  p.s(bx + 3, by - 3, "t");
  // 유리 반사
  for (let j = 0; j < h - 6; j++) {
    const i = j + 3;
    if (i < w) p.s(x + i, y + j, p.g(x + i, y + j) === "u" ? "B" : p.g(x + i, y + j));
    if (i + 1 < w && j < 5) p.s(x + i + 1, y + j, "B");
  }
  p.s(x + 4, y + 1, "C");
  p.s(x + 5, y + 1, "W");
}
// 줄무늬 차양 (빨강·크림), 아래 끝은 물결
function awning(p, x, y, w, h) {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const stripe = Math.floor(i / 4) % 2;
      let c = stripe ? "c" : "r";
      if (j < 2) c = stripe ? "t" : "m";
      else if (j === 2) c = stripe ? "c" : "R";
      if (i === 0 || i === w - 1) c = "d";
      if (j === 0) c = "d";
      p.s(x + i, y + j, c);
    }
  // 물결 끝
  for (let i = 0; i < w; i++) {
    const k = i % 4;
    const stripe = Math.floor(i / 4) % 2;
    const drop = k === 1 || k === 2 ? 2 : 1;
    for (let j = 0; j < drop; j++) p.s(x + i, y + h + j, j === drop - 1 ? "d" : stripe ? "t" : "m");
    p.s(x + i, y + h + drop, "d");
    p.m(x + i, y + h + drop + 1, SH);
    p.m(x + i, y + h + drop + 2, SH);
  }
  // 차양 받침대
  p.s(x, y + h, "d");
  p.s(x + w - 1, y + h, "d");
}
// 지붕창 (작은 세모 지붕 + 창)
function dormer(p, x, y) {
  const w = 20;
  planks(p, x + 2, y + 9, w - 4, 13, 31);
  windowAt(p, x + 5, y + 10, 10, 10, { cross: true });
  for (let j = y + 9; j < y + 23; j++) {
    p.s(x + 1, j, "d");
    p.s(x + w - 2, j, "d");
  }
  gable(p, x + w / 2, y, y + 10, w / 2 + 1, 3, RED, 27, (X, Y) => p.s(X, Y, Y > y + 8 ? "b" : "k"));
  for (let i = x + 1; i < x + w - 1; i++) p.m(i, y + 11, SH);
  for (let i = x; i < x + w; i++) p.s(i, y + 23, "m");
}

// ═════════════ 카드 보관소 ═════════════
const ROUND_WIN = { x: 53, y: 33, r: 8 };
function buildCardHouse() {
  const p = new Pix(108, 106);
  const wx0 = 8;
  const wx1 = 99;
  const wy0 = 56;
  const base = 100;
  // 회벽 + 나무 뼈대
  plasterWall(p, wx0, wy0, wx1 - wx0 + 1, base - wy0, 41);
  for (const bx of [wx0, 38, 68, wx1 - 2]) beam(p, bx, wy0, 3, base - wy0);
  beam(p, wx0, 88, wx1 - wx0 + 1, 3);
  for (let y = wy0; y <= base; y++) {
    p.s(wx0 - 1, y, "d");
    p.s(wx1 + 1, y, "d");
  }
  stoneWall(p, wx0 - 2, base - 3, wx1 - wx0 + 5, 4, 42, [["e", "s", "S"], ["S", "e", "l"]], "l", 3, 5, 10);
  for (let x = wx0 - 2; x <= wx1 + 2; x++) p.s(x, base, "K");
  // 보라 지붕 + 가운데 큰 박공 (둥근 창)
  roof(p, 1, 106, 24, 60, 7, PURPLE, 43);
  gable(p, 53, 4, 60, 31, 6, PURPLE, 44, (x, y) => {
    let c = "c";
    if (vnoise(x, y, 6, 45) > 0.72) c = "t";
    if (y > 54) c = "t";
    p.s(x, y, c);
  });
  // 박공 속 나무 뼈대
  for (let y = 18; y < 54; y++) {
    if (p.g(53, y) === "c" || p.g(53, y) === "t") p.s(53, y, y < 22 ? "b" : p.g(53, y));
  }
  for (let x = 30; x <= 76; x++) if ("ct".includes(p.g(x, 50))) beam(p, x, 50, 1, 3);
  // 둥근 창
  roundWindow(p, ROUND_WIN.x, ROUND_WIN.y, ROUND_WIN.r);
  shadeRows(p, wx0, wx1, 61, 3);
  // 박공 아래 그늘
  for (let x = 23; x <= 83; x++) p.m(x, 61, SH);
  // 아치 문 (보랏빛 칠)
  const dx = 45;
  const dy = 72;
  const dw = 17;
  for (let j = dy - 2; j < base; j++) {
    p.s(dx - 2, j, "b");
    p.s(dx + dw + 1, j, "d");
  }
  doorAt(p, dx, dy, dw, base - dy, { arch: true, paint: ["n", "p", "M"], wall: "c" });
  // 문 테두리 아치 돌
  for (let i = -1; i <= dw; i++) {
    const t = (i + 0.5) / dw - 0.5;
    const yy = Math.round(dy + Math.pow(Math.abs(t) * 2, 2.2) * 7) - 2;
    p.s(dx + i, yy, Math.abs(t) < 0.12 ? "g" : "e");
    p.s(dx + i, yy - 1, "K");
  }
  // 책장이 보이는 창 두 개
  const books = (x, y, w, h) => bookFill(p, x, y, w, h);
  windowAt(p, 16, 66, 18, 18, { fill: books, frame: "b", frameL: "k" });
  windowAt(p, 74, 66, 18, 18, { fill: books, frame: "b", frameL: "k" });
  // 문 위 카드 간판 (사슬)
  const board = signBoard(ICONS.card, 14, 10);
  const sx = dx + Math.round(dw / 2) - 7;
  p.s(sx + 3, 62, "K");
  p.s(sx + 10, 62, "K");
  p.s(sx + 3, 63, "S");
  p.s(sx + 10, 63, "S");
  p.put(board, sx, 64);
  // 마법 등 걸이 (문 왼쪽 벽)
  p.s(37, 72, "K");
  p.s(38, 72, "K");
  p.s(39, 72, "K");
  p.s(39, 73, "K");
  return { pix: p, base, door: { x: dx + dw / 2, y: base }, sign: { x: sx + 7, y: 64 }, wall: [wx0 - 2, wx1 + 2], lamp: { x: 39, y: 74 } };
}
function plasterWall(p, x0, y0, w, h, seed) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      let c = "c";
      const n = vnoise(x, y, 7, seed);
      if (n > 0.74 || (n > 0.68 && hash(x, y, seed) > 0.5)) c = "t";
      p.s(x, y, c);
    }
}
function bookFill(p, x, y, w, h) {
  const cols = ["r", "B", "g", "G", "M", "o", "u", "R", "L"];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const shelf = j % 7;
      let c;
      if (shelf === 6) c = "b";
      else if (shelf === 0) c = "d";
      else {
        const k = Math.floor(hash(i, Math.floor(j / 7), 9) * cols.length);
        c = cols[k];
        const tall = hash(i, Math.floor(j / 7), 10) > 0.6 ? 1 : 2;
        if (shelf < tall) c = "d";
        else if (shelf === tall) c = SH[c] || c;
        if (hash(i, Math.floor(j / 7), 11) > 0.86) c = "d";
      }
      p.s(x + i, y + j, c);
    }
  // 유리 반사 한 줄
  for (let j = 0; j < h; j++) {
    const i = j + 2;
    if (i < w && j % 7 !== 6) p.m(x + i, y + j, LI);
  }
}
function roundWindow(p, cx, cy, r) {
  for (let y = -r - 1; y <= r + 1; y++)
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.sqrt((x + 0.5) * (x + 0.5) + (y + 0.5) * (y + 0.5));
      let c = null;
      if (d <= r + 1.2 && d > r) c = "d";
      else if (d <= r && d > r - 2) c = x + y < -1 ? "t" : "k";
      else if (d <= r - 2) {
        c = y < -2 ? "u" : "B";
        if (x + y > 4) c = "u";
      }
      if (c) p.s(cx + x, cy + y, c);
    }
  // 창살 (별 모양)
  for (let k = -r + 2; k < r - 1; k++) {
    p.s(cx + k, cy, "k");
    p.s(cx, cy + k, "k");
  }
  p.s(cx - 3, cy - 3, "C");
  p.s(cx - 2, cy - 3, "W");
  p.s(cx + 2, cy + 2, "C");
}
const ROUND_GLOW = [0, 1, 2].map((f) => {
  const p = new Pix(9, 9);
  const pts = [
    [[4, 4, "C"], [2, 2, "W"], [6, 6, "q"]],
    [[4, 4, "W"], [3, 5, "C"], [5, 3, "C"]],
    [[4, 4, "C"], [6, 2, "W"], [2, 6, "q"]],
  ][f];
  for (const [x, y, c] of pts) p.s(x, y, c);
  return p;
});
// 마법 등 (흔들리는 하늘빛 불)
const MAGIC_LAMP = [0, 1, 2].map((f) => {
  const p = P(`
    ..K..
    .KSK.
    KlqlK
    KqCqK
    KqWqK
    KlqlK
    .KKK.
    ..K..
  `);
  if (f === 1) {
    p.s(2, 3, "W");
    p.s(2, 4, "C");
  }
  if (f === 2) {
    p.s(2, 3, "C");
    p.s(2, 4, "C");
    p.s(1, 3, "C");
  }
  return p;
});
const MAGIC_HALO = (() => {
  const p = new Pix(15, 15);
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++) {
      const d = Math.hypot(x - 7, y - 7);
      if (d < 6.6) p.s(x, y, "q");
      if (d < 3.2) p.s(x, y, "q");
    }
  return p;
})();

// ═════════════ 작은 집 (짚 지붕) ═════════════
function buildCottage() {
  const p = new Pix(92, 86);
  const wx0 = 9;
  const wx1 = 82;
  const wy0 = 40;
  const base = 80;
  logWall(p, wx0, wy0, wx1 - wx0 + 1, base - wy0 - 3);
  stoneWall(p, wx0 - 2, base - 4, wx1 - wx0 + 5, 5, 61, [["e", "s", "S"], ["S", "e", "l"], ["e", "s", "S"]], "l", 4, 5, 10);
  for (let x = wx0 - 2; x <= wx1 + 2; x++) p.s(x, base, "K");
  // 굴뚝 (벽돌)
  for (let y = 0; y < 22; y++)
    for (let x = 62; x < 71; x++) {
      let c = ((y >> 1) + (x > 66 ? 1 : 0)) % 3 === 0 ? "b" : x === 62 ? "o" : x >= 69 ? "m" : "R";
      if (y < 2) c = y === 0 ? "d" : "k";
      p.s(x, y, c);
    }
  for (let y = 0; y < 22; y++) {
    p.s(61, y, "d");
    p.s(71, y, "d");
  }
  for (let x = 63; x < 70; x++) p.s(x, 0, "K");
  thatch(p, 1, 90, 8, 44, 62);
  shadeRows(p, wx0, wx1, 45, 3);
  // 창 (꽃상자 + 파란 덧문)
  windowAt(p, 20, 52, 16, 14, { box: 7, shutter: ["B", "u", "n"] });
  // 문
  const dx = 52;
  const dy = 54;
  const dw = 14;
  beam(p, dx - 3, dy - 3, dw + 6, 2);
  doorAt(p, dx, dy, dw, base - dy, { paint: ["b", "o", "t"], left: true });
  // 문 옆 화분 두 개
  p.put(POT, dx + dw + 3, base - 9);
  p.put(POT2, dx - 9, base - 8);
  return { pix: p, base, door: { x: dx + dw / 2, y: base }, wall: [wx0 - 2, wx1 + 2], chimney: { x: 66, y: 0 } };
}
const POT = P(`
  .LGL.
  LGFGL
  .GPG.
  dkkkd
  dtkbd
  dkkbd
  .dbd.
`);
const POT2 = P(`
  .y.y.
  yGyGy
  .FGF.
  dkkkd
  dtkbd
  .dbd.
`);
function logWall(p, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const yy = (y - y0) % 5;
      let c = yy === 0 ? "d" : yy === 1 ? "t" : yy === 4 ? "b" : "k";
      if (yy === 2 && hash(x >> 2, (y - y0) / 5, 63) > 0.8) c = "t";
      if (yy === 3 && hash(x >> 1, (y - y0) / 5, 64) > 0.85) c = "b";
      p.s(x, y, c);
    }
  // 통나무 끝 (모서리)
  for (let y = y0 + 1; y < y0 + h; y += 5)
    for (const x of [x0 - 2, x0 + w - 2]) {
      p.r(x, y, 4, 4, "d");
      p.r(x + 1, y, 2, 3, "t");
      p.s(x + 1, y, "c");
      p.s(x + 2, y + 1, "k");
    }
}
// 짚 지붕: 둥근 덩어리 줄을 겹겹이. 줄마다 아래 끝은 짚단 끝이 물결지고 그 밑에 그늘
function thatch(p, x0, x1, y0, y1, seed) {
  const n = y1 - y0;
  const q = new Pix(p.w, p.h);
  const rowH = 7;
  for (let y = y0; y <= y1 + 2; y++) {
    const k = (y - y0) / n;
    const inset = Math.round(Math.pow(Math.max(0, 1 - k * 2.4), 2) * 15 + (1 - k) * 5);
    const a = x0 + inset;
    const b = x1 - inset;
    for (let x = a; x <= b; x++) {
      const bottom = y1 + (Math.floor((x + 1) / 3) % 2 ? 1 : 0) + (hash(x >> 1, 7, seed) > 0.75 ? 1 : 0);
      if (y > bottom) continue;
      const u = (x - x0) / (x1 - x0);
      const ry = y - y0 - 2;
      const row = Math.floor(ry / rowH);
      const yy = ry - row * rowH;
      // 짚단 끝 물결: 다발 폭 4, 가운데가 한 칸 더 내려온다
      const bx = (x + row * 2) % 4;
      const tip = bx === 1 || bx === 2 ? rowH - 1 : rowH - 2;
      const light = 0.55 - u * 0.75 - k * 0.25 + (hash(x, row, seed + 3) - 0.5) * 0.2; // 왼쪽 위가 밝다
      let c;
      const st = hash(x, row, seed);
      if (ry < 0) c = y === y0 ? "k" : "t";
      else if (yy > tip) c = "b";
      else if (yy === 0) c = light > -0.1 ? "k" : "b";
      else if (yy === tip) c = light > 0.05 ? "c" : light > -0.3 ? "t" : "k";
      else if (light > 0.2) c = st > 0.85 ? "k" : st < 0.14 && yy < 3 ? "c" : "t";
      else if (light > -0.25) c = st > 0.78 ? "k" : "t";
      else c = st > 0.72 ? "t" : yy === tip - 1 ? "b" : "k";
      if (y >= bottom) c = "b";
      else if (y === bottom - 1 && c !== "b") c = light > 0 ? "t" : "k";
      q.s(x, y, c);
    }
  }
  q.outline("d");
  p.put(q, 0, 0);
}

// ═════════════ 소품 ═════════════
const PROPS = {
  anvil: P(`
    .......KKKKKKK..
    .KKKKKKssssssK..
    KseeeeeeeeeeeSK.
    .KKSeeeeeeeSSK..
    ...KKKSeeSKK....
    .....KSeeSK.....
    ....KlSeeSlK....
    ..dKKKKKKKKKKd..
    ..dttcctttttkd..
    ..dkttttttttbd..
    ..dbkkbkkkbkbd..
    ..dbbkbbbkbbbd..
    ..dbkbbkbbkbbd..
    ...ddddddddddd..
  `),
  swords: P(`
    ...s......e....
    ..KsK....KeK...
    ..KsK....KeK...s.
    ..KsK....KeK..KsK
    ..KsK....KeK..KsK
    ..KsK....KeK..KsK
    ..KsK...KgggK.KsK
    KKgggKK..KbK.KgggK
    ...KbK...KbK..KbK
    ...KgK.ddddddKgK.
    .dddddddttttttdd.
    dbkttttttttttkbd.
    dSeeeeeeeeeeeeSd.
    dbkttttttttttkbd.
    dbktttttttttkkbd.
    dbkttttttttkkbbd.
    dSeeeeeeeeeeeeSd.
    dbbkkkkkkkkkkbbd.
    .dddddddddddddd..
  `),
  barrel: P(`
    .dddddddd.
    dkttttttkd
    dbkkkkkkbd
    dSeeeeeeSd
    dtkkkkkbbd
    dtkkkkkkbd
    dtkkkkkkbd
    dSeeeeeeSd
    dtkkkkkbbd
    .dddddddd.
  `),
  crate: P(`
    dddddddddddddd
    dccttttttttttd
    dtkkkkkkkkkkbd
    dddddddddddddd
    dtkbkkkkkkbkbd
    dtkkbkkkkbkkbd
    dtkkkbkkbkkkbd
    dtkkkkbbkkkkbd
    dtkkkbkkbkkkbd
    dtkkbkkkkbkkbd
    dtkbkkkkkkbkbd
    dbbbbbbbbbbbbd
    dddddddddddddd
  `),
  sack: P(`
    ...d.d....
    ..dtdtd...
    ...dbd....
    ..dctkd...
    .dcctttd..
    dccttttkd.
    dcttttttkd
    dcttttttkd
    dttttttkbd
    dkttttkkbd
    .dkkkkkbd.
    ..ddddddd.
  `),
  apples: P(`
    ..rr.rP.r..
    .rPrmrrmrr.
    dddddddddddd
    dtkkkkkkkkbd
    dbkbkbkbkbbd
    .dkkkkkkkbd.
    ..dddddddd..
  `),
  logpile: null,
  bucket: P(`
    .dddd.
    deSSed
    dnuuBd
    dSeeSd
    .lSSl.
    .llll.
  `),
  stump: P(`
    ..dddddd..
    .dtccttkd.
    dtcttkttkd
    dktttttkbd
    dbktkkkbbd
    dbbkbbkbbd
    dbkbbkbbbd
    ddbdddbddd
  `),
  log: P(`
    .ddddddddddddddddd...
    dbbkbbkbbbkbbkbbbdddd
    dkkbkkkkbkkkbkkkdtcd.
    dbkkkbkkkbkkkbkkdckd.
    dbbbbbbbbbbbbbbbdtkd.
    .dddddddddddddddddd..
  `),
  rock: P(`
    ..KKKK...
    .KsseeK..
    KseeeeSK.
    KeeeeSSlK
    .KSSSllK.
    ..KKKKK..
  `),
  rockS: P(`
    .KKK.
    KseSK
    KeSlK
    .KKK.
  `),
  lamp: P(`
    ...KK...
    ..KseK..
    .KSeeSK.
    KlSSSSlK
    KKKKKKKK
    .KyygOK.
    .KyWyOK.
    .KgyygK.
    .KOggOK.
    KKKKKKKK
    .KlSSlK.
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    ..KeSK..
    .KleSSK.
    .KeSSlK.
    KlSeeSlK
    KKKKKKKK
  `),
  bench: P(`
    .KKKK..............KKKK.
    .KeSKddddddddddddddKeSK.
    .KeSKcttttttttttttkKeSK.
    .KeSKkkkkkkkkkkkkkbKeSK.
    .KeSKddddddddddddddKeSK.
    .KeSK..............KeSK.
    .KeSKddddddddddddddKeSK.
    .KeSKcttttttttttttkKeSK.
    .KeSKkkkkkkkkkkkkkbKeSK.
    .KeSKddddddddddddddKeSK.
    dddddddddddddddddddddddd
    dcctttttttttttttttttttkd
    dttttttttttttttttttttkkd
    dkkkkkkkkkkkkkkkkkkkkkbd
    .dddddddddddddddddddddd.
    .KeSK..............KeSK.
    .KSlK..............KSlK.
    .KKKK..............KKKK.
  `),
  sign: P(`
    .dddddddddddd.
    dccttttttttkkd
    dtkkkkkkkkkkbd
    dtk........kbd
    dtk........kbd
    dtk........kbd
    dtkkkkkkkkkkbd
    dbbbbbbbbbbbbd
    .dddddtbdddd..
    ......dkbd....
    ......dkbd....
    ......dkbd....
    ......dkbd....
    .....ddkbdd...
  `),
  scarecrow: P(`
    ......ddddd.....
    .....dgggggd....
    ...ddggyyggdd...
    ..dggggggggggd..
    ...dddtcctddd...
    .....dcccctd....
    .....dcKcKtd....
    .....dcccctd....
    ..t...dtttd...t.
    .tdddddrrrdddddt
    .dcrrrrrPrrrrmct
    ..ddddrrrrrmdd..
    ......drPrmd....
    ......dBBBud....
    ......dBuBud....
    ......dBudud....
    .......dbkd.....
    .......dbkd.....
    .......dbkd.....
    .......dbkd.....
    ......ddbkdd....
  `),
  well: null,
  notice: null,
};
PROPS.logpile = (() => {
  const p = new Pix(22, 15);
  const ends = [
    [3, 11],
    [8, 11],
    [13, 11],
    [18, 11],
    [5, 7],
    [10, 7],
    [15, 7],
    [8, 3],
    [13, 3],
  ];
  for (const [x, y] of ends) {
    p.oval(x, y, 2, 2, "d");
    p.s(x - 1, y - 1, "c");
    p.s(x, y - 1, "t");
    p.s(x + 1, y - 1, "t");
    p.s(x - 1, y, "t");
    p.s(x, y, "k");
    p.s(x + 1, y, "t");
    p.s(x - 1, y + 1, "t");
    p.s(x, y + 1, "t");
    p.s(x + 1, y + 1, "k");
  }
  return p.outline("d");
})();
// 우물 (돌 테 + 나무 지붕 + 두레박)
PROPS.well = (() => {
  const p = new Pix(28, 34);
  const cx = 14;
  // 돌 테 (앞벽)
  for (let x = 3; x <= 24; x++)
    for (let y = 22; y <= 31; y++) {
      const u = (x - 3) / 21;
      const row = y < 26 ? 0 : y < 29 ? 1 : 2;
      const off = row % 2 ? 3 : 0;
      let c = u < 0.25 ? "s" : u > 0.75 ? "S" : "e";
      if ((x + off) % 6 === 0 || y === 25 || y === 28) c = "l";
      if (y === 31) c = "K";
      p.s(x, y, c);
    }
  p.oval(cx, 21, 11, 3, "K");
  p.oval(cx, 21, 10, 2, "s");
  p.oval(cx, 21, 8, 1, "n");
  p.s(cx - 3, 21, "u");
  p.s(cx - 2, 21, "u");
  // 기둥
  for (let y = 7; y < 22; y++) {
    p.s(4, y, "d");
    p.s(5, y, "k");
    p.s(6, y, "b");
    p.s(7, y, "d");
    p.s(21, y, "d");
    p.s(22, y, "k");
    p.s(23, y, "b");
    p.s(24, y, "d");
  }
  // 도르래 막대 + 줄 + 두레박
  for (let x = 7; x <= 21; x++) {
    p.s(x, 10, "d");
    p.s(x, 11, "k");
    p.s(x, 12, "d");
  }
  for (let y = 13; y < 17; y++) p.s(cx, y, "c");
  p.put(
    P(`
    dddd
    dSed
    dkbd
    .dd.
  `),
    cx - 2,
    16,
  );
  // 작은 지붕
  gable(p, cx, 0, 8, 13, 3, RED, 71, (x, y) => p.s(x, y, "b"));
  return p;
})();
// 게시판 (종이 몇 장)
PROPS.notice = (() => {
  const p = new Pix(26, 30);
  for (let y = 6; y < 29; y++)
    for (const x of [3, 21]) {
      p.s(x, y, "d");
      p.s(x + 1, y, "k");
      p.s(x + 2, y, "b");
      p.s(x + 3, y, "d");
    }
  for (let y = 7; y < 21; y++)
    for (let x = 2; x < 24; x++) {
      let c = y === 7 ? "d" : y === 20 ? "d" : x === 2 || x === 23 ? "d" : y === 8 ? "t" : (y - 8) % 4 === 3 ? "b" : "k";
      p.s(x, y, c);
    }
  const papers = [
    [4, 9, 6, 7, "c"],
    [11, 10, 5, 6, "s"],
    [17, 9, 5, 8, "c"],
  ];
  for (const [x, y, w, h, c] of papers) {
    p.r(x, y, w, h, c);
    for (let j = y + 2; j < y + h - 1; j += 2) for (let i = x + 1; i < x + w - 1; i++) if (hash(i, j, 3) > 0.3) p.s(i, j, "S");
    p.s(x + (w >> 1), y, "r");
    for (let i = x; i < x + w; i++) p.m(i, y + h, SH);
  }
  gable(p, 13, 0, 7, 13, 2, RED, 72, (x, y) => p.s(x, y, "b"));
  return p;
})();
// 화단 상자 (광장)
function planter(seed, w = 18) {
  const p = new Pix(w, 14);
  for (let y = 7; y < 14; y++)
    for (let x = 0; x < w; x++) {
      let c = y === 7 ? "s" : y === 13 ? "K" : x === 0 || x === w - 1 ? "K" : y === 8 ? "e" : (x + (y > 10 ? 3 : 0)) % 6 === 0 ? "l" : x > w - 4 ? "S" : "e";
      if (y === 10) c = x === 0 || x === w - 1 ? "K" : "l";
      p.s(x, y, c);
    }
  for (let x = 1; x < w - 1; x++) p.s(x, 7, "b");
  // 꽃과 잎
  for (let x = 1; x < w - 1; x++) {
    const h = 2 + Math.floor(hash(x, 1, seed) * 3);
    for (let j = 1; j <= h; j++) p.s(x, 7 - j, hash(x, j, seed) > 0.55 ? "G" : j === h ? "L" : "F");
  }
  const cols = [["P", "M"], ["y", "g"], ["r", "m"], ["c", "t"]];
  for (let x = 2; x < w - 2; x += 3) {
    const [a, b] = cols[Math.floor(hash(x, 4, seed) * 4)];
    const fy = 2 + Math.floor(hash(x, 5, seed) * 2);
    p.s(x, fy, a);
    p.s(x + 1, fy, a);
    p.s(x, fy - 1, a);
    p.s(x + 1, fy + 1, b);
    p.s(x - 1, fy, LI[a] ? a : a);
  }
  p.outline("d");
  return p;
}
// 울타리: 가로 한 칸(16픽셀), 세로 한 칸
const FENCE_H = (() => {
  const p = new Pix(16, 13);
  for (const ry of [3, 7])
    for (let x = 0; x < 16; x++) {
      p.s(x, ry, "t");
      p.s(x, ry + 1, "k");
      p.s(x, ry + 2, "d");
    }
  for (const px of [1, 9]) {
    for (let y = 0; y < 13; y++) {
      p.s(px, y, y === 0 ? "d" : "t");
      p.s(px + 1, y, y === 0 ? "d" : "k");
      p.s(px + 2, y, y === 0 ? "d" : "b");
    }
    p.s(px + 1, 0, "c");
  }
  return p.outline("d");
})();
const FENCE_V = (() => {
  const p = new Pix(5, 26);
  for (let y = 5; y < 20; y++) {
    p.s(1, y, "t");
    p.s(2, y, "k");
    p.s(3, y, "b");
  }
  for (let y = 0; y < 13; y++) {
    p.s(1, y, y === 0 ? "c" : "t");
    p.s(2, y, y === 0 ? "t" : "k");
    p.s(3, y, "b");
  }
  return p.outline("d");
})();
const GATE_FENCE = (() => {
  const p = new Pix(18, 14);
  for (let x = 0; x < 18; x++) {
    p.s(x, 3, "t");
    p.s(x, 4, "k");
    p.s(x, 9, "t");
    p.s(x, 10, "k");
  }
  for (let k = 0; k < 6; k++) {
    p.s(3 + k * 2, 9 - k, "t");
    p.s(4 + k * 2, 9 - k, "k");
  }
  for (const px of [0, 15]) for (let y = 0; y < 14; y++) {
    p.s(px, y, "t");
    p.s(px + 1, y, "k");
    p.s(px + 2, y, "b");
  }
  return p.outline("d");
})();
// 닭장 (판자 + 작은 빨간 지붕 + 문 구멍 + 비탈 판)
const COOP = (() => {
  const p = new Pix(30, 30);
  planks(p, 4, 12, 22, 14, 33);
  for (let y = 12; y < 27; y++) {
    p.s(3, y, "d");
    p.s(26, y, "d");
  }
  for (let x = 3; x <= 26; x++) p.s(x, 26, "d");
  shadeRows(p, 4, 25, 13, 2);
  // 문 구멍
  p.r(11, 18, 7, 8, "d");
  p.r(12, 19, 5, 7, "K");
  p.s(12, 19, "d");
  p.s(16, 19, "d");
  // 비탈 판
  for (let i = 0; i < 6; i++) {
    p.s(13 + i, 26 + Math.floor(i / 2), "t");
    p.s(13 + i, 27 + Math.floor(i / 2), "k");
  }
  // 짚 몇 가닥
  p.s(6, 25, "g");
  p.s(7, 25, "y");
  p.s(22, 25, "g");
  gable(p, 15, 0, 14, 15, 3, RED, 34, (x, y) => p.s(x, y, y > 10 ? "b" : "k"));
  p.s(15, 7, "d");
  p.s(14, 8, "d");
  p.s(16, 8, "d");
  p.s(15, 8, "K");
  return p;
})();
// 텃밭 작물 (바닥에 찍는다)
const CROPS = {
  cabbage: P(`
    ..LGL..
    .LLGGL.
    LLGLGGF
    GLGGGFF
    .FGGFF.
    ..FFF..
  `),
  pumpkin: P(`
    ...F.L.
    ..dFLLd
    .dgOgOOd
    dgyOgOORd
    dOgOgOORd
    dOOOOORRd
    .dRRRRRd.
    ..ddddd..
  `),
  carrot: P(`
    .L.L.
    LGLGL
    .GFG.
    ..o..
  `),
  sprout: P(`
    L.L
    .G.
  `),
};
// 꽃·버섯·풀 (바닥 장식)
const DECO = {
  pink: P(`
    .P.
    PyP
    .PF
  `),
  white: P(`
    .c.
    cyc
    .cF
  `),
  yellow: P(`
    .y.
    ygy
    .yF
  `),
  blue: P(`
    .B.
    BcB
    .BF
  `),
  purple: P(`
    .M.
    MPM
    .MF
  `),
  tulip: P(`
    rPr
    rrm
    .F.
    LF.
  `),
  mush: P(`
    .dddd.
    drcrrd
    dmrrcm
    .dccd.
    ..dd..
  `),
  mush2: P(`
    .ddd..
    dkctd.
    dbkkd.
    .dcd.d
    ..d.dtd
    ....dc.
  `),
  tuft1: P(`
    .L..L.
    .L.LL.
    LF.FL.
    F..F..
  `),
  tuft2: P(`
    ..L..
    L.L.L
    FLFLF
  `),
  tuft3: P(`
    L..L
    FL.L
    .FLF
  `),
  dark1: P(`
    .F.F.
    F.FF.
    .F.F.
  `),
  dark2: P(`
    F..F
    .FF.
  `),
  clover: P(`
    .LL.
    LGGL
    .LF.
  `),
  pebble: P(`
    .se.
    seeS
    .SS.
  `),
  lily: P(`
    ..FFFF..
    .FGLLGF.
    FGLLGGGF
    FGLG.GGF
    .FGG.GF.
    ..FFFF..
  `),
  lilyF: P(`
    ..FFFF..
    .FGLPPF.
    FGLPMPGF
    FGLGPGGF
    .FGG.GF.
    ..FFFF..
  `),
  reed: P(`
    .b...
    .b.b.
    .bLb.
    LG.G.
    .GLG.
    .GFGL
    LFGF.
    FFGFF
  `),
};

// ═════════════ 움직이는 조각 ═════════════
const FLAME = [
  P(`
    ..y..
    .yy..
    .gWy.
    OgyyO
    .OgO.
    ..R..
  `),
  P(`
    ...y.
    ..yy.
    .gyWg
    .Ogyg
    .OgO.
    ..R..
  `),
  P(`
    .y...
    .yg..
    gWyg.
    Oyyg.
    .OgO.
    ..R..
  `),
];
const TORCH_GLOW = (() => {
  const p = new Pix(21, 21);
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      const d = Math.hypot(x - 10, y - 10);
      if (d < 3.6) p.s(x, y, "z");
      else if (d < 7.4) p.s(x, y, "Z");
    }
  return p;
})();
const PUFF = [
  P(`
    ws
    sw
  `),
  P(`
    .ws.
    wssw
    .ww.
  `),
  P(`
    .www.
    wwsww
    wwwww
    .www.
  `),
];
const PUFF_DARK = PUFF.map((p) => {
  const q = new Pix(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) if (p.d[i]) q.d[i] = IX[CH[p.d[i]] === "s" ? "e" : "s"];
  return q;
});
const BUTTER = [
  [
    P(`
      y.y
      .d.
    `),
    P(`
      .y.
      ydy
    `),
  ],
  [
    P(`
      P.P
      .d.
    `),
    P(`
      .P.
      PdP
    `),
  ],
  [
    P(`
      c.c
      .d.
    `),
    P(`
      .c.
      cdc
    `),
  ],
];
const LEAF = [
  P(`
    gO
    .O
  `),
  P(`
    Lg
    G.
  `),
];
// 닭 (걷기 두 장, 쪼기 한 장) — 왼쪽을 보는 그림
const CHICK = [
  P(`
    .rr.....
    dccd....
    Kcgd.dd.
    .dccdccd
    .dcccctd
    ..dttkd.
    ...O.O..
  `),
  P(`
    .rr.....
    dccd....
    Kcgd.dd.
    .dccdccd
    .dcccctd
    ..dttkd.
    ..O...O.
  `),
  P(`
    ........
    .....dd.
    .rr.dccd
    dccdcccd
    Kcgccctd
    .ddttkd.
    ...O.O..
  `),
];
// 고양이 (주황 얼룩고양이가 앉아서 꼬리 흔들기)
const CAT = [
  P(`
    .d...d....
    dod.dod...
    doooooodd.
    doKooKod.d
    .doPcod..d
    ..doood.do
    .dooccod.d
    .dOocccodo
    .dooccood.
    ..dddddd..
  `),
  P(`
    .d...d....
    dod.dod...
    doooooodd.
    doKooKod..
    .doPcod...
    ..doood...
    .dooccod..
    .dOocccod.
    .dooccooddd
    ..ddddddood
  `),
];

// ═════════════ 분수 ═════════════
const FTN = { w: 62, h: 52, cx: 31, cy: 33, rx: 28, ry: 10, wall: 6 };
function buildFountain() {
  const { w, h, cx, cy, rx, ry, wall } = FTN;
  const p = new Pix(w, h);
  const yb = (x, r, k) => cy + k * r * Math.sqrt(Math.max(0, 1 - ((x - cx) / (rx + 0.5)) ** 2));
  // 앞벽 (돌 블록)
  for (let x = cx - rx; x <= cx + rx; x++) {
    const top = Math.round(yb(x, ry, 1));
    const u = (x - cx) / rx;
    for (let y = top; y <= top + wall; y++) {
      let c = u < -0.55 ? "s" : u < 0.35 ? "e" : u < 0.75 ? "S" : "l";
      if (y === top + 3) c = u < 0.3 ? "S" : "l";
      if ((Math.round(x * 1.0 + (y > top + 3 ? 4 : 0)) % 8 === 0) && y !== top) c = "l";
      if (y === top + wall) c = "K";
      p.s(x, y, c);
    }
  }
  // 위 테두리
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++)
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      const e = ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2;
      const i = ((x - cx) / (rx - 3.5)) ** 2 + ((y - cy) / (ry - 2.5)) ** 2;
      if (e > 1) continue;
      let c;
      if (i <= 1) {
        // 물
        const back = ((x - cx) / (rx - 3.5)) ** 2 + ((y - cy + 2) / (ry - 2.5)) ** 2 > 1;
        c = back ? "u" : "B";
        if (y > cy + 3 && hash(x >> 2, y, 3) > 0.7) c = "B";
      } else {
        c = y < cy ? (x < cx + 6 ? "s" : "e") : x < cx - rx * 0.4 ? "s" : "e";
        const i2 = ((x - cx) / (rx - 2.5)) ** 2 + ((y - cy) / (ry - 1.5)) ** 2;
        if (i2 <= 1 && y >= cy - 1) c = "S";
        if (i2 <= 1 && y < cy - 1) c = "e";
        const e2 = ((x - cx) / (rx - 0.5)) ** 2 + ((y - cy) / (ry - 0.5)) ** 2;
        if (e2 > 1) c = "K";
      }
      p.s(x, y, c);
    }
  // 테두리 이음매
  for (const a of [0.6, 1.4, 2.2, 3.0, 3.9, 4.7, 5.5]) {
    const x = Math.round(cx + Math.cos(a) * (rx - 1.5));
    const y = Math.round(cy + Math.sin(a) * (ry - 1));
    p.s(x, y, "S");
  }
  // 가운데 기둥
  for (let y = cy - 17; y <= cy + 1; y++)
    for (let x = cx - 3; x <= cx + 3; x++) {
      const u = x - cx;
      let c = u <= -3 || u >= 3 ? "K" : u === -2 ? "s" : u === 2 ? "S" : "e";
      if (y === cy - 6 || y === cy - 12) c = u <= -3 || u >= 3 ? "K" : "S";
      p.s(x, y, c);
    }
  for (let x = cx - 4; x <= cx + 4; x++) p.s(x, cy + 1, x === cx - 4 || x === cx + 4 ? "K" : "S");
  // 위 그릇
  const by = cy - 18;
  for (let y = by - 3; y <= by + 4; y++)
    for (let x = cx - 11; x <= cx + 11; x++) {
      const e = ((x - cx) / 10.5) ** 2 + ((y - by) / 3.5) ** 2;
      const under = ((x - cx) / 9.5) ** 2 + ((y - by - 1.5) / 3) ** 2;
      if (e > 1 && !(under <= 1 && y > by)) continue;
      let c;
      if (y > by + 1 && under <= 1) c = x < cx - 2 ? "S" : "l";
      else {
        const i = ((x - cx) / 8) ** 2 + ((y - by) / 2) ** 2;
        c = i <= 1 ? (y < by ? "u" : "B") : x < cx ? "s" : "e";
        if (e > 0.78 && i > 1) c = y < by ? "s" : x < cx ? "e" : "S";
      }
      p.s(x, y, c);
    }
  // 꼭대기 장식
  p.put(
    P(`
    .KK.
    KseK
    KeSK
    .KK.
    KseK
  `),
    cx - 2,
    by - 8,
  );
  p.outline("K");
  return p;
}
// 분수 물: 물줄기와 물결 (세 장)
const FTN_FRAMES = [0, 1, 2].map((f) => {
  const { w, h, cx, cy, rx, ry } = FTN;
  const p = new Pix(w, h);
  const by = cy - 18;
  // 위 그릇에서 넘쳐 떨어지는 물
  for (const side of [-1, 1]) {
    const x0 = cx + side * 10;
    for (let y = by + 2; y < cy - 1; y++) {
      const k = (y - by + f * 2) % 6;
      const x = x0 + side * Math.round((y - by) * 0.15);
      p.s(x, y, k < 3 ? "C" : "B");
      if (k === 1) p.s(x + side, y, "w");
    }
    // 떨어지는 곳 물보라
    const sx = x0 + side * 2;
    const pts = [
      [[-1, 0], [1, -1], [0, -2]],
      [[0, -1], [2, 0], [-2, -1]],
      [[1, 0], [-1, -1], [1, -2]],
    ][f];
    for (const [dx, dy] of pts) p.s(sx + dx, cy - 1 + dy, "w");
    p.s(sx, cy, "C");
  }
  // 꼭대기 물줄기
  const jet = [
    [0, -1, "C"],
    [0, -2, "C"],
    [0, -3, "W"],
  ];
  for (const [dx, dy, c] of jet) p.s(cx + dx, by - 9 + dy - (f === 1 ? 1 : 0), c);
  p.s(cx - 1, by - 10 + (f % 2), "w");
  p.s(cx + 1, by - 11 + ((f + 1) % 2), "w");
  // 위 그릇 물결
  p.s(cx - 4 + f * 2, by, "C");
  p.s(cx + 3 - f, by + 1, "C");
  // 아래 물결 (동그란 물결이 퍼진다)
  const rip = [
    [-14, 3],
    [12, 4],
    [-6, 6],
    [18, 1],
    [-20, 0],
    [5, 5],
  ];
  rip.forEach(([dx, dy], i) => {
    const k = (f + i) % 3;
    const x = cx + dx;
    const y = cy + dy;
    if (k === 0) p.s(x, y, "C");
    else if (k === 1) {
      p.s(x - 1, y, "C");
      p.s(x + 1, y, "C");
    } else {
      p.s(x - 2, y, "B");
      p.s(x + 2, y, "B");
      p.s(x, y - 1, "C");
    }
  });
  return p;
});

// ═════════════ 지도 배치 ═════════════
function place(b, x, y) {
  return { ...b, x, y, mbase: y + b.base, mdoor: { x: Math.round(x + b.door.x), y: y + b.base } };
}
const SMITHY = place(buildSmithy(), 26, 86);
const SHOP = place(buildShop(), 488, 88);
const CARDS = place(buildCardHouse(), 38, 250);
const COTTAGE = place(buildCottage(), 352, 266);
const FOUNTAIN_PIX = buildFountain();
const FTN_AT = { x: 320 - FTN.cx, y: 208 - FTN.cy }; // 그림 왼쪽 위 (수반 가운데 = 320, 208)
const PLAZA = { x: 320, y: 214, rx: 86, ry: 56 };
const POND = { x: 228, y: 364, rx: 40, ry: 17 };
const DOCK = { x: 238, y: 343, w: 15, h: 19 }; // 연못에 걸친 작은 나무 선착장 (올라설 수 있다)
const GARDEN = { x0: 460, y0: 284, x1: 604, y1: 398 };
const GATE = { x: 320, base: 90, ay: 57, rIn: 16, rOut: 27 };

// ───── 바닥 종류 / 막힘 ─────
const T = new Uint8Array(MW * MH); // 0 풀 1 흙 2 돌바닥 3 연석 4 물 5 물가 6 밭 7 절벽
const BLK = new Uint8Array(MW * MH);
const SHD = new Uint8Array(MW * MH); // 그림자 (한 번만 어둡게)
const idx = (x, y) => x + y * MW;
function blockRect(x, y, w, h) {
  for (let j = Math.max(0, Math.floor(y)); j < Math.min(MH, Math.ceil(y + h)); j++) for (let i = Math.max(0, Math.floor(x)); i < Math.min(MW, Math.ceil(x + w)); i++) BLK[idx(i, j)] = 1;
}
function blockOval(cx, cy, rx, ry) {
  for (let j = Math.floor(cy - ry); j <= cy + ry; j++)
    for (let i = Math.floor(cx - rx); i <= cx + rx; i++) if (i >= 0 && j >= 0 && i < MW && j < MH && ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 <= 1) BLK[idx(i, j)] = 1;
}
function shadowOval(cx, cy, rx, ry) {
  for (let j = Math.floor(cy - ry); j <= cy + ry; j++)
    for (let i = Math.floor(cx - rx); i <= cx + rx; i++) if (i >= 0 && j >= 0 && i < MW && j < MH && ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 <= 1) SHD[idx(i, j)] = 1;
}
function shadowRect(x, y, w, h) {
  for (let j = Math.max(0, y); j < Math.min(MH, y + h); j++) for (let i = Math.max(0, x); i < Math.min(MW, x + w); i++) SHD[idx(i, j)] = 1;
}

// 절벽 위·아래 선
const CL_TOP = new Int16Array(MW);
const CL_BOT = new Int16Array(MW);
const CL_MID = new Int16Array(MW);
for (let x = 0; x < MW; x++) {
  const near = clamp((Math.abs(x - GATE.x) - 36) / 24, 0, 1);
  CL_TOP[x] = Math.round(17 + near * 7 + (vnoise(x, 3, 26, 31) - 0.5) * 10 + (vnoise(x, 9, 7, 35) - 0.5) * 3);
  CL_BOT[x] = Math.round(GATE.base + near * ((vnoise(x, 7, 18, 32) - 0.5) * 7 - 2));
  CL_MID[x] = Math.round(CL_TOP[x] + (CL_BOT[x] - CL_TOP[x]) * 0.5 + (vnoise(x, 13, 30, 36) - 0.5) * 12);
}

// ───── 흙길 ─────
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const u = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(ax + u * dx - px, ay + u * dy - py);
}
// 부드러운 곡선 (캣멀롬)
function curve(pts, n = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const PATHS = [
  { pts: [[320, 86], [319, 128], [321, 172]], w: 17 },
  { pts: [[246, 218], [214, 214], [184, 202], [150, 200], [118, 198], [SMITHY.mdoor.x, SMITHY.mdoor.y + 6]], w: 13 },
  { pts: [[394, 216], [424, 214], [458, 204], [494, 200], [526, 197], [SHOP.mdoor.x, SHOP.mdoor.y + 6]], w: 13 },
  { pts: [[270, 258], [244, 280], [222, 304], [190, 324], [150, 340], [118, 356], [CARDS.mdoor.x, CARDS.mdoor.y + 6]], w: 12 },
  { pts: [[320, 262], [324, 306], [320, 350], [314, 392], [320, 452]], w: 17 },
  { pts: [[326, 334], [352, 346], [384, 352], [COTTAGE.mdoor.x, COTTAGE.mdoor.y + 6]], w: 10 },
  { pts: [[462, 204], [474, 226], [492, 244], [504, 264], [508, GARDEN.y0 + 2]], w: 9 },
];
function paintPath(path, seed) {
  const pts = curve(path.pts);
  const hw = path.w;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 4));
    const x1 = Math.min(MW - 1, Math.ceil(Math.max(ax, bx) + hw + 4));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 4));
    const y1 = Math.min(MH - 1, Math.ceil(Math.max(ay, by) + hw + 4));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = segDist(x + 0.5, y + 0.5, ax, ay, bx, by);
        const n = (vnoise(x, y, 9, seed) - 0.5) * 5 + (vnoise(x, y, 4, seed + 1) - 0.5) * 1.6;
        if (d < hw + n) T[idx(x, y)] = 1;
      }
  }
}
PATHS.forEach((p, i) => paintPath(p, 200 + i));
// 문 앞 흙 마당
for (const b of [SMITHY, SHOP, CARDS, COTTAGE])
  for (let y = b.mbase - 2; y < b.mbase + 14; y++)
    for (let x = b.mdoor.x - 18; x <= b.mdoor.x + 18; x++) {
      const e = ((x - b.mdoor.x) / 16) ** 2 + ((y - b.mbase - 4) / 9) ** 2 + (vnoise(x, y, 5, 9) - 0.5) * 0.5;
      if (e < 1 && x >= 0 && x < MW) T[idx(x, y)] = 1;
    }

// ───── 광장 (모서리가 둥근 돌바닥) ─────
const plazaF = (x, y, rx, ry) => Math.abs((x - PLAZA.x) / rx) ** 2.6 + Math.abs((y - PLAZA.y) / ry) ** 2.6;
for (let y = PLAZA.y - PLAZA.ry - 1; y <= PLAZA.y + PLAZA.ry + 1; y++)
  for (let x = PLAZA.x - PLAZA.rx - 1; x <= PLAZA.x + PLAZA.rx + 1; x++) {
    if (plazaF(x + 0.5, y + 0.5, PLAZA.rx, PLAZA.ry) > 1) continue;
    T[idx(x, y)] = plazaF(x + 0.5, y + 0.5, PLAZA.rx - 4, PLAZA.ry - 3.5) > 1 ? 3 : 2;
  }
// ───── 연못 ─────
const pondR = (x, y) => {
  const a = Math.atan2((y - POND.y) / POND.ry, (x - POND.x) / POND.rx);
  return Math.hypot((x - POND.x) / POND.rx, (y - POND.y) / POND.ry) / (1 + Math.sin(a * 3 + 1) * 0.08 + Math.sin(a * 5 + 2) * 0.05);
};
for (let y = POND.y - POND.ry - 6; y <= POND.y + POND.ry + 6; y++)
  for (let x = POND.x - POND.rx - 6; x <= POND.x + POND.rx + 6; x++) {
    const r = pondR(x + 0.5, y + 0.5);
    if (r <= 1) T[idx(x, y)] = 4;
    else if (r <= 1.12) T[idx(x, y)] = 5;
  }
// ───── 텃밭 ─────
const BEDS = [
  [466, 292, 66, 26],
  [466, 326, 66, 26],
  [540, 292, 58, 60],
];
for (const [x, y, w, h] of BEDS) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) T[idx(i, j)] = 6;
// ───── 절벽 ─────
for (let x = 0; x < MW; x++) for (let y = CL_TOP[x]; y <= CL_BOT[x]; y++) T[idx(x, y)] = 7;

// ═════════════ 물건 목록 (깊이 정렬) ═════════════
const OBJS = [];
let NOW = 0;
// pix를 (mx - ax, my - ay)에 그린다. 정렬 y = my
function addObj(pix, mx, my, ax, ay, sortY = my) {
  const x = Math.round(mx - ax);
  const y = Math.round(my - ay);
  const o = { y: sortY, draw: (ctx, camX, camY) => drawPix(ctx, pix, x - Math.round(camX), y - Math.round(camY)) };
  OBJS.push(o);
  return o;
}
function addTree(t, mx, my, flip = false) {
  const x = Math.round(mx - t.ax);
  const y = Math.round(my - t.ay);
  const pix = flip ? flipPix(t.pix) : t.pix;
  OBJS.push({ y: my, draw: (ctx, camX, camY) => drawPix(ctx, pix, x - Math.round(camX), y - Math.round(camY)) });
  blockOval(mx, my - 1, Math.max(3, t.r * 0.28), 2.5);
  shadowOval(mx + 4, my, t.r * 0.95, Math.max(3, t.r * 0.32));
}
const flipCache = new Map();
function flipPix(p) {
  if (flipCache.has(p)) return flipCache.get(p);
  const q = new Pix(p.w, p.h).put(p, 0, 0, true);
  flipCache.set(p, q);
  return q;
}
// 건물: 그림 전체 + 막힘 + 그림자
function addBuilding(b, extraDraw) {
  const x = b.x;
  const y = b.y;
  OBJS.push({
    y: b.mbase,
    draw: (ctx, camX, camY) => {
      const cx = Math.round(camX);
      const cy = Math.round(camY);
      drawPix(ctx, b.pix, x - cx, y - cy);
      if (extraDraw) extraDraw(ctx, x - cx, y - cy);
    },
  });
  const [w0, w1] = b.wall;
  blockRect(x + w0, y + 8, w1 - w0 + 1, b.base - 8 + 1);
  // 오른쪽 아래로 드리운 그림자 (오른쪽 벽 옆 세모 + 앞쪽 얇은 띠)
  for (let j = 0; j <= 20; j++) shadowRect(x + w1 + 1, y + b.base - 18 + j, Math.min(7, 1 + Math.floor(j / 2)), 1);
  shadowRect(x + w0 + 4, y + b.base + 1, w1 - w0 + 4, 2);
}
addBuilding(SMITHY, (ctx, x, y) => drawPix(ctx, FORGE_FRAMES[Math.floor(NOW * 7) % 3], x + FORGE_WIN.x, y + FORGE_WIN.y));
addBuilding(SHOP);
addBuilding(CARDS, (ctx, x, y) => {
  const f = Math.floor(NOW * 3) % 3;
  drawPix(ctx, ROUND_GLOW[f], x + ROUND_WIN.x - 4, y + ROUND_WIN.y - 4);
  const l = CARDS.lamp;
  const sway = Math.floor(NOW * 1.3) % 4 === 3 ? 1 : 0;
  drawPix(ctx, MAGIC_HALO, x + l.x - 7 + sway, y + l.y - 3, 0.75 + Math.sin(NOW * 3) * 0.2);
  drawPix(ctx, MAGIC_LAMP[Math.floor(NOW * 5) % 3], x + l.x - 2 + sway, y + l.y);
});
addBuilding(COTTAGE);

// 분수
OBJS.push({
  y: FTN_AT.y + FTN.cy + FTN.ry + FTN.wall,
  draw: (ctx, camX, camY) => {
    const x = FTN_AT.x - Math.round(camX);
    const y = FTN_AT.y - Math.round(camY);
    drawPix(ctx, FOUNTAIN_PIX, x, y);
    drawPix(ctx, FTN_FRAMES[Math.floor(NOW * 6) % 3], x, y);
  },
});
blockOval(320, 210, FTN.rx + 2, FTN.ry + 4);
shadowOval(326, 216, FTN.rx + 2, FTN.ry + 5);

// 소품 하나 놓기 (발 가운데 아래 기준). bw, bh = 막힘 크기
function prop(pix, mx, my, bw = pix.w - 2, bh = 4, shadow = true) {
  addObj(pix, mx, my, Math.floor(pix.w / 2), pix.h - 1);
  if (bw > 0) blockRect(mx - bw / 2, my - bh + 1, bw, bh);
  if (shadow) shadowOval(mx + 3, my, pix.w * 0.5, 2.5);
}
// 대장간 앞
prop(PROPS.anvil, SMITHY.x + 30, SMITHY.mbase + 16, 12, 5);
prop(PROPS.swords, SMITHY.mdoor.x + 20, SMITHY.mbase + 5, 14, 5);
prop(PROPS.logpile, SMITHY.x + 4, SMITHY.mbase + 2, 20, 6);
prop(PROPS.bucket, SMITHY.x + 44, SMITHY.mbase + 14, 6, 3);
prop(PROPS.stump, SMITHY.x - 2, SMITHY.mbase + 16, 9, 4);
// 상점 앞
prop(PROPS.crate, SHOP.x + 104, SHOP.mbase + 4, 14, 5);
prop(PROPS.barrel, SHOP.x + 90, SHOP.mbase + 5, 10, 4);
prop(PROPS.sack, SHOP.x + 18, SHOP.mbase + 5, 9, 4);
prop(PROPS.sack, SHOP.x + 27, SHOP.mbase + 4, 9, 4);
prop(PROPS.apples, SHOP.x + 40, SHOP.mbase + 5, 12, 4);
// 카드 보관소 앞
prop(PROPS.barrel, CARDS.x + 102, CARDS.mbase + 2, 10, 4);
prop(planter(5, 16), CARDS.x + 20, CARDS.mbase + 6, 16, 5);
// 광장
prop(PROPS.lamp, 252, 186, 6, 3);
prop(PROPS.lamp, 389, 184, 6, 3);
prop(PROPS.lamp, 286, 270, 6, 3);
prop(PROPS.bench, 286, 176, 22, 5);
prop(PROPS.bench, 370, 262, 22, 5);
prop(planter(7), 244, 240, 18, 6);
prop(planter(9), 396, 236, 18, 6);
prop(planter(13), 352, 172, 18, 6);
// 게시판, 우물, 경고 표지판
prop(PROPS.notice, 362, 124, 22, 4);
prop(PROPS.well, 434, 258, 24, 8);
const warn = new Pix(PROPS.sign.w, PROPS.sign.h).put(PROPS.sign, 0, 0).put(ICONS.skull, 4, 2);
prop(warn, 284, 112, 6, 4);
// 집 근처
prop(PROPS.log, 160, 286, 20, 5);
prop(PROPS.stump, 428, 330, 9, 4);
prop(PROPS.barrel, COTTAGE.x + 6, COTTAGE.mbase + 3, 10, 4);
// 바위
prop(PROPS.rock, 178, 350, 8, 4);
prop(PROPS.rockS, 280, 404, 4, 3);
prop(PROPS.rock, 590, 248, 8, 4);
prop(PROPS.rockS, 232, 130, 4, 3);

// 텃밭 울타리 (위·아래 가로, 양옆 세로)
const G = GARDEN;
for (let x = G.x0; x < G.x1; x += 16) {
  const gate = x === 500;
  addObj(gate ? GATE_FENCE : FENCE_H, x, G.y0, 0, 12, G.y0);
  addObj(FENCE_H, x, G.y1, 0, 12, G.y1);
}
for (let y = G.y0 + 2; y < G.y1; y += 12) {
  addObj(FENCE_V, G.x0 - 1, y + 12, 0, 25, y + 12);
  addObj(FENCE_V, G.x1 - 3, y + 12, 0, 25, y + 12);
}
blockRect(G.x0 - 2, G.y0 - 4, G.x1 - G.x0 + 4, G.y1 - G.y0 + 6);
shadowRect(G.x0 + 2, G.y1 + 1, G.x1 - G.x0, 2);
// 허수아비, 닭장
prop(PROPS.scarecrow, 570, 336, 0, 0);
prop(COOP, 586, 392, 0, 0);

// ───── 나무 ─────
// 마을 안 나무
addTree(TREES.oakL, 206, 140);
addTree(TREES.pine, 170, 112);
addTree(TREES.oakM, 446, 132, true);
addTree(TREES.pine2, 468, 112);
addTree(TREES.oakS, 186, 408);
addTree(TREES.oakM2, 588, 262);
addTree(TREES.oakM2, 140, 250, true);
addTree(TREES.bush2, 94, 238);
addTree(TREES.oakS, 262, 340, true);
addTree(TREES.bush, 288, 384);
addTree(TREES.bushF, 404, 300);
addTree(TREES.bush2, 236, 108);
addTree(TREES.bush, 532, 238, true);
addTree(TREES.bush2, 168, 382);
addTree(TREES.bushF, 50, 216);
// 둘레 숲 (서·동·남): 크기·종류를 섞어 엇갈리게
{
  const kinds = [TREES.oakL, TREES.pine, TREES.oakM, TREES.oakL2, TREES.pine2, TREES.oakM2, TREES.oakL, TREES.pineS];
  let k = 0;
  const pick = () => kinds[Math.floor(hash(k++, 9, 5) * kinds.length)];
  for (let y = 104; y < 440; y += 17 + Math.floor(hash(y, 0, 5) * 10)) {
    addTree(pick(), 4 + Math.round(hash(y, 1, 5) * 12), y, hash(y, 7, 5) > 0.5);
    if (hash(y, 8, 5) > 0.55) addTree(TREES.bush2, 24 + Math.round(hash(y, 10, 5) * 6), y + 6, hash(y, 11, 5) > 0.5);
  }
  for (let y = 100; y < 440; y += 16 + Math.floor(hash(y, 3, 6) * 11)) {
    addTree(pick(), MW - 4 - Math.round(hash(y, 2, 6) * 12), y, hash(y, 4, 6) > 0.5);
    if (hash(y, 5, 6) > 0.6) addTree(TREES.bush, MW - 24 - Math.round(hash(y, 6, 6) * 6), y + 5, hash(y, 7, 6) > 0.5);
  }
  for (let x = -4; x < MW + 8; x += 17 + Math.floor(hash(x, 3, 7) * 9)) if (x < 284 || x > 356) addTree(pick(), x, 445 + Math.round(hash(x, 4, 7) * 3), hash(x, 5, 7) > 0.5);
  for (let x = 8; x < MW; x += 24 + Math.floor(hash(x, 6, 8) * 16)) if (x < 278 || x > 362) addTree(pick(), x, 430 + Math.round(hash(x, 7, 8) * 6), hash(x, 8, 8) > 0.5);
  for (const [x, y, t] of [
    [40, 421, TREES.bush],
    [112, 423, TREES.oakS],
    [214, 424, TREES.bush2],
    [268, 426, TREES.bushF],
    [376, 424, TREES.bush],
    [420, 421, TREES.pineS],
    [470, 424, TREES.bush2],
    [520, 422, TREES.oakS],
    [590, 420, TREES.bushF],
  ])
    addTree(t, x, y, x % 3 === 0);
  // 길 양옆 나무
  addTree(TREES.oakM, 280, 446);
  addTree(TREES.oakM2, 362, 444, true);
}
// 둘레 막힘, 물
for (let i = 0; i < T.length; i++) if (T[i] === 4) BLK[i] = 1;
for (let y = DOCK.y; y < DOCK.y + DOCK.h - 1; y++) for (let x = DOCK.x + 1; x < DOCK.x + DOCK.w - 1; x++) BLK[idx(x, y)] = 0;
blockRect(0, 0, MW, 96);
blockRect(0, 0, 22, MH);
blockRect(MW - 22, 0, 22, MH);
for (let x = 0; x < MW; x++) if (x < 300 || x > 340) blockRect(x, 418, 1, MH - 418);
blockRect(0, MH - 2, MW, 2);

// 닭 세 마리 (텃밭 아래 풀밭)
const HEN_AREA = { x: 472, y: 364, w: 92, h: 26 };
function henAt(i, t) {
  const seg = 3.4 + i * 0.5;
  const tt = t + i * 2.3;
  const k = Math.floor(tt / seg);
  const f = tt / seg - k;
  const pt = (n) => ({ x: HEN_AREA.x + hash(i, n, 91) * HEN_AREA.w, y: HEN_AREA.y + hash(i, n, 92) * HEN_AREA.h });
  const a = pt(k);
  const b = pt(k + 1);
  const w = clamp(f / 0.4, 0, 1);
  const e = sm(w);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, dir: b.x < a.x ? 1 : -1, walk: w < 1, peck: w >= 1 && Math.floor(tt * 3) % 3 === 0 };
}
const HENS = [0, 1, 2].map((i) => {
  const o = {
    y: 0,
    draw: (ctx, camX, camY) => {
      const s = henAt(i, NOW);
      const fr = s.walk ? CHICK[Math.floor(NOW * 8) % 2] : s.peck ? CHICK[2] : CHICK[0];
      const pix = s.dir > 0 ? flipPix(fr) : fr;
      const x = Math.round(s.x - 4 - camX);
      const y = Math.round(s.y - 7 - camY);
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.28;
      ctx.fillStyle = PAL.K;
      ctx.fillRect(x + 2, y + 7, 5, 1);
      ctx.globalAlpha = a0;
      drawPix(ctx, pix, x, y);
    },
  };
  OBJS.push(o);
  return o;
});
// 고양이 (작은 집 문 옆 계단)
OBJS.push({
  y: COTTAGE.mbase + 3,
  draw: (ctx, camX, camY) => drawPix(ctx, CAT[Math.floor(NOW * 1.5) % 4 === 0 ? 1 : 0], COTTAGE.mdoor.x + 15 - Math.round(camX), COTTAGE.mbase - 7 - Math.round(camY)),
});
blockRect(COTTAGE.mdoor.x + 15, COTTAGE.mbase - 2, 9, 4);

// ═════════════ 바닥 굽기 ═════════════
let GROUND = null;
function bakeGround() {
  const g = new Pix(MW, MH);
  const t = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? 0 : T[idx(x, y)]);
  // 1) 바탕색
  {
    const cT = IX.t, cb = IX.b, cB = IX.B, cG = IX.G;
    for (let i = 0; i < T.length; i++) {
      const k = T[i];
      g.d[i] = k === 1 ? cT : k === 6 ? cb : k === 4 ? cB : cG;
    }
  }
  // 2) 풀: 성기게 놓은 풀포기 (밝은 곳/어두운 곳이 천천히 바뀐다)
  const tufts = [DECO.tuft1, DECO.tuft2, DECO.tuft3];
  const darks = [DECO.dark1, DECO.dark2];
  for (let gy = 0; gy < MH; gy += 9)
    for (let gx = 0; gx < MW; gx += 10) {
      const x = gx + Math.floor(hash(gx, gy, 1) * 8);
      const y = gy + Math.floor(hash(gx, gy, 2) * 7);
      const n = vnoise(x, y, 46, 3);
      const r = hash(x, y, 4);
      let s = null;
      if (n > 0.55 && r < (n - 0.4) * 1.1) s = tufts[Math.floor(hash(x, y, 5) * 3)];
      else if (n < 0.45 && r < (0.6 - n) * 0.9) s = darks[Math.floor(hash(x, y, 6) * 2)];
      else if (r > 0.94) s = DECO.clover;
      if (!s) continue;
      let ok = true;
      for (let j = -1; j <= s.h && ok; j++) for (let i = -1; i <= s.w && ok; i++) if (t(x + i, y + j) !== 0) ok = false;
      if (ok) g.put(s, x, y);
    }
  // 햇빛 드는 풀밭 몇 군데: 밝은 풀포기를 더 촘촘히
  for (let gy = 0; gy < MH; gy += 6)
    for (let gx = 0; gx < MW; gx += 7) {
      const x = gx + Math.floor(hash(gx, gy, 16) * 6);
      const y = gy + Math.floor(hash(gx, gy, 17) * 5);
      const n = vnoise(x, y, 54, 18);
      if (n < 0.6 || hash(x, y, 19) > (n - 0.56) * 2.6) continue;
      const s = hash(x, y, 20) > 0.5 ? DECO.tuft2 : DECO.tuft3;
      let ok = true;
      for (let j = -1; j <= s.h && ok; j++) for (let i = -1; i <= s.w && ok; i++) if (t(x + i, y + j) !== 0 || g.g(x + i, y + j) !== "G") ok = false;
      if (ok) g.put(s, x, y);
    }
  // 3) 흙길: 가장자리 그늘, 잔돌
  for (let y = 2; y < MH - 1; y++)
    for (let x = 2; x < MW - 1; x++) {
      const i = x + y * MW;
      const k = T[i];
      if (k === 0) {
        // 풀 가장자리: 흙길 바로 위 풀은 어둡게 (턱)
        if (T[i + MW] === 1 && g.d[i] === IX.G) g.d[i] = IX.F;
        continue;
      }
      if (k !== 1) continue;
      const u = T[i - MW];
      const up = u === 0 || u === 7;
      const edge = up || T[i - 1] === 0 || T[i + MW] === 0 || T[i + 1] === 0;
      if (edge) g.d[i] = IX.k;
      else if (T[i - 2 * MW] === 0 || T[i - 2] === 0) g.d[i] = hash(x, y, 7) > 0.35 ? IX.k : IX.t;
      // 풀 쪽 가장자리: 아래로 늘어진 풀잎
      if (up && hash(x, y, 8) > 0.6) g.d[i] = hash(x, y, 9) > 0.5 ? IX.G : IX.F;
    }
  // 잔돌·자국
  for (let gy = 0; gy < MH; gy += 7)
    for (let gx = 0; gx < MW; gx += 7) {
      const x = gx + Math.floor(hash(gx, gy, 11) * 6);
      const y = gy + Math.floor(hash(gx, gy, 12) * 6);
      if (t(x, y) !== 1 || t(x + 2, y + 2) !== 1 || t(x - 1, y - 1) !== 1) continue;
      const r = hash(x, y, 13);
      if (r < 0.16) {
        g.s(x, y, "c");
        g.s(x + 1, y, "t");
        g.s(x, y + 1, "k");
        g.s(x + 1, y + 1, "k");
      } else if (r < 0.26) {
        g.s(x, y, "k");
        g.s(x + 1, y, "k");
      } else if (r < 0.29) {
        g.s(x, y, "c");
        g.s(x, y + 1, "k");
      }
    }
  // 던전 입구 앞 디딤돌
  for (const [sx, sy, w, h] of [
    [308, 97, 11, 5],
    [322, 99, 10, 5],
    [313, 106, 12, 5],
    [326, 108, 8, 4],
    [306, 114, 9, 4],
  ])
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if ((i === 0 || i === w - 1) && (j === 0 || j === h - 1)) continue;
        let c = j === 0 || i === 0 ? "s" : j === h - 1 || i === w - 1 ? "S" : "e";
        if ((i === 0 || i === w - 1 || j === h - 1) && (j === h - 1 || i === w - 1)) c = "l";
        g.s(sx + i, sy + j, c);
        if (j === h - 1) g.m(sx + i + 1, sy + j + 1, SH);
      }
  // 4) 광장 돌바닥 (동글동글한 돌, 돌마다 왼쪽 위 밝고 오른쪽 아래 어둡다)
  const cell = 7;
  const sxAt = (cx, cy) => cx * cell + 1 + hash(cx, cy, 21) * (cell - 2);
  const syAt = (cx, cy) => cy * cell * 0.8 + 1 + hash(cx, cy, 22) * (cell * 0.8 - 2);
  const owner = new Int32Array(MW * MH).fill(-1);
  for (let y = PLAZA.y - PLAZA.ry - 2; y <= PLAZA.y + PLAZA.ry + 2; y++)
    for (let x = PLAZA.x - PLAZA.rx - 2; x <= PLAZA.x + PLAZA.rx + 2; x++) {
      if (t(x, y) !== 2) continue;
      const gcx = Math.floor(x / cell);
      const gcy = Math.floor(y / (cell * 0.8));
      let b1 = 1e9;
      let b2 = 1e9;
      let id = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const sx = sxAt(gcx + i, gcy + j);
          const sy = syAt(gcx + i, gcy + j);
          const d = (x + 0.5 - sx) ** 2 + ((y + 0.5 - sy) * 1.25) ** 2;
          if (d < b1) {
            b2 = b1;
            b1 = d;
            id = (gcx + i) * 1000 + (gcy + j);
          } else if (d < b2) b2 = d;
        }
      owner[idx(x, y)] = Math.sqrt(b2) - Math.sqrt(b1) < 1.1 ? -2 : id;
    }
  for (let y = PLAZA.y - PLAZA.ry - 2; y <= PLAZA.y + PLAZA.ry + 2; y++)
    for (let x = PLAZA.x - PLAZA.rx - 2; x <= PLAZA.x + PLAZA.rx + 2; x++) {
      const k = t(x, y);
      if (k !== 2 && k !== 3) continue;
      if (k === 2) {
        const o = owner[idx(x, y)];
        if (o === -2) {
          g.s(x, y, "S");
          continue;
        }
        const tone = hash(o, 7, 23);
        const T3 = tone < 0.18 ? ["S", "e", "l"] : ["e", "s", "S"];
        const ou = owner[idx(x, y - 1)];
        const ol = owner[idx(x - 1, y)];
        const od = owner[idx(x, y + 1)];
        const orr = owner[idx(x + 1, y)];
        let c = T3[0];
        if (ou !== o || ol !== o) c = T3[1];
        else if (od !== o || orr !== o) c = T3[2];
        g.s(x, y, c);
      } else {
        // 연석: 바깥쪽 아래는 어둡고, 위는 밝다
        const a = Math.atan2((y - PLAZA.y) / PLAZA.ry, (x - PLAZA.x) / PLAZA.rx);
        const segN = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 52);
        const outer = plazaF(x + 0.5, y + 0.5, PLAZA.rx - 1.2, PLAZA.ry - 1) > 1;
        const inner = plazaF(x + 0.5, y + 0.5, PLAZA.rx - 3, PLAZA.ry - 2.6) <= 1;
        let c = "e";
        if (inner) c = "S";
        else if (outer) c = y > PLAZA.y ? "l" : "S";
        else if (y < PLAZA.y) c = "s";
        const segL = Math.floor(((Math.atan2((y - PLAZA.y) / PLAZA.ry, (x - 1 - PLAZA.x) / PLAZA.rx) + Math.PI) / (Math.PI * 2)) * 52);
        if (segL !== segN && !outer) c = "l";
        if (t(x, y + 1) === 1 || t(x, y - 1) === 1 || t(x - 1, y) === 1 || t(x + 1, y) === 1) c = outer ? "S" : c;
        g.s(x, y, c);
      }
    }
  // 분수 둘레 다듬은 돌 고리 (밝은 돌을 둥글게)
  for (let y = PLAZA.y - 34; y <= PLAZA.y + 34; y++)
    for (let x = PLAZA.x - 54; x <= PLAZA.x + 54; x++) {
      const e = Math.hypot((x + 0.5 - 320) / 46, (y + 0.5 - 213) / 27);
      if (e < 1 || e > 1.2) continue;
      const a = Math.atan2((y + 0.5 - 213) / 27, (x + 0.5 - 320) / 46);
      const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 30);
      const segL = Math.floor(((Math.atan2((y + 0.5 - 213) / 27, (x - 0.5 - 320) / 46) + Math.PI) / (Math.PI * 2)) * 30);
      const segU = Math.floor(((Math.atan2((y - 0.5 - 213) / 27, (x + 0.5 - 320) / 46) + Math.PI) / (Math.PI * 2)) * 30);
      let c = seg % 2 ? "s" : "e";
      if (e > 1.15) c = y > 213 ? "l" : "S";
      else if (e < 1.04) c = y < 213 ? "S" : "s";
      if (seg !== segL || seg !== segU) c = "l";
      g.s(x, y, c);
    }
  // 돌 틈에 난 풀 (가장자리 쪽 몇 군데)
  for (let k = 0, n = 0; k < 400 && n < 18; k++) {
    const x = PLAZA.x - PLAZA.rx + Math.floor(hash(k, 1, 24) * PLAZA.rx * 2);
    const y = PLAZA.y - PLAZA.ry + Math.floor(hash(k, 2, 24) * PLAZA.ry * 2);
    const f = plazaF(x + 0.5, y + 0.5, PLAZA.rx, PLAZA.ry);
    if (f < 0.55 || f > 0.85 || t(x, y) !== 2 || g.g(x, y) !== "S") continue;
    g.s(x, y, "F");
    if (g.g(x, y - 1) === "S" || hash(k, 3, 24) > 0.5) g.s(x, y - 1, "G");
    if (hash(k, 4, 24) > 0.5) g.s(x + 1, y - 1, "L");
    n++;
  }
  // 광장 둘레 풀은 한 단계 어둡게 (연석 그늘)
  for (let y = PLAZA.y - PLAZA.ry; y <= PLAZA.y + PLAZA.ry + 2; y++)
    for (let x = PLAZA.x - PLAZA.rx; x <= PLAZA.x + PLAZA.rx + 2; x++) {
      const i = x + y * MW;
      if ((T[i] === 0 || T[i] === 1) && (T[i - MW - 1] === 3 || T[i - MW] === 3)) g.d[i] = SHI[g.d[i]];
    }
  // 5) 연못: 물가 흙 + 돌, 물 위쪽은 둑 그늘, 연잎·갈대
  for (let y = POND.y - POND.ry - 7; y <= POND.y + POND.ry + 7; y++)
    for (let x = POND.x - POND.rx - 7; x <= POND.x + POND.rx + 7; x++) {
      const k = t(x, y);
      if (k === 5) {
        const r = pondR(x + 0.5, y + 0.5);
        g.s(x, y, y < POND.y ? (r > 1.07 ? "k" : "b") : r > 1.07 ? "b" : "k");
        if (y > POND.y && r < 1.05) g.s(x, y, "t");
      } else if (k === 4) {
        let c = "B";
        if (t(x, y - 1) === 5 || t(x, y - 2) === 5) c = "u";
        else if (t(x, y - 3) === 5 && hash(x, y, 31) > 0.5) c = "u";
        const pr = pondR(x + 0.5, y + 0.5) + (vnoise(x, y, 6, 32) - 0.5) * 0.18;
        if (pr < 0.44 && y < POND.y + 5) c = "u";
        if (t(x, y + 1) === 5) c = "C";
        g.s(x, y, c);
      }
    }
  for (const [dx, dy, s] of [
    [-22, -6, DECO.lily],
    [-14, 2, DECO.lilyF],
    [-30, -2, DECO.lily],
    [26, 2, DECO.lily],
    [-2, 6, DECO.lily],
  ])
    g.put(s, POND.x + dx, POND.y + dy);
  for (const [dx, dy] of [
    [-36, -10],
    [-31, -14],
    [30, -12],
    [34, -6],
    [-38, 2],
  ])
    g.put(DECO.reed, POND.x + dx, POND.y + dy);
  for (const [dx, dy] of [
    [-34, 8],
    [26, 10],
    [6, -18],
    [-18, -17],
    [36, 2],
  ])
    g.put(DECO.pebble, POND.x + dx, POND.y + dy);
  // 선착장: 가로 판자 + 물속 기둥 + 물 위 그늘
  {
    const { x: dx0, y: dy0, w, h } = DOCK;
    for (let y = dy0 + 2; y < dy0 + h + 3; y++) for (let x = dx0 + 2; x < dx0 + w + 2; x++) if (T[idx(x, y)] === 4) g.s(x, y, y > dy0 + h ? "n" : "u");
    for (let y = dy0; y < dy0 + h; y++)
      for (let x = dx0; x < dx0 + w; x++) {
        const yy = (y - dy0) % 3;
        let c = yy === 0 ? "t" : yy === 1 ? "k" : "b";
        if (yy === 0 && hash(x >> 2, y, 33) > 0.6) c = "c";
        if (x === dx0 || x === dx0 + w - 1) c = "d";
        if (y === dy0 + h - 1) c = "d";
        if (yy === 1 && (x === dx0 + 1 || x === dx0 + w - 2)) c = "d";
        g.s(x, y, c);
      }
    for (const px of [dx0, dx0 + w - 2])
      for (let y = dy0 + h; y < dy0 + h + 3; y++) {
        g.s(px, y, "b");
        g.s(px + 1, y, "d");
      }
    for (let x = dx0 - 1; x <= dx0 + w + 2; x++) if (T[idx(x, dy0 + h + 3)] === 4) g.s(x, dy0 + h + 3, "C");
  }
  // 6) 텃밭: 고랑 + 작물
  for (const [bx, by, bw, bh] of BEDS) {
    for (let y = by; y < by + bh; y++)
      for (let x = bx; x < bx + bw; x++) {
        const yy = (y - by) % 8;
        let c = yy < 2 ? "k" : yy < 5 ? "b" : yy === 5 ? "d" : "b";
        if (yy === 0 && hash(x, y, 41) > 0.7) c = "t";
        if (x === bx || y === by) c = "d";
        if (x === bx + bw - 1 || y === by + bh - 1) c = "k";
        g.s(x, y, c);
      }
  }
  for (let x = 470; x < 528; x += 10) {
    g.put(CROPS.cabbage, x, 294);
    g.put(CROPS.cabbage, x + 4, 302 + (x % 20 === 0 ? 1 : 0));
  }
  for (let x = 470; x < 528; x += 13) {
    g.put(x % 2 ? CROPS.pumpkin : CROPS.cabbage, x, 330);
    g.put(CROPS.pumpkin, x + 5, 340);
  }
  for (let y = 296; y < 350; y += 8)
    for (let x = 544; x < 592; x += 7) {
      if (x > 560 && x < 580 && y > 316) continue;
      const r = hash(x, y, 43);
      if (r < 0.12) continue;
      g.put(y % 16 ? (r > 0.85 ? CROPS.sprout : CROPS.carrot) : r > 0.6 ? CROPS.carrot : CROPS.sprout, x + Math.floor(hash(x, y, 44) * 3), y);
    }
  // 7) 절벽: 바위 기둥 + 층 + 풀 턱 + 덩굴
  bakeCliff(g);
  bakeGate(g);
  // 8) 꽃밭 (손으로 놓은 자리)
  const patches = [
    [60, 236, 12, 5],
    [148, 168, 10, 4],
    [238, 160, 9, 3],
    [404, 166, 10, 3],
    [600, 214, 8, 4],
    [282, 318, 10, 4],
    [130, 392, 10, 4],
    [378, 392, 12, 4],
    [446, 410, 8, 3],
    [176, 250, 8, 3],
    [264, 118, 8, 3],
    [416, 104, 8, 3],
    [540, 410, 10, 3],
  ];
  const fl = [DECO.pink, DECO.white, DECO.yellow, DECO.blue, DECO.purple, DECO.tulip];
  patches.forEach(([px0, py0, r, n], i) => {
    const kinds = [fl[i % fl.length], fl[(i + 2) % fl.length]];
    for (let k = 0; k < n * 3; k++) {
      const a = hash(k, i, 51) * Math.PI * 2;
      const d = Math.sqrt(hash(k, i, 52)) * r;
      const x = Math.round(px0 + Math.cos(a) * d);
      const y = Math.round(py0 + Math.sin(a) * d * 0.6);
      if (t(x, y) !== 0 || t(x + 3, y + 3) !== 0) continue;
      g.put(k % 3 === 2 ? DECO.dark2 : kinds[k % 2], x, y);
    }
  });
  for (const [x, y, s] of [
    [40, 404, DECO.mush],
    [200, 410, DECO.mush2],
    [602, 300, DECO.mush],
    [214, 150, DECO.mush2],
    [452, 150, DECO.mush],
    [30, 300, DECO.mush2],
    [612, 404, DECO.mush2],
    [140, 420, DECO.mush],
  ])
    if (t(x, y) === 0) g.put(s, x, y);
  // 벽·울타리 밑에 자란 풀 (문 앞은 비운다)
  const weeds = [];
  for (const b of [SMITHY, SHOP, CARDS, COTTAGE]) weeds.push([b.x + b.wall[0] - 3, b.x + b.wall[1] + 2, b.mbase - 1, b.mdoor.x]);
  weeds.push([GARDEN.x0 - 2, GARDEN.x1, GARDEN.y1 - 1, -99]);
  for (const [x0, x1, y0, dx] of weeds)
    for (let x = x0; x < x1; x += 3 + Math.floor(hash(x, 1, 95) * 7)) {
      const y = y0 + Math.floor(hash(x, 2, 95) * 2);
      if (Math.abs(x - dx) < 17 || t(x, y + 2) !== 0 || t(x + 4, y + 3) !== 0) continue;
      g.put(hash(x, 3, 95) > 0.35 ? DECO.tuft1 : hash(x, 4, 95) > 0.5 ? DECO.tuft3 : DECO.white, x, y);
    }
  // 9) 그림자 (겹쳐도 한 번만 어둡게)
  for (let i = 0; i < SHD.length; i++) if (SHD[i]) g.d[i] = SHI[g.d[i]];
  return g;
}
function bakeCliff(g) {
  // 절벽 위 풀밭 (풀포기 조금)
  for (let x = 0; x < MW; x++) for (let y = 0; y < CL_TOP[x]; y++) if (hash(x, y, 61) > 0.985) g.s(x, y, "L");
  // 바위 판: 조금 세로로 긴 덩어리들 (보로노이). 중간 턱을 기준으로 위·아래 두 층
  const CW = 14;
  const CHh = 15;
  const sxAt = (i, j) => i * CW + 1.5 + hash(i, j, 62) * (CW - 3);
  const syAt = (i, j) => j * CHh + 1.5 + hash(i, j, 63) * (CHh - 3);
  const N = MW * 100;
  const own = new Int32Array(N).fill(-1);
  const SX = new Float32Array(N);
  const SY = new Float32Array(N);
  for (let x = 0; x < MW; x++)
    for (let y = CL_TOP[x] + 3; y <= CL_BOT[x]; y++) {
      const k = x + y * MW;
      if (y === CL_MID[x]) {
        own[k] = -3;
        continue;
      }
      const tier = y > CL_MID[x] ? 1 : 0;
      const gi = Math.floor(x / CW);
      const gj = Math.floor(y / CHh);
      let b1 = 1e9;
      let b2 = 1e9;
      let id = 0;
      let bx = 0;
      let by = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const sx = sxAt(gi + i, gj + j);
          const sy = syAt(gi + i, gj + j);
          const d = ((x + 0.5 - sx) * 1.15) ** 2 + ((y + 0.5 - sy) * 0.78) ** 2;
          if (d < b1) {
            b2 = b1;
            b1 = d;
            id = (gi + i) * 100 + gj + j;
            bx = sx;
            by = sy;
          } else if (d < b2) b2 = d;
        }
      own[k] = Math.sqrt(b2) - Math.sqrt(b1) < 0.9 ? -2 : id * 2 + tier;
      SX[k] = x + 0.5 - bx;
      SY[k] = y + 0.5 - by;
    }
  for (let x = 0; x < MW; x++)
    for (let y = CL_TOP[x] + 3; y <= CL_BOT[x]; y++) {
      const k = x + y * MW;
      const o = own[k];
      let c;
      if (o === -3) c = "d";
      else if (o === -2) c = own[k - MW] === -2 && own[k + MW] !== -2 && hash(x, y, 64) > 0.5 ? "b" : "d";
      else {
        const tone = hash(o, 3, 65);
        const R = tone < 0.22 ? ["b", "k", "d", "k"] : tone > 0.86 ? ["t", "c", "k", "c"] : ["k", "t", "b", "c"]; // 바탕, 밝음, 그늘, 빛
        const up = own[k - MW] !== o;
        const lf = own[k - 1] !== o;
        const dn = own[k + MW] !== o;
        const rt = own[k + 1] !== o;
        const dx = SX[k];
        const dy = SY[k];
        // 판마다 왼쪽 면은 밝고 오른쪽 면은 어둡다 (세로로 깎인 바위)
        c = R[0];
        if (dx < -1.8 + dy * 0.15) c = R[1];
        else if (dx > 2.2 + dy * 0.1) c = R[2];
        if (up) c = R[3];
        else if (lf) c = R[1];
        if (dn || (rt && !up)) c = R[2];
        if (c === R[0] && hash(x, y >> 2, 66) > 0.9) c = R[2];
        // 아래 층은 조금 더 어둡게
        if (y > CL_MID[x] + 1 && hash(o, 5, 65) > 0.55 && SH[c]) c = c === "c" ? "t" : c === "t" ? "k" : c;
      }
      g.s(x, y, c);
    }
  // 세로로 갈라진 틈 몇 줄
  for (let k = 0; k < 22; k++) {
    let x = Math.floor(hash(k, 1, 67) * MW);
    if (Math.abs(x - GATE.x) < 40) continue;
    const y0 = (hash(k, 2, 67) > 0.5 ? CL_TOP[x] + 3 : CL_MID[x] + 1) + Math.floor(hash(k, 4, 67) * 3);
    const len = 6 + Math.floor(hash(k, 3, 67) * 14);
    for (let j = 0; j < len; j++) {
      const y = y0 + j;
      if (y >= CL_BOT[x] - 1 || y === CL_MID[x]) break;
      if (hash(k, j, 68) > 0.75) x += hash(k, j, 69) > 0.5 ? 1 : -1;
      g.s(x, y, "d");
      g.m(x + 1, y, SH);
    }
  }
  // 중간 턱: 밝은 윗면 + 군데군데 풀
  for (let x = 0; x < MW; x++) {
    const y = CL_MID[x];
    g.m(x, y - 1, SH);
    if (vnoise(x, 5, 16, 37) > 0.5) {
      g.s(x, y, "F");
      g.s(x, y - 1, hash(x, 1, 38) > 0.4 ? "G" : "F");
      if (hash(x, 2, 38) > 0.55) g.s(x, y - 2, hash(x, 3, 38) > 0.5 ? "L" : "G");
      if (hash(x, 4, 38) > 0.7) g.s(x, y + 1, "F");
    }
  }
  // 아래쪽은 어둡게 (바닥 그늘), 맨 아래 외곽선
  for (let x = 0; x < MW; x++) {
    const bot = CL_BOT[x];
    for (let y = bot - 4; y <= bot; y++) if (y >= bot - 2 || hash(x >> 1, y, 70) > 0.45) g.m(x, y, SH);
    g.s(x, bot, "d");
    // 절벽 아래 풀 그늘 2줄
    g.m(x, bot + 1, SH);
    if (hash(x >> 1, 1, 71) > 0.3) g.m(x, bot + 2, SH);
  }
  // 위 풀 턱 (튀어나온 풀 + 아래 그늘) + 덩굴
  for (let x = 0; x < MW; x++) {
    const top = CL_TOP[x];
    g.s(x, top, "G");
    g.s(x, top + 1, hash(x, 2, 72) > 0.5 ? "F" : "G");
    g.s(x, top + 2, "D");
    g.m(x, top + 3, SH);
    if (hash(x, 3, 72) > 0.6) g.s(x, top - 1, "L");
    if (hash(x >> 1, 4, 72) > 0.7) g.s(x, top + 2, "F");
  }
  for (let k = 0; k < 34; k++) {
    const x = Math.floor(hash(k, 1, 73) * MW);
    if (Math.abs(x - GATE.x) < 30) continue;
    const len = 4 + Math.floor(hash(k, 2, 73) * 14);
    for (let j = 0; j < len; j++) {
      const y = CL_TOP[x] + 2 + j;
      const xx = x + (j % 4 === 3 ? 1 : 0);
      g.s(xx, y, j % 3 === 0 ? "G" : "F");
      if (j % 3 === 1) g.s(xx + (j % 2 ? 1 : -1), y, hash(k, j, 74) > 0.5 ? "L" : "G");
    }
  }
  // 절벽 밑 바위
  for (let k = 0; k < 16; k++) {
    const x = 20 + Math.floor(hash(k, 1, 75) * (MW - 40));
    if (Math.abs(x - GATE.x) < 40) continue;
    const s = hash(k, 2, 75) > 0.5 ? PROPS.rock : PROPS.rockS;
    g.put(s, x, CL_BOT[x] - s.h + 3);
  }
  // 절벽 위 숲: 뒷줄(높이, 촘촘히) → 앞줄(턱 가까이) → 턱 위 덤불. 뒤쪽이라 조금 어둡게
  const back = [TREES.backOak, TREES.backPine, TREES.backOak2, TREES.backOak, TREES.backPine];
  const at = (x) => CL_TOP[clamp(Math.round(x), 0, MW - 1)];
  for (let x = -10, k = 0; x < MW + 12; x += 13 + Math.floor(hash(k, 1, 77) * 10), k++) {
    const t = back[Math.floor(hash(k, 3, 77) * back.length)];
    g.put(hash(k, 4, 77) > 0.5 ? flipPix(t.pix) : t.pix, x - t.ax, at(x) - 9 - Math.floor(hash(k, 2, 77) * 6) - t.ay);
  }
  for (let x = 4, k = 0; x < MW; x += 24 + Math.floor(hash(k, 1, 78) * 16), k++) {
    if (Math.abs(x - GATE.x) < 34) continue;
    const t = hash(k, 3, 78) > 0.35 ? TREES.backOak2 : TREES.backPine;
    g.put(hash(k, 4, 78) > 0.5 ? flipPix(t.pix) : t.pix, x - t.ax, at(x) - 1 + Math.floor(hash(k, 2, 78) * 2) - t.ay);
  }
  for (let x = 10, k = 0; x < MW; x += 20 + Math.floor(hash(k, 1, 79) * 22), k++) {
    if (Math.abs(x - GATE.x) < 30) continue;
    const t = hash(k, 3, 79) > 0.5 ? TREES.bush2 : TREES.bush;
    g.put(recolorDark(t.pix), x - t.ax, at(x) + 1 - t.ay);
  }
  // 입구 위 작은 나무 둘 (아치 양옆)
  g.put(TREES.backOak2.pix, GATE.x - 44 - TREES.backOak2.ax, CL_TOP[GATE.x - 44] + 1 - TREES.backOak2.ay);
  g.put(flipPix(TREES.backOak2.pix), GATE.x + 44 - TREES.backOak2.ax, CL_TOP[GATE.x + 44] + 1 - TREES.backOak2.ay);
}
// 덤불을 한 단계 어둡게 (절벽 위용, 한 번만 만든다)
const darkCache = new Map();
function recolorDark(p) {
  if (darkCache.has(p)) return darkCache.get(p);
  const q = new Pix(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) q.d[i] = p.d[i] && CH[p.d[i]] !== "D" ? SHI[p.d[i]] : p.d[i];
  darkCache.set(p, q);
  return q;
}
// 던전 입구: 깎은 돌 아치 + 어두운 굴 + 내려가는 계단 + 올린 쇠살문 + 횃불 받침
function bakeGate(g) {
  const { x: cx, base, ay, rIn, rOut } = GATE;
  // 아치 주변 절벽에 그늘 (안쪽이 파여 들어간 느낌)
  for (let y = ay - rOut - 4; y <= base; y++)
    for (let x = cx - rOut - 6; x <= cx + rOut + 6; x++) {
      const d = y < ay ? Math.hypot(x - cx, y - ay) : Math.abs(x - cx);
      if (d <= rOut + 3 && d > rOut) g.m(x, y, SH);
    }
  // 굴 안
  for (let y = ay - rIn; y <= base; y++)
    for (let x = cx - rIn; x <= cx + rIn; x++) {
      const d = y < ay ? Math.hypot(x + 0.5 - cx, y + 0.5 - ay) : Math.abs(x + 0.5 - cx);
      if (d > rIn) continue;
      let c = "K";
      if (d > rIn - 1.5) c = "n";
      g.s(x, y, c);
    }
  // 계단 (가까울수록 밝다)
  const steps = [
    [base - 4, rIn, "S", "l"],
    [base - 8, rIn - 2, "l", "n"],
    [base - 12, rIn - 4, "n", "K"],
  ];
  for (const [sy, hw, top, face] of steps) {
    for (let x = cx - hw; x <= cx + hw; x++) {
      g.s(x, sy, top);
      g.s(x, sy + 1, face);
      g.s(x, sy + 2, face);
      if (top === "S" && x < cx - 2 && hash(x, sy, 81) > 0.6) g.s(x, sy, "e");
    }
  }
  for (let x = cx - rIn; x <= cx + rIn; x++) {
    g.s(x, base - 1, "l");
    g.s(x, base, "S");
  }
  // 올린 쇠살문 (위 둥근 곳에 이빨만 보인다)
  for (let x = cx - rIn + 2; x <= cx + rIn - 2; x++) {
    const d = Math.abs(x + 0.5 - cx);
    const top = Math.round(ay - Math.sqrt(Math.max(0, rIn * rIn - d * d))) + 1;
    const bar = (x - cx + 100) % 4 === 0;
    for (let y = top; y <= ay - 2; y++) {
      if (bar) g.s(x, y, y === ay - 2 ? "s" : x < cx ? "e" : "S");
      else if (y === ay - 6) g.s(x, y, "S");
      else if (y === ay - 5) g.s(x, y, "l");
    }
    if (bar) g.s(x, ay - 1, "e");
  }
  // 돌 아치 (쐐기돌 9개 + 이맛돌)
  const N = 9;
  for (let y = ay - rOut - 3; y <= ay; y++)
    for (let x = cx - rOut - 1; x <= cx + rOut + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - ay;
      const d = Math.hypot(dx, dy);
      if (d <= rIn || d > rOut) continue;
      const a = Math.atan2(-dy, dx); // 0 = 오른쪽, PI = 왼쪽
      const sa = (Math.PI - a) / Math.PI;
      const seg = Math.floor(sa * N);
      const f = sa * N - seg;
      let c = "e";
      if (d > rOut - 1.2) c = sa < 0.5 ? "s" : "S";
      else if (d < rIn + 1.5) c = "S";
      else if (sa < 0.45 && f < 0.5) c = "s";
      else if (sa > 0.6) c = f > 0.5 ? "S" : "e";
      if (f < 0.12 || f > 0.94) c = "l";
      g.s(x, y, c);
    }
  // 기둥 (엇갈린 큰 돌)
  for (const side of [-1, 1]) {
    for (let y = ay; y <= base; y++) {
      const row = Math.floor((y - ay) / 7);
      const yy = (y - ay) % 7;
      const ext = row % 2 === 0 ? 3 : 0;
      const xa = side < 0 ? cx - rOut - ext : cx + rIn + 1;
      const xb = side < 0 ? cx - rIn - 1 : cx + rOut + ext;
      for (let x = xa; x <= xb; x++) {
        const u = (x - xa) / (xb - xa);
        let c = "e";
        if (yy === 0) c = "s";
        else if (yy === 6) c = "l";
        else if (u < 0.15) c = "s";
        else if (u > 0.8) c = "S";
        if (side > 0 && u > 0.55 && c === "e") c = "S";
        if (x === xa || x === xb) c = yy === 6 ? "K" : c === "s" ? "e" : "l";
        g.s(x, y, c);
      }
      g.s(xa - 1, y, "K");
      g.s(xb + 1, y, "K");
    }
  }
  // 아치 바깥 외곽선
  for (let y = ay - rOut - 2; y <= ay; y++)
    for (let x = cx - rOut - 2; x <= cx + rOut + 2; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - ay);
      if (d > rOut && d <= rOut + 1.1) g.s(x, y, "K");
    }
  // 이맛돌 (해골 새김)
  const ks = P(`
    .KKKKKKKKK.
    KssssssseSK
    KsseeeeeeSK
    KseeKKKeeSK
    KseKsssKeSK
    KseKKsKKeSK
    KseeKsKeeSK
    KseeeeeeeSK
    .KseeeeeSK.
    ..KSSSSSK..
    ...KKKKK...
  `);
  g.put(ks, cx - 5, ay - rOut - 3);
  // 횃불 받침 (기둥 위쪽)
  const sconce = P(`
    .dbkd.
    .dbkd.
    KSeeSK
    .KSSK.
    ..KK..
  `);
  for (const side of [-1, 1]) g.put(sconce, cx + side * (rOut - 4) - 3, TORCH_Y);
  // 입구 양옆 바위
  g.put(PROPS.rock, cx - rOut - 14, base - 3);
  g.put(PROPS.rockS, cx + rOut + 6, base - 1);
}
const TORCH_Y = 62;

// 연못 물빛 (세 장): 반짝이는 짧은 가로줄이 자리를 바꾼다
const POND_BOX = { x: POND.x - POND.rx - 4, y: POND.y - POND.ry - 4, w: POND.rx * 2 + 9, h: POND.ry * 2 + 9 };
let POND_FRAMES = null;
function pondFrames(g) {
  return [0, 1, 2].map((f) => {
    const p = new Pix(POND_BOX.w, POND_BOX.h);
    for (let k = 0; k < 14; k++) {
      const x = Math.floor(hash(k, f, 85) * POND_BOX.w);
      const y = Math.floor(hash(k, f, 86) * POND_BOX.h);
      const len = 2 + Math.floor(hash(k, f, 87) * 3);
      for (let i = 0; i < len; i++) {
        const mx = POND_BOX.x + x + i;
        const my = POND_BOX.y + y;
        if (mx < 0 || my < 0 || mx >= MW || my >= MH) continue;
        if (T[idx(mx, my)] !== 4 || g.g(mx, my) !== "B") continue;
        p.s(x + i, y, i === 1 && len > 2 ? "W" : "C");
      }
    }
    return p;
  });
}

// ═════════════ 내보내기 ═════════════
const tapOf = (b) => ({ x: b.x + b.wall[0], y: b.y + 4, w: b.wall[1] - b.wall[0], h: b.base + 6 });
export const PLACES = [
  {
    key: "gate",
    name: "던전 입구",
    panel: "stages",
    door: { x: GATE.x, y: 102 },
    tap: { x: GATE.x - GATE.rOut - 6, y: GATE.ay - GATE.rOut - 6, w: GATE.rOut * 2 + 12, h: GATE.base - GATE.ay + GATE.rOut + 12 },
    sign: { x: GATE.x, y: GATE.ay - GATE.rOut - 8 },
  },
  { key: "smithy", name: "대장간", panel: "smithy", door: { x: SMITHY.mdoor.x, y: SMITHY.mbase + 9 }, tap: tapOf(SMITHY), sign: { x: SMITHY.x + SMITHY.sign.x, y: SMITHY.y + SMITHY.sign.y - 5 } },
  { key: "shop", name: "상점", panel: "shop", door: { x: SHOP.mdoor.x, y: SHOP.mbase + 9 }, tap: tapOf(SHOP), sign: { x: SHOP.x + SHOP.sign.x, y: SHOP.y + SHOP.sign.y - 5 } },
  { key: "cards", name: "카드 보관소", panel: "cards", door: { x: CARDS.mdoor.x, y: CARDS.mbase + 9 }, tap: tapOf(CARDS), sign: { x: CARDS.x + CARDS.sign.x, y: CARDS.y + CARDS.sign.y - 5 } },
];
export const SPAWN = { x: 320, y: 248 };
export const GATE_SPAWN = { x: 320, y: 126 };

// 발 위치(x, y)에 서 있을 수 없으면 true. 발 상자 약 10×4
const FEET = [-5, -3, 5, -3, -5, 1, 5, 1, 0, -1];
export function blocked(x, y) {
  x = Math.round(x);
  y = Math.round(y);
  for (let k = 0; k < FEET.length; k += 2) {
    const X = x + FEET[k];
    const Y = y + FEET[k + 1];
    if (X < 0 || Y < 0 || X >= MW || Y >= MH || BLK[X + Y * MW]) return true;
  }
  return false;
}

function ground() {
  if (!GROUND) {
    const g = bakeGround();
    POND_FRAMES = pondFrames(g);
    GROUND = g.canvas();
  }
  return GROUND;
}
export function drawGround(ctx, camX, camY, t = 0) {
  NOW = t;
  const cx = Math.round(camX);
  const cy = Math.round(camY);
  const W = ctx.canvas.width;
  const Hh = ctx.canvas.height;
  const img = ground();
  const sx = clamp(cx, 0, MW);
  const sy = clamp(cy, 0, MH);
  const sw = Math.min(MW - sx, W - (sx - cx));
  const sh = Math.min(MH - sy, Hh - (sy - cy));
  if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx - cx, sy - cy, sw, sh);
  // 연못 물빛
  drawPix(ctx, POND_FRAMES[Math.floor(t * 2.2) % 3], POND_BOX.x - cx, POND_BOX.y - cy);
  // 횃불
  for (const side of [-1, 1]) {
    const x = GATE.x + side * (GATE.rOut - 4) - cx;
    const f = (Math.floor(t * 9) + (side > 0 ? 1 : 0)) % 3;
    drawPix(ctx, TORCH_GLOW, x - 10, TORCH_Y - 13 - cy, 0.8 + Math.sin(t * 13 + side) * 0.2);
    drawPix(ctx, FLAME[f], x - 2, TORCH_Y - 6 - cy);
  }
}
export function objects(t = 0) {
  NOW = t;
  for (let i = 0; i < HENS.length; i++) HENS[i].y = Math.round(henAt(i, t).y);
  return OBJS.slice();
}
// 연기·나비·낙엽 (사람 위에 그린다)
const CHIMNEYS = [
  { x: SMITHY.x + SMITHY.chimney.x, y: SMITHY.y + SMITHY.chimney.y, dark: true, rate: 1 },
  { x: COTTAGE.x + COTTAGE.chimney.x, y: COTTAGE.y + COTTAGE.chimney.y, dark: false, rate: 0.7 },
];
const FLUTTER = [
  { x: 150, y: 160, rx: 26, ry: 12, s: 0.5, k: 0 },
  { x: 290, y: 330, rx: 30, ry: 10, s: 0.4, k: 1 },
  { x: 560, y: 230, rx: 20, ry: 14, s: 0.6, k: 2 },
];
const FALL = [
  { x: 206, y: 112, k: 0 },
  { x: 446, y: 104, k: 1 },
  { x: 40, y: 330, k: 0 },
];
export function drawAbove(ctx, camX, camY, t = 0) {
  NOW = t;
  const cx = Math.round(camX);
  const cy = Math.round(camY);
  for (const c of CHIMNEYS) {
    for (let k = 0; k < 5; k++) {
      const ph = (t * 0.32 * c.rate + k / 5) % 1;
      const x = c.x + ph * 10 + Math.sin(ph * 7 + k) * 1.5;
      const y = c.y - 2 - ph * 30;
      const set = c.dark ? PUFF_DARK : PUFF;
      const s = set[ph < 0.25 ? 0 : ph < 0.6 ? 1 : 2];
      drawPix(ctx, s, x - s.w / 2 - cx, y - s.h / 2 - cy, ph < 0.1 ? ph * 9 : 1 - ph * 0.9);
    }
  }
  for (const b of FLUTTER) {
    const tt = t * b.s + b.k * 2.1;
    const x = b.x + Math.sin(tt * 1.3) * b.rx + Math.sin(tt * 3.1) * 4;
    const y = b.y + Math.sin(tt * 2.1 + 1) * b.ry - Math.abs(Math.sin(t * 6 + b.k)) * 2;
    drawPix(ctx, BUTTER[b.k][Math.floor(t * 9 + b.k) % 2], x - 1 - cx, y - 1 - cy);
  }
  for (const l of FALL) {
    const ph = (t * 0.12 + l.k * 0.37 + l.x * 0.001) % 1;
    const x = l.x + Math.sin(ph * 12) * 5 + ph * 8;
    const y = l.y + ph * 42;
    drawPix(ctx, LEAF[l.k], x - cx, y - cy, ph > 0.8 ? (1 - ph) * 5 : 1);
  }
}
// 미리보기: 지도 전체 (pw가 지도보다 작으면 cx, cy 쿼리 위치를 가운데로)
export function preview(ctx, W, Hh, t = 0) {
  let camX = 0;
  let camY = 0;
  if (W < MW || Hh < MH) {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
    const fx = Number(q.get("cx") || PLAZA.x);
    const fy = Number(q.get("cy") || PLAZA.y);
    camX = clamp(fx - W / 2, 0, MW - W);
    camY = clamp(fy - Hh / 2, 0, MH - Hh);
  }
  drawGround(ctx, camX, camY, t);
  const list = objects(t).sort((a, b) => a.y - b.y);
  for (const o of list) o.draw(ctx, camX, camY);
  drawAbove(ctx, camX, camY, t);
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (q && q.get("blk") != null) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#ff0044";
    for (let y = 0; y < MH; y += 2) for (let x = 0; x < MW; x += 2) if (BLK[idx(x, y)]) ctx.fillRect(x - camX, y - camY, 2, 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fee761";
    for (const p of PLACES) ctx.fillRect(p.door.x - 1 - camX, p.door.y - 1 - camY, 3, 3);
    ctx.fillStyle = "#2ce8f5";
    for (const p of PLACES) ctx.fillRect(p.sign.x - 1 - camX, p.sign.y - 1 - camY, 3, 3);
  }
}
