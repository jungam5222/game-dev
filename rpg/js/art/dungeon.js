// 던전 방 그림 (방 하나 = 320×180 그림판 픽셀). 단계마다 테마 하나: 고블린 굴(cave), 버려진 광산(mine), 늑대 소굴(forest).
// 안 바뀌는 부분은 테마·문 상태마다 한 번 구워 두고(bake), 매 프레임에는 불꽃·수정·반딧불 같은 움직이는 것만 그린다.
// 빛은 왼쪽 위에서. 바닥 밝기는 "빛 단계" 값을 팔레트 단계로 바꿔 칠하고, 경계만 바둑판 디더로 섞는다.
import { PAL, spr, blit, recolor, hash, bake } from "../pixel.js";

export const ROOM_W = 320, ROOM_H = 180;
const W = ROOM_W, H = ROOM_H;
// 방 안쪽 경계 (걷는 바닥은 대략 y 50~172)
const IN_L = 14, IN_R = 300, IN_T = 47, IN_B = 172;
const GAP_T = 74, GAP_B = 122; // 오른쪽 출구 구멍 (y)
const ENT_T = 80, ENT_B = 116; // 왼쪽 들어온 길

// ───── 작은 도구 ─────
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x, y) => (BAYER[(x & 3) + (y & 3) * 4] + 0.5) / 16;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = sm(x / cell - gx), fy = sm(y / cell - gy);
  const a = hash(gx, gy, seed), b = hash(gx + 1, gy, seed), c = hash(gx, gy + 1, seed), d = hash(gx + 1, gy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// 연속 값 → 정수 단계 (경계 근처 좁은 띠만 디더)
function qd(v, x, y, sharp = 3.2) {
  const b = Math.floor(v);
  const f = clamp((v - b - 0.5) * sharp + 0.5, 0, 1);
  return b + (f > bay(x, y) ? 1 : 0);
}
// 타원 빛 웅덩이 (가운데 1 → 가장자리 0)
function pool(x, y, cx, cy, rx, ry) {
  const d0 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  if (d0 > 1.24) return 0;
  const d = Math.sqrt(d0) * (0.9 + 0.2 * vnoise(x + cx, y, 9, 7));
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}
const RGB = {};
for (const [k, v] of Object.entries(PAL)) RGB[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
const rgba = (ch, a) => `rgba(${RGB[ch][0]},${RGB[ch][1]},${RGB[ch][2]},${a})`;
const dot = (ctx, x, y, ch) => {
  ctx.fillStyle = PAL[ch];
  ctx.fillRect(x, y, 1, 1);
};

// 한 단계 어둡게 / 밝게 (같은 계열 안에서)
const DK = { c: "t", t: "k", k: "b", o: "k", b: "d", d: "K", R: "m", m: "d", r: "m", O: "R", g: "O", y: "g", W: "s", s: "e", e: "S", S: "l", l: "n", n: "K", K: "K", L: "G", G: "F", F: "D", D: "n", C: "B", B: "u", u: "n", P: "r", h: "m", M: "p", p: "n", 1: "2", 2: "b" };
const LT = { K: "n", n: "l", l: "S", S: "e", e: "s", s: "W", d: "b", b: "k", k: "t", t: "c", o: "t", m: "R", R: "o", D: "F", F: "G", G: "L", u: "B", B: "C", p: "M" };
const shiftCh = (ch, n) => {
  while (n < 0 && ch) (ch = DK[ch] || ch), n++;
  while (n > 0 && ch) (ch = LT[ch] || ch), n--;
  return ch;
};

// ───── 글자 버퍼: 픽셀마다 팔레트 글자 하나. 다 그린 뒤 한 번에 칠한다 ─────
class Buf {
  constructor(fill = "K") {
    this.c = new Array(W * H).fill(fill);
    this.light = null; // (x, y) → 빛 단계 (소품을 어둡게 할 때)
  }
  set(x, y, ch) {
    x = Math.round(x);
    y = Math.round(y);
    if (ch && x >= 0 && y >= 0 && x < W && y < H) this.c[y * W + x] = ch;
  }
  get(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < W && y < H ? this.c[y * W + x] : null;
  }
  shade(x, y, n) {
    const ch = this.get(x, y);
    if (!ch) return;
    if (ch) this.set(x, y, shiftCh(ch, n));
  }
  rect(x, y, w, h, ch) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
  }
  line(x0, y0, x1, y1, ch) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 999; n++) {
      typeof ch === "function" ? ch(x0, y0, n) : this.set(x0, y0, ch);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) (err += dy), (x0 += sx);
      if (e2 <= dx) (err += dx), (y0 += sy);
    }
  }
  // 그림 조각 찍기. 어두운 곳이면 색을 한두 단계 내린다 (lit: false면 그대로)
  spr(s, x, y, o = {}) {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < s.h; j++)
      for (let i = 0; i < s.w; i++) {
        let ch = s.rows[j][o.flip ? s.w - 1 - i : i];
        if (ch === "." || ch === " ") continue;
        let k = o.shift || 0;
        if (o.lit !== false && this.light) {
          const lv = this.light(x + i, y + j);
          k += lv < 1.1 ? -2 : lv < 1.7 ? -1 : 0;
        }
        this.set(x + i, y + j, shiftCh(ch, k));
      }
  }
  // 바닥 그림자: 한 단계 어둡게 (타원, 가장자리는 바둑판)
  shadeOval(cx, cy, rx, ry, n = -1, dith = true) {
    for (let j = -ry; j <= ry; j++)
      for (let i = -rx; i <= rx; i++) {
        const d = (i * i) / (rx * rx + 0.3) + (j * j) / (ry * ry + 0.3);
        if (d > 1) continue;
        if (dith && d > 0.6 && (cx + i + cy + j) & 1) continue;
        this.shade(cx + i, cy + j, n);
      }
  }
  paint(ctx) {
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < W * H; i++) {
      const ch = this.c[i];
      if (!ch) continue;
      const c = RGB[ch];
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
}

// ───── 바위 한 덩이: 울퉁불퉁한 윤곽 + 왼쪽 위 빛 (띠 3~4단) + 윗면 테두리 빛 + 금 ─────
const LX = -0.5, LY = -0.66, LZ = 0.56;
function rock(B, cx, cy, rx, ry, seed, ramp, o = {}) {
  const n = o.bumps || 9;
  const rad = [];
  for (let i = 0; i < n; i++) rad.push(0.8 + hash(i, 7, seed) * (o.rough == null ? 0.3 : o.rough));
  const R = (th) => {
    const f = ((th / (2 * Math.PI)) * n + n) % n;
    const i = Math.floor(f);
    return rad[i] + (rad[(i + 1) % n] - rad[i]) * sm(f - i);
  };
  const nf = o.facets == null ? 3 : o.facets;
  const fac = [];
  for (let i = 0; i < nf; i++) {
    const a = hash(i, 1, seed) * 6.283;
    const r = 0.25 + Math.sqrt(hash(i, 2, seed)) * 0.55;
    fac.push([Math.cos(a) * r, Math.sin(a) * r * 0.9 - 0.1]);
  }
  const fw = o.fw == null ? 0.3 : o.fw; // 면 나눔 세기 (0 = 매끈)
  const x0 = Math.floor(cx - rx - 1), y0 = Math.floor(cy - ry - 1);
  const ww = Math.ceil(rx * 2 + 3), hh = Math.ceil(ry * 2 + 3);
  const lv = new Int8Array(ww * hh).fill(-1);
  const NY = new Float32Array(ww * hh), NX = new Float32Array(ww * hh);
  for (let j = 0; j < hh; j++)
    for (let i = 0; i < ww; i++) {
      const x = x0 + i, y = y0 + j;
      let u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      if (o.flat && v > o.flat) v = o.flat + (v - o.flat) * 3; // 바닥 쪽 평평
      const rr = R(Math.atan2(v, u));
      if (Math.hypot(u, v) / rr >= 1) continue;
      let nx = u / rr, ny = v / rr;
      if (nf && fw) {
        let best = 9, bf = null;
        for (const f of fac) {
          const dd = (nx - f[0]) ** 2 + (ny - f[1]) ** 2;
          if (dd < best) (best = dd), (bf = f);
        }
        nx = nx * (1 - fw) + bf[0] * fw * 1.3;
        ny = ny * (1 - fw) + bf[1] * fw * 1.3;
      }
      const nz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny));
      const I = (nx * LX + ny * LY + nz * LZ) / Math.hypot(nx, ny, nz);
      const bias = (o.bias ? o.bias(x, y) : 0) + (o.b || 0);
      lv[j * ww + i] = clamp(Math.round((o.base == null ? 1.2 : o.base) + I * (o.gain || 2.1) + bias), 1, o.max || ramp.length - 1);
      NX[j * ww + i] = nx;
      NY[j * ww + i] = ny;
    }
  const out = (a, b) => a < 0 || b < 0 || a >= ww || b >= hh || lv[b * ww + a] < 0;
  const isEdge = (i, j) => !out(i, j) && (out(i - 1, j) || out(i + 1, j) || out(i, j - 1) || out(i, j + 1));
  const top = ramp.length - 1;
  for (let j = 0; j < hh; j++)
    for (let i = 0; i < ww; i++) {
      let k = lv[j * ww + i];
      if (k < 0) continue;
      const x = x0 + i, y = y0 + j;
      if (isEdge(i, j)) {
        B.set(x, y, o.outline || ramp[0]);
        continue;
      }
      // 윗면·왼쪽 테두리 빛 (외곽선 바로 안쪽)
      if (o.rim !== false && ((isEdge(i, j - 1) && NY[j * ww + i] < -0.15) || (isEdge(i - 1, j) && NX[j * ww + i] < -0.35 && NY[j * ww + i] < 0.3))) k = Math.min(top, k + 1);
      let ch = ramp[k];
      if (o.leaf && hash(x, y, seed + 5) < 0.1 && k > 1) {
        // 잎 덩이 무늬: 짧은 어두운 초승달 + 위쪽 밝은 점
        ch = ramp[k - 1];
        if (!out(i + 1, j) && !isEdge(i + 1, j)) B.set(x + 1, y, ramp[k - 1]);
        if (!out(i, j - 1) && !isEdge(i, j - 1)) B.set(x, y - 1, ramp[Math.min(top, k + 1)]);
      }
      B.set(x, y, ch);
    }
  // 금: 큰 바위에 가장자리에서 안쪽으로 짧게 (아래쪽은 밝은 입술)
  if (o.cracks !== false && rx >= 7 && !o.leaf) {
    const nc = rx >= 11 ? 2 : 1;
    for (let c = 0; c < nc; c++) {
      const a = (hash(c, 11, seed) < 0.5 ? -0.3 : 2.2) + hash(c, 12, seed) * 1.2;
      let px = cx + Math.cos(a) * rx * 0.85, py = cy + Math.sin(a) * ry * 0.85;
      const dx = -Math.cos(a), dy = -Math.sin(a) * 0.6;
      const len = 3 + Math.floor(hash(c, 13, seed) * (rx * 0.4));
      for (let s = 0; s < len; s++) {
        const i = Math.round(px) - x0, j = Math.round(py) - y0;
        if (out(i, j) || isEdge(i, j)) {
          px += dx; py += dy; continue;
        }
        const k = lv[j * ww + i];
        B.set(x0 + i, y0 + j, ramp[Math.max(0, k - 1)]);
        if (!out(i, j + 1) && !isEdge(i, j + 1) && hash(s, c, seed) < 0.6) B.set(x0 + i, y0 + j + 1, ramp[Math.min(top, k + 1)]);
        px += dx + (hash(s, 14, seed) - 0.5) * 0.8;
        py += dy + (hash(s, 15, seed) - 0.5) * 0.8;
      }
    }
  }
  if (o.speck) {
    // 광맥: 반짝이 점 덩어리
    const [cA, cB, nS] = o.speck;
    for (let s = 0; s < nS; s++) {
      const a = hash(s, 3, seed) * 6.283, r = Math.sqrt(hash(s, 4, seed)) * 0.6;
      const sx = Math.round(cx + Math.cos(a) * r * rx), sy = Math.round(cy + Math.sin(a) * r * ry);
      const i = sx - x0, j = sy - y0;
      if (out(i, j) || isEdge(i, j)) continue;
      B.set(sx, sy, cA);
      if (hash(s, 5, seed) < 0.6 && !out(i + 1, j) && !isEdge(i + 1, j)) B.set(sx + 1, sy, cB);
      if (hash(s, 6, seed) < 0.5 && !out(i, j + 1) && !isEdge(i, j + 1)) B.set(sx, sy + 1, cB);
    }
  }
  return lv;
}

// ───── 바닥 디테일 (빛 단계 위에 더하는 값: +는 밝게, -는 어둡게) ─────
const PEB = [
  ["h", "x"],
  ["hb", "xx"],
  [".xx.", "xhbx", ".xx."],
  [".xx.", "xhbx", "xbbx", ".xx."],
  ["..xx.", ".xhbx", "xhbbx", "xbbxx", ".xx.."],
];
const PEB_V = { h: 2, b: 1, x: -1, d: -2, "+": 1 };
function stamp(off, x, y, mask) {
  for (let j = 0; j < mask.length; j++)
    for (let i = 0; i < mask[j].length; i++) {
      const ch = mask[j][i];
      if (ch === ".") continue;
      const X = x + i, Y = y + j;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      off[Y * W + X] = PEB_V[ch];
    }
}
// 갈라진 금: 한쪽으로 걸어가며 가끔 갈래, 아래 가장자리는 살짝 밝게
function crack(off, x, y, len, seed, dir = 1, depth = 0) {
  for (let i = 0; i < len; i++) {
    const X = Math.round(x), Y = Math.round(y);
    if (X >= 0 && Y >= 0 && X < W && Y + 1 < H) {
      off[Y * W + X] = -1;
      if (hash(i, seed, 2) < 0.35 && off[(Y + 1) * W + X] === 0) off[(Y + 1) * W + X] = 1;
    }
    const r = hash(i, seed, 7);
    if (r < 0.5) x += dir;
    else if (r < 0.82) (x += dir), (y += hash(i, seed, 9) < 0.5 ? -1 : 1);
    else y += hash(i, seed, 5) < 0.5 ? -1 : 1;
    if (depth < 1 && i > 2 && hash(i, seed, 11) < 0.12) crack(off, x, y, (len / 2) | 0, seed + 31 * i, dir, depth + 1);
  }
}
// 얼룩 (테두리가 또렷한 불규칙 덩이)
function patch(off, cx, cy, rx, ry, val, seed) {
  for (let j = -ry - 2; j <= ry + 2; j++)
    for (let i = -rx - 2; i <= rx + 2; i++) {
      const th = Math.atan2(j / ry, i / rx);
      const rr = 0.75 + 0.35 * vnoise(th * 3 + 10, 0, 1, seed) + 0.15 * hash(i >> 1, j >> 1, seed);
      if (Math.hypot(i / rx, j / ry) > rr) continue;
      const X = Math.round(cx + i), Y = Math.round(cy + j);
      if (X >= 0 && Y >= 0 && X < W && Y < H && off[Y * W + X] === 0) off[Y * W + X] = val;
    }
}
// 가운데(싸우는 자리)는 덜 어지럽게: 1 = 마음대로, 0 = 비움
const busy = (x, y) => 1 - 0.9 * pool(x, y, 130, 98, 125, 50);
function scatter(off, n, seed, masks, dens = 1) {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(IN_L + 2 + hash(i, 1, seed) * (IN_R - IN_L - 4));
    const y = Math.floor(IN_T + 4 + hash(i, 2, seed) * (IN_B - IN_T - 6));
    if (hash(i, 3, seed) > busy(x, y) * dens) continue;
    stamp(off, x, y, masks[Math.floor(hash(i, 4, seed) * masks.length)]);
  }
}

// 잔 알갱이 결: 들쭉날쭉한 격자 칸마다 작은 점 하나 (규칙적이지만 기계적이지 않게)
const SPK = [["x"], ["xx"], ["x.", ".x"], ["x"], [".x", "x."], ["+"], ["x", "+"]];
function speckle(off, seed, cw = 7, chh = 5, p = 0.6, masks = SPK) {
  for (let gy = 0; gy < H / chh; gy++)
    for (let gx = 0; gx < W / cw; gx++) {
      if (hash(gx, gy, seed) > p) continue;
      const x = Math.floor(gx * cw + hash(gx, gy, seed + 1) * (cw - 2));
      const y = Math.floor(gy * chh + (gx & 1) * 2 + hash(gx, gy, seed + 2) * (chh - 1));
      if (y < IN_T + 3) continue;
      stamp(off, x, y, masks[Math.floor(hash(gx, gy, seed + 3) * masks.length)]);
    }
}

// 바닥 칠하기: light(x,y) 단계 + off → ramp
function floorPass(B, light, off, rampAt) {
  const L = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = (L[y * W + x] = light(x, y));
      const ramp = rampAt(x, y);
      const k = clamp(qd(v, x, y) + off[y * W + x], 0, ramp.length - 1);
      B.c[y * W + x] = ramp[k];
    }
  // 소품 어둡게 하기·옆벽 밝기에 다시 쓰도록 빛 값을 표로 둔다
  return (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < W && y < H ? L[y * W + x] : 0;
  };
}
// 가장자리 어둡게 (빛 단계에서 뺄 값)
function edgeDark(x, y, open) {
  let v = 0;
  let ds = Math.min(x - IN_L, IN_R - x);
  if (x > IN_R - 14 && y > GAP_T && y < GAP_B) ds = open ? 30 : Math.max(0, IN_R + 4 - x) * 0.7 + 3;
  if (x < IN_L + 14 && y > ENT_T && y < ENT_B) ds = Math.max(2, x * 0.8 - 2);
  if (ds < 30) v += 1.5 * (1 - Math.max(0, ds) / 30) ** 2 + (ds < 0 ? -ds * 0.05 : 0);
  const db = IN_B - y;
  if (db < 28) v += 1.3 * (1 - Math.max(0, db) / 28) ** 2;
  const dt = y - IN_T;
  if (dt < 8) v += 1.2 * (1 - Math.max(0, dt) / 8);
  return v;
}

// ───── 공용 그림 조각 ─────
const S = {
  torch: spr(`
    .dbbd.
    dbkkbd
    dkbbbd
    .dbbd.
    ..kb..
    .KeSK.
    .KSlK.
    ..kb..
    ..kb..
    ..db..
  `),
  flame: [
    spr(`
      ....R..
      ...RO..
      ..ROOR.
      ..ROgR.
      .ROgygR
      .ROyWyO
      .ROgyOR
      ..ROOR.
      ...RR..
    `),
    spr(`
      ..R....
      ..RO...
      ..ROR..
      .ROgOR.
      .ROgyOR
      .RgyWyR
      .ROgyOR
      ..ROOR.
      ...RR..
    `),
    spr(`
      .......
      ...R...
      ...OR..
      ..ROgR.
      .ROgyOR
      .RgyWgR
      .ROgyOR
      ..ROOR.
      ...RR..
    `),
  ],
  fire: [
    spr(`
      ....R....
      ....RR...
      ...ROR...
      ...ROOR..
      ..ROgOR..
      ..ROgyOR.
      .ROgyyOR.
      .ROgyygOR
      .RgyWWygR
      .ROgyygOR
      ..RROORR.
    `),
    spr(`
      ...R.....
      ...RR....
      ..RROR...
      ..ROOR...
      ..ROgOR..
      .ROOgyOR.
      .ROgyyOR.
      .ROgyygOR
      .RgyWWygR
      .ROgyygOR
      ..RROORR.
    `),
    spr(`
      .........
      .....R...
      ....ROR..
      ...ROOR..
      ..ROOgR..
      ..ROgyOR.
      .ROgyyOR.
      .ROgyygOR
      .RgyWWygR
      .ROgyygOR
      ..RROORR.
    `),
  ],
  teepee: spr(`
    ....d.d....
    ...dkdkd...
    ..dkbdbkd..
    .dtbd.dbkd.
    dtbd...dbkd
    dbd.....dbd
    dd.......dd
  `),
  skull: spr(`
    .ddddd.
    dcccctd
    dcccctd
    dKKcKKd
    dcctctd
    .dcdcd.
    ..ddd..
  `),
  bone: spr(`
    .dd...dd.
    dccdddctd
    dtcccccd.
    .dd...dd.
  `),
  bone2: spr(`
    ..dd.
    .dccd
    .dctd
    .dcd.
    dcd..
    dctd.
    .dd..
  `),
  ribs: spr(`
    ..ddddddd..
    .dcdcdcdcd.
    dcd.d.d.dcd
    dtd.d.d.dtd
    .dd.d.d.dd.
    ....ddd....
  `),
  shroomR: spr(`
    ....dd....
    ...dPrd...
    ..dPrrrd..
    ..dmmmmd.d
    ...dcd.dPd
    ...dcd.dmd
    ...dtd..d.
  `),
  shroomT: spr(`
    ..ddd....
    .dtckd...
    dtkkkbd..
    dbbbbbddd
    .dcd.dtkd
    .dcd.dbd.
    .dtd..d..
  `),
  shroomG: spr(`
    ...nn.....
    ..nCBn....
    .nCBBun...
    .nuuuun.n.
    ..nsn..nBn
    ..nsn..nun
    ..nen...n.
  `),
  sack: spr(`
    ...dd....
    ..dctd...
    ...dd....
    ..dkkkd..
    .dtkkkbd.
    dkttkkkbd
    dktkkkkbd
    dkkkkkbbd
    .dkkbbbd.
    ..ddddd..
  `),
  banner: spr(`
    dd..........dd
    dbkkkkkkkkkkbd
    .dmrrrrrrrrmd.
    .dmrPrrrrrrmd.
    .dmrrrrrrrrmd.
    .dmrrcccctrmd.
    .dmrccccctrmd.
    .dmrcKKcKKrmd.
    .dmrcKKcKKrmd.
    .dmrcccdcttmd.
    .dmrrcccctrmd.
    .dmrrcdcdtrmd.
    .dmrrrrrrrrmd.
    .dmrrrrrrrrmd.
    .dmmrrrrrmmmd.
    ..dmrrdmrrmd..
    ..dmrd.dmrd...
    ...dd...dd....
  `),
  arrow: spr(`
    dd....
    dgd...
    dygd..
    .dygd.
    ..dygd
    .dygd.
    dygd..
    dgd...
    dd....
  `),
  logEnd: spr(`
    .ddd.
    dctcd
    dtktd
    dtkbd
    dctcd
    .ddd.
  `),
  lantern: [
    spr(`
      ...K...
      ..KeK..
      .KSesK.
      KSeeeSK
      KgyyygK
      KyWyygK
      KgyyOgK
      KOggOOK
      KSeeeSK
      .KKKKK.
    `),
    spr(`
      ...K...
      ..KeK..
      .KSesK.
      KSeeeSK
      KggyygK
      KyyWygK
      KgyyygK
      KOgOgOK
      KSeeeSK
      .KKKKK.
    `),
    spr(`
      ...K...
      ..KeK..
      .KSesK.
      KSeeeSK
      KgyygOK
      KgyWyyK
      KOyyggK
      KOggOOK
      KSeeeSK
      .KKKKK.
    `),
  ],
  pick: spr(`
    ....KKKK....
    ..KKseeeKK..
    .KseKKKKSeK.
    Kse.KkbK.KeK
    KK..KkbK..KK
    ....Kkb.....
    ...Kkb......
    ...Kkb......
    ..Kkb.......
    ..Kkb.......
    .Kkb........
    .Kkb........
    Kkb.........
    Kbd.........
  `),
  wheel: spr(`
    .KKKK.
    KSeeSK
    KeKKSK
    KeKKlK
    KSllSK
    .KKKK.
  `),
  fern: spr(`
    .....L......
    .L...G....L.
    .GG..G...GG.
    ..GG.GL.GF..
    L..GFGFGF..G
    .GG.FGFF.GF.
    ..FFDFDFFF..
    ...DDDDDD...
  `),
  sign: spr(`
    ddddddddddd
    dcttttttttd
    dtrmtttrmkd
    dtkrmtkrmkd
    dttkrmrmkkd
    dtttkrmkkbd
    dttkrmrmkbd
    dtkrmkkrmbd
    dtrmkkkkrmd
    dkkkkkkbbbd
    ddddddddddd
    ....dkd....
    ....dkd....
    ....dbd....
    ...ddbdd...
  `),
};
S.bannerG = recolor(S.banner, { r: "G", m: "F", P: "L" });
S.web = spr(`
  wwwwwwwwwww
  w..w...w.w.
  w.w...w.w..
  ww...w.w...
  w.wwwwww...
  w.w..ww....
  ww..ww.....
  w..w.w.....
  w.w.w......
  ww.w.......
  www........
  w..........
`, { w: "rgba(192,203,220,0.55)" });

// 나무 상자 (윗면이 보이는 3/4 시점): 윗면은 밝게, 앞면은 판자 + 대각 받침대
function crate(B, x, y, w, h, top = 4) {
  B.shadeOval(x + (w >> 1) + 2, y + h, (w >> 1) + 1, 2);
  const fh = h - top;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      let ch;
      if (edge) ch = "d";
      else if (j < top) ch = j === 1 && i < w - 2 ? "c" : i === 1 ? "t" : i === w - 2 ? "k" : hash(i >> 2, j, x) < 0.2 ? "k" : "t";
      else if (j === top) ch = "d";
      else {
        const fj = j - top;
        if (i === 1) ch = "t";
        else if (i === 2) ch = "k";
        else if (i === w - 2) ch = "d";
        else if (i === w - 3) ch = "b";
        else if (fj === 1) ch = "k";
        else if (fj === fh - 2) ch = "d";
        else {
          const u = (i - 3) / (w - 7), v = (fj - 2) / Math.max(1, fh - 5);
          const dd = (u - v) * (w - 7);
          ch = Math.abs(dd) < 0.8 ? "k" : dd > 0.8 && dd < 1.8 ? "d" : (fj - 1) % 4 === 0 ? "d" : "b";
          if (Math.abs(dd) < 0.8 && v < 0.15) ch = "t";
        }
      }
      B.set(x + i, y + j, ch);
    }
  for (const [a, b] of [[2, top + 2], [w - 4, top + 2], [2, h - 3], [w - 4, h - 3]]) B.set(x + a, y + b, "S");
}

// 바닥에 놓인 바위 + 그림자 (그림자는 오른쪽 아래)
function floorRock(B, cx, by, rx, ry, seed, ramp, o = {}) {
  B.shadeOval(Math.round(cx + 2), Math.round(by), Math.round(rx + 1), Math.max(1, Math.round(ry * 0.45)), -1);
  return rock(B, cx, by - ry + 1, rx, ry, seed, ramp, { flat: 0.45, ...o });
}

// 통나무 (가로로 누운 것, 굵기 6 + 마구리)
function logH(B, x, y, w) {
  B.shadeOval(x + ((w / 2) | 0) + 2, y + 6, ((w / 2) | 0) + 1, 2, -1);
  for (let i = 0; i < w; i++) {
    const k1 = hash(i >> 1, y, 3), k2 = hash(i, y, 4);
    const col = i === 0 ? ["d", "d", "d", "d", "d", "d"] : ["d", k1 < 0.2 ? "t" : "k", k1 > 0.85 ? "b" : "k", k2 < 0.35 ? "d" : "b", k2 > 0.7 ? "d" : "b", "d"];
    for (let r = 0; r < 6; r++) B.set(x + i, y + r, col[r]);
  }
  B.spr(S.logEnd, x + w - 2, y, { lit: false });
}

// 빛 웅덩이 (반투명 + 바둑판 가장자리) — 한 번 구워 두고 매 프레임 알파만 바꾼다
const poolCache = new Map();
function poolCanvas(rx, ry, ch, a) {
  const key = `${rx},${ry},${ch},${a}`;
  if (poolCache.has(key)) return poolCache.get(key);
  const c = bake(rx * 2 + 1, ry * 2 + 1, (x) => {
    for (const s of [1, 0.66, 0.36]) {
      x.fillStyle = rgba(ch, a);
      const ex = rx * s, ey = ry * s;
      for (let j = -ry; j <= ry; j++)
        for (let i = -rx; i <= rx; i++) {
          const d = (i * i) / (ex * ex) + (j * j) / (ey * ey);
          if (d > 1) continue;
          if (d > 0.7 && (i + j) & 1) continue;
          x.fillRect(i + rx, j + ry, 1, 1);
        }
    }
  });
  poolCache.set(key, c);
  return c;
}
function drawPool(ctx, cx, cy, rx, ry, ch, a, alpha = 1) {
  if (alpha <= 0) return;
  const c = poolCanvas(rx, ry, ch, a);
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(c, Math.round(cx - rx), Math.round(cy - ry));
  ctx.restore();
}
// 불빛 깜빡임 (0~1, 불규칙)
const flick = (t, k) => 0.5 + 0.25 * Math.sin(t * 9.1 + k * 2.3) + 0.25 * Math.sin(t * 15.7 + k * 5.1);

// 바위벽 줄 쌓기 (뒤쪽 줄부터)
function rockRows(B, ramp, rows, bias, extra = {}) {
  for (const r of rows) {
    let x = -8 + hash(r.s, 0, 1) * 8, k = 0;
    while (x < W + 12) {
      const big = hash(k, r.s, 8) < (r.big || 0);
      const rx = (r.rx[0] + hash(k, r.s, 2) * (r.rx[1] - r.rx[0])) * (big ? 1.4 : 1);
      const ry = (r.ry[0] + hash(k, r.s, 3) * (r.ry[1] - r.ry[0])) * (big ? 1.15 : 1);
      const cy = r.cy + (hash(k, r.s, 4) - 0.5) * (r.jy || 5) - (big ? 2 : 0);
      const o = { b: r.b, bias, outline: r.outline, flat: r.flat, facets: r.facets, fw: r.fw, rough: r.rough, leaf: r.leaf, rim: r.rim, cracks: r.cracks };
      if (extra.speck && hash(k, r.s, 9) < extra.speck[3]) o.speck = extra.speck;
      rock(B, x, cy, rx, ry, r.s + k, ramp, o);
      x += r.step * (0.7 + hash(k, r.s, 5) * 0.6) * (big ? 1.3 : 1);
      k++;
    }
  }
}

// 벽 밑 돌무더기: 크고 작은 돌을 불규칙하게 (가끔 비고, 가끔 몰림)
function baseRubble(B, RK, bias, seed) {
  let x = 2;
  for (let k = 0; x < W + 4; k++) {
    const r = hash(k, 1, seed);
    if (r < 0.15) {
      x += 6 + r * 30;
      continue;
    }
    const big = r > 0.85;
    const rx = big ? 6 + hash(k, 2, seed) * 3 : 2 + hash(k, 2, seed) * 3.5;
    const ry = big ? 4.5 : 1.8 + hash(k, 3, seed) * 2;
    rock(B, x, 45 - ry * 0.4 + hash(k, 4, seed) * 1.5, rx, ry, seed + k, RK, { flat: 0.3, b: 0.15, bias, rim: big });
    x += rx * (1.1 + hash(k, 5, seed) * 1.2);
  }
}
// 좌우 옆벽 (바위 기둥). 오른쪽은 출구 구멍(GAP), 왼쪽은 들어온 길(ENT)
function sideRocks(B, ramp, bias, light, seed) {
  for (const side of [0, 1]) {
    const x0 = side ? IN_R : 0, x1 = side ? W : IN_L;
    const g0 = side ? GAP_T : ENT_T, g1 = side ? GAP_B : ENT_B;
    for (let y = IN_T - 6; y < H; y++) {
      if (y > g0 && y < g1) continue;
      for (let x = x0; x < x1; x++) B.set(x, y, "K");
    }
    let y = IN_T - 4, k = 0;
    while (y < H + 6) {
      const ry = 5 + hash(k, side, seed) * 3;
      const cy = y + ry * 0.6;
      if (!(cy > g0 - 4 && cy < g1 + 4)) {
        const rx = 6 + hash(k, side, seed + 1) * 4;
        const cx = side ? IN_R + 6 + hash(k, 3, seed) * 6 : IN_L - 4 - hash(k, 3, seed) * 4;
        rock(B, cx, cy, rx, ry, seed + k * 7 + side * 100, ramp, { bias: (x, y) => bias(x, y) - 0.6 + 0.3 * (light(x, y) - 2) });
      }
      y += ry * 1.25;
      k++;
    }
    // 구멍 위아래 큰 문설주 바위
    const jx = side ? IN_R + 8 : IN_L - 4;
    const jb = (x, y) => bias(x, y) + 0.35 * (light(x, y) - 2);
    rock(B, jx, g0 - 4, 10, 8, seed + 300 + side, ramp, { bias: jb });
    rock(B, jx - (side ? 2 : -1), g1 + 4, 11, 8, seed + 310 + side, ramp, { bias: jb, flat: 0.5 });
  }
}
// 맨 아래 가장자리 (아래쪽 벽 윗면)
function bottomRocks(B, ramp, seed, b = -1) {
  for (let x = 0; x < W; x++) for (let y = IN_B + 4; y < H; y++) B.set(x, y, "K");
  for (let k = 0; k < 32; k++) {
    const x = k * 10.5 + hash(k, 1, seed) * 6;
    rock(B, x, IN_B + 7 + hash(k, 2, seed) * 3, 5 + hash(k, 3, seed) * 4, 3 + hash(k, 4, seed) * 2, seed + k, ramp, { b, flat: 0.5 });
  }
}

// ═════════ 1단계: 고블린 굴 ═════════
const CAVE = {
  floor: ["K", "d", "b", "k", "o"],
  rock: ["K", "d", "b", "k", "o", "t"],
  torches: [[62, 24], [154, 22], [240, 24]],
  fire: [118, 150],
};
function caveLight(open) {
  return (x, y) => {
    let v = 2;
    for (const [tx] of CAVE.torches) v += 1.35 * pool(x, y, tx, 55, 44, 21);
    v += 2.1 * pool(x, y, CAVE.fire[0], CAVE.fire[1] - 2, 44, 22);
    if (open) v += 1.9 * pool(x, y, 326, 98, 50, 28);
    v += (vnoise(x, y, 30, 11) - 0.5) * 0.45;
    return v - edgeDark(x, y, open);
  };
}
const caveWallLight = (x, y) => {
  let b = 0;
  for (const [tx, ty] of CAVE.torches) b += 1.7 * Math.max(0, 1 - Math.hypot(x - tx, (y - ty + 6) * 1.2) / 36);
  return b;
};

function caveRoom(B, open) {
  const light = caveLight(open);
  const off = new Int8Array(W * H);
  // 바닥: 어두운 흙 얼룩, 금, 돌멩이
  speckle(off, 23);
  for (const [x, y, rx, ry, s] of [[258, 132, 7, 3, 3], [176, 164, 9, 2, 5], [28, 96, 4, 6, 7]]) patch(off, x, y, rx, ry, -1, s);
  [[40, 132, 18, 1], [146, 70, 13, 1], [226, 140, 16, -1], [70, 164, 11, 1], [268, 112, 10, -1], [196, 58, 9, 1], [30, 72, 8, 1], [186, 92, 7, 1]].forEach(([x, y, l, d], i) => crack(off, x, y, l, 50 + i, d));
  scatter(off, 45, 21, PEB.slice(2));
  const lit = floorPass(B, light, off, () => CAVE.floor);
  B.light = lit;

  // 위쪽 벽: 틈은 깊은 어둠, 뒤쪽 줄은 어둡고 앞쪽 줄일수록 밝고 크다
  const RK = CAVE.rock;
  for (let x = 0; x < W; x++) for (let y = 0; y < IN_T - 2; y++) B.set(x, y, "K");
  rockRows(B, RK, [{ cy: 26, rx: [6, 9], ry: [5, 7], step: 9, b: -1.4, s: 50, jy: 26, outline: "K", rim: false }], caveWallLight);
  rockRows(B, RK, [
    { cy: 8, rx: [8, 13], ry: [6, 8], step: 15, b: -1.2, s: 100, outline: "K", jy: 6 },
    { cy: 19, rx: [10, 16], ry: [7, 9], step: 18, b: -0.6, s: 200, big: 0.2 },
    { cy: 31, rx: [9, 16], ry: [7, 10], step: 19, b: 0, s: 300, big: 0.25 },
  ], caveWallLight);
  baseRubble(B, RK, caveWallLight, 400);
  sideRocks(B, RK, caveWallLight, lit, 500);
  bottomRocks(B, RK, 900);

  // ── 소품 ──
  B.webs = [[0, 0, false], [W - 11, 0, true]];
  for (const [tx, ty] of CAVE.torches) B.spr(S.torch, tx - 3, ty, { lit: false });
  B.spr(S.banner, 100, 8, { lit: false, shift: -1 });
  B.spr(S.bannerG, 196, 9, { lit: false, shift: -1, flip: true });
  // 상자 더미 (왼쪽 위 구석)
  crate(B, 17, 48, 17, 16, 5);
  crate(B, 21, 36, 13, 13, 4);
  crate(B, 34, 54, 12, 11, 4);
  B.spr(S.sack, 46, 55);
  // 모닥불: 돌 둘레 + 재 + 장작 (불꽃은 매 프레임)
  const [fx, fy] = CAVE.fire;
  B.shadeOval(fx, fy + 1, 12, 4, -1, false);
  B.shadeOval(fx, fy + 1, 7, 2, -1, false);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    rock(B, fx + Math.cos(a) * 10, fy + Math.sin(a) * 4, 2.3 + hash(i, 1, 77), 1.8, 700 + i, ["K", "l", "S", "e", "s"], { facets: 0, base: 1.6, gain: 1.8, flat: 0.3 });
  }
  for (const [ex, ey, c] of [[-4, 1, "R"], [3, 2, "m"], [-1, 2, "O"], [5, 0, "m"], [-6, 0, "d"]]) B.set(fx + ex, fy + ey, c);
  B.spr(S.teepee, fx - 5, fy - 6, { lit: false });
  // 꼬치 (Y자 막대 두 개 + 고기)
  for (const sx of [-10, 10]) {
    B.line(fx + sx, fy - 1, fx + sx, fy - 12, "d");
    B.line(fx + sx + (sx < 0 ? 1 : -1), fy - 2, fx + sx + (sx < 0 ? 1 : -1), fy - 11, "k");
    B.set(fx + sx - 1, fy - 13, "d");
    B.set(fx + sx + 1, fy - 13, "d");
  }
  B.line(fx - 11, fy - 12, fx + 11, fy - 12, "d");
  B.rect(fx - 3, fy - 15, 7, 5, "d");
  B.rect(fx - 2, fy - 14, 5, 3, "m");
  B.rect(fx - 2, fy - 14, 3, 1, "R");
  B.set(fx - 2, fy - 13, "o");
  // 통나무 의자
  logH(B, fx - 32, fy + 6, 16);
  logH(B, fx + 17, fy - 9, 12);
  // 뼈·해골
  B.shadeOval(216, 159, 5, 1);
  B.spr(S.skull, 212, 152);
  B.spr(S.bone, 221, 158);
  B.spr(S.bone2, 204, 155);
  B.spr(S.bone, 266, 59, { flip: true });
  B.spr(S.ribs, 250, 154);
  // 버섯
  B.spr(S.shroomR, 22, 156);
  B.spr(S.shroomT, 186, 46);
  B.spr(S.shroomR, 278, 47, { flip: true });
  B.spr(S.shroomT, 84, 47, { flip: true });
  // 큰 돌
  floorRock(B, 30, 171, 11, 8, 801, RK, { bias: () => 0.2 });
  floorRock(B, 284, 170, 10, 7, 802, RK, { bias: () => 0.2 });
  floorRock(B, 168, 52, 5, 4, 803, RK, { bias: () => 0.6 });
  floorRock(B, 290, 62, 6, 5, 804, RK, { bias: () => 0.4 });
  doorCave(B, open);
}

// 출구: 고블린 가시 바리케이드 — 끝을 깎은 통나무가 방 쪽을 겨눈다 (닫힘) / 옆으로 치운 통나무 + 발자국 (열림)
function doorCave(B, open) {
  for (let y = GAP_T + 1; y < GAP_B; y++) for (let x = IN_R + 3; x < W; x++) if (B.get(x, y) !== "K" && !open) B.set(x, y, x > IN_R + 9 ? "K" : "d");
  if (!open) {
    // 뒤 기둥 두 개
    for (const px of [IN_R + 3, IN_R + 11]) timberV(B, px, GAP_T - 2, GAP_B - GAP_T - 2);
    const logs = [[GAP_T + 6, 289, 31], [GAP_T + 14, 293, 27], [GAP_T + 22, 287, 33], [GAP_T + 30, 292, 28], [GAP_T + 38, 288, 32]];
    for (const [y, x, len] of logs) spikeLog(B, x, y, len, y);
    // 밧줄로 묶은 자리
    for (const [y] of logs) for (const px of [IN_R + 4, IN_R + 12]) {
      for (let r = 0; r < 5; r++) B.set(px + 1 + (r & 1), y + r, r === 0 || r === 4 ? "d" : r & 1 ? "c" : "t");
      B.set(px + 3, y + 1, "d");
      B.set(px + 3, y + 3, "d");
    }
    // 꼭대기 해골 장대
    B.line(IN_R + 8, GAP_T + 6, IN_R + 8, GAP_T - 8, "d");
    B.line(IN_R + 7, GAP_T + 5, IN_R + 7, GAP_T - 7, "k");
    B.spr(S.skull, IN_R + 4, GAP_T - 13, { lit: false });
  } else {
    // 치운 통나무: 아래 문설주 앞에 쌓아 둠
    spikeLog(B, 284, GAP_B + 1, 26, 7);
    spikeLog(B, 289, GAP_B + 6, 24, 8);
    timberV(B, IN_R + 12, GAP_T - 6, 12);
    // 발자국이 출구로
    for (let i = 0; i < 5; i++) {
      const x = 252 + i * 10, y = 95 + (i % 2) * 6;
      for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [3, 1]]) B.shade(x + dx, y + dy, -1);
    }
  }
}
// 끝을 깎은 통나무 (왼쪽이 뾰족, 굵기 5)
function spikeLog(B, x, y, len, s) {
  for (let i = 0; i < len; i++) {
    const X = x + i;
    const taper = i < 5 ? Math.round((5 - i) * 0.45) : 0;
    for (let r = taper; r < 5 - taper; r++) {
      let ch = r === taper || r === 4 - taper ? "d" : r === 1 ? "t" : r === 2 ? "k" : "b";
      if (i < 5 && r > taper && r < 4 - taper) ch = r <= 2 ? "c" : "t";
      else if (i >= 5 && r === 2 && hash(i, s, 3) < 0.15) ch = "b";
      else if (i >= 5 && r === 3 && hash(i, s, 4) < 0.2) ch = "d";
      B.set(X, y + r, ch);
    }
  }
  B.set(x - 1, y + 2, "d");
}

function animCave(ctx, ox, oy, t) {
  CAVE.torches.forEach(([tx, ty], k) => {
    const f = flick(t, k);
    drawPool(ctx, ox + tx, oy + 56, 38, 15, "g", 0.045, 0.55 + f * 0.45);
    drawPool(ctx, ox + tx, oy + ty - 4, 10, 9, "y", 0.07, 0.5 + f * 0.5);
    blit(ctx, S.flame[Math.floor(t * 9 + k * 1.7) % 3], ox + tx - 3, oy + ty - 8);
  });
  const [fx, fy] = CAVE.fire;
  const f = flick(t, 9);
  drawPool(ctx, ox + fx, oy + fy - 1, 34 + Math.round(f * 2), 15, "O", 0.05, 0.6 + f * 0.4);
  drawPool(ctx, ox + fx, oy + fy - 6, 10, 9, "y", 0.07, 0.6 + f * 0.4);
  blit(ctx, S.fire[Math.floor(t * 10) % 3], ox + fx - 4, oy + fy - 11);
  // 불티
  for (let i = 0; i < 5; i++) {
    const p = (t * 0.8 + i / 5 + hash(i, 1, 5)) % 1;
    const x = fx + Math.round(Math.sin(p * 7 + i * 2) * 3 + (hash(i, 2, 5) - 0.5) * 6);
    const y = fy - 11 - Math.round(p * 24);
    if (p < 0.85) dot(ctx, ox + x, oy + y, p < 0.3 ? "y" : p < 0.6 ? "g" : "O");
  }
}

// ═════════ 2단계: 버려진 광산 ═════════
const MINE = {
  floor: ["K", "n", "l", "S", "e"],
  rock: ["K", "n", "l", "S", "e", "s"],
  posts: [28, 114, 200, 286],
  lamps: [[71, 18], [157, 18], [243, 18]],
};
function mineLight(open) {
  return (x, y) => {
    let v = 2;
    for (const [lx] of MINE.lamps) v += 1.3 * pool(x, y, lx, 60, 42, 22);
    if (open) v += 1.8 * pool(x, y, 326, 98, 48, 28);
    v += (vnoise(x, y, 30, 31) - 0.5) * 0.45;
    return v - edgeDark(x, y, open);
  };
}
const mineWallLight = (x, y) => {
  let b = 0;
  for (const [lx, ly] of MINE.lamps) b += 1.5 * Math.max(0, 1 - Math.hypot(x - lx, (y - ly - 6) * 1.2) / 34);
  return b;
};
// 레일 중심선: 아래쪽을 가로지르다 오른쪽 출구로 휘어 올라간다
function railPath() {
  const pts = [];
  for (let x = 4; x <= 226; x += 1) pts.push([x, 152, 0]);
  const steps = 90;
  for (let i = 1; i <= steps; i++) {
    const th = (i / steps) * (Math.PI / 2);
    pts.push([226 + 74 * Math.sin(th), 98 + 54 * Math.cos(th), th]);
  }
  for (let x = 301; x <= 322; x++) pts.push([x, 98, Math.PI / 2]);
  return pts;
}
// 판석: 들쭉날쭉한 격자의 보로노이 칸. 이음매는 어둡게, 칸의 왼쪽 위 가장자리는 밝게. 일부 칸은 깨져서 없음
function slabs(off, cw, chh, seed) {
  const GX = Math.ceil(W / cw) + 3, GY = Math.ceil(H / chh) + 3;
  const site = (gx, gy) => [gx * cw + (gy & 1) * (cw / 2) + hash(gx, gy, seed) * cw * 0.6, gy * chh + hash(gx, gy, seed + 1) * chh * 0.6, hash(gx, gy, seed + 2)];
  const grid = [];
  for (let gy = -1; gy < GY - 1; gy++) for (let gx = -1; gx < GX - 1; gx++) grid.push(site(gx, gy));
  const at = (gx, gy) => grid[(gy + 1) * GX + gx + 1];
  for (let y = IN_T + 2; y < IN_B + 2; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (off[i]) continue;
      const cgx = Math.floor(x / cw), cgy = Math.floor(y / chh);
      let d1 = 1e9, d2 = 1e9, s1 = null;
      for (let gy = cgy - 2; gy <= cgy + 1; gy++)
        for (let gx = cgx - 2; gx <= cgx + 1; gx++) {
          if (gx < -1 || gy < -1 || gx > GX - 2 || gy > GY - 2) continue;
          const s = at(gx, gy);
          const dx = x - s[0], dy = (y - s[1]) * 1.3;
          const d = dx * dx + dy * dy;
          if (d < d1) (d2 = d1), (d1 = d), (s1 = s);
          else if (d < d2) d2 = d;
        }
      if (s1[2] < 0.3) continue; // 깨진 칸: 자갈
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      if (e < 1.1) off[i] = -1;
      else if (e < 2.2 && x - s1[0] + (y - s1[1]) * 1.3 < 0) off[i] = 1;
      else if (s1[2] > 0.93 && busy(s1[0], s1[1]) > 0.6) off[i] = -1; // 가장자리에 어두운 판석 한두 장
    }
}
function mineRoom(B, open) {
  const light = mineLight(open);
  const off = new Int8Array(W * H);
  // 바닥: 닳은 판석 (군데군데 깨져 자갈이 드러남) + 석탄 얼룩
  slabs(off, 20, 13, 64);
  speckle(off, 65, 6, 5, 0.45);
  for (const [x, y, rx, ry, s] of [[64, 72, 9, 3, 1], [252, 70, 7, 3, 2], [40, 112, 5, 5, 4], [190, 166, 10, 3, 5]]) patch(off, x, y, rx, ry, -1, s + 40);
  scatter(off, 50, 62, PEB.slice(1));
  const rail = railPath();
  const lit = floorPass(B, light, off, () => MINE.floor);
  B.light = lit;

  // 위쪽 벽: 회청색 돌, 몇 개는 금·구리 광맥
  const RK = MINE.rock;
  for (let x = 0; x < W; x++) for (let y = 0; y < IN_T - 2; y++) B.set(x, y, "K");
  rockRows(B, RK, [
    { cy: 8, rx: [7, 12], ry: [5, 8], step: 13, b: -1.3, s: 1100, outline: "K", facets: 5, rough: 0.35 },
    { cy: 19, rx: [9, 15], ry: [6, 9], step: 16, b: -0.6, s: 1200, facets: 5, rough: 0.35, big: 0.2 },
    { cy: 31, rx: [9, 15], ry: [7, 10], step: 18, b: 0, s: 1300, facets: 5, rough: 0.35, big: 0.25 },
  ], mineWallLight, { speck: ["g", "O", 6, 0.22] });
  baseRubble(B, RK, mineWallLight, 1400);
  // 나무 버팀목: 위 가로보 + 기둥 + 모서리 받침
  timberH(B, 0, 3, W);
  for (const px of MINE.posts) {
    timberV(B, px - 3, 8, 40);
    B.line(px + 3, 9, px + 9, 9 + 6, (x, y) => (B.set(x, y, "d"), B.set(x, y + 1, "k"), B.set(x, y + 2, "b"), B.set(x, y + 3, "d")));
    B.line(px - 4, 9, px - 10, 9 + 6, (x, y) => (B.set(x, y, "d"), B.set(x, y + 1, "t"), B.set(x, y + 2, "k"), B.set(x, y + 3, "d")));
    B.shadeOval(px + 1, 48, 5, 1);
  }
  // 판자 벽 (두 칸에만, 하나는 부서짐)
  planks(B, MINE.posts[0] + 3, 24, MINE.posts[1] - MINE.posts[0] - 6, 20, 0);
  planks(B, MINE.posts[2] + 3, 28, MINE.posts[3] - MINE.posts[2] - 6, 16, 1);
  sideRocks(B, RK, mineWallLight, lit, 1500);
  bottomRocks(B, RK, 1900);
  B.webs = [[0, 10, false], [W - 11, 10, true]];
  // 레일: 받침목 → 쇠 레일
  drawRails(B, rail);
  // 등불 고리 (등불은 매 프레임)
  for (const [lx, ly] of MINE.lamps) for (let y = 9; y < ly; y++) B.set(lx, y, y & 1 ? "S" : "e");
  // 수정 무더기 (반짝임은 매 프레임)
  for (const c of MINE_CRYSTALS) crystalCluster(B, c);
  // 부서진 수레 + 빠진 바퀴 + 쏟아진 광석
  mineCart(B, 28, 137);
  B.shadeOval(68, 158, 4, 1);
  B.spr(S.wheel, 64, 152);
  for (let i = 0; i < 7; i++) floorRock(B, 70 + i * 4 + hash(i, 1, 3) * 3, 146 + hash(i, 2, 3) * 3 - (i < 3 ? 2 : 0), 1.8 + hash(i, 3, 3) * 1.5, 1.6 + hash(i, 4, 3), 2100 + i, RK, { fw: 0, speck: i % 2 ? ["g", "y", 2] : null, b: 0.8 });
  B.shadeOval(104, 47, 5, 1);
  B.spr(S.pick, 98, 34, { lit: false });
  crate(B, 270, 50, 14, 13, 4);
  for (const [x, y, r, s] of [[20, 168, 9, 1], [128, 54, 4, 2], [188, 54, 5, 3], [292, 168, 8, 4], [230, 166, 5, 5]]) floorRock(B, x, y, r, r * 0.75, 2200 + s, RK, { facets: 5, rough: 0.35, bias: () => 0.3 });
  doorMine(B, open);
}
// 광차: 쇠로 된 통 (위가 넓은 사다리꼴, 리벳 띠, 녹 얼룩) + 광석 더미. 오른쪽 바퀴가 빠져 그쪽이 내려앉음
function mineCart(B, x, y) {
  const w = 28;
  B.shadeOval(x + 15, y + 19, 15, 2);
  const sink = (i) => (i > 15 ? Math.min(2, (i - 15) >> 2) : 0);
  const put = (i, j, ch) => B.set(x + i, y + j + sink(i), ch);
  // 바퀴 (왼쪽 하나만, 몸통 뒤)
  const WH = [".KKK.", "KeSSK", "KSKlK", "KSllK", ".KKK."];
  WH.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && put(5 + i, 13 + j, ch)));
  // 위 테두리 + 안쪽 어둠
  for (let i = 0; i < w; i++)
    for (let j = 0; j < 5; j++) {
      if ((i === 0 || i === w - 1) && (j === 0 || j === 4)) continue;
      let ch = "K";
      if (j > 0 && j < 4 && i > 0 && i < w - 1) ch = j === 1 ? (i < 5 ? "s" : "e") : i === 1 ? "e" : i === w - 2 ? "S" : "K";
      put(i, j, ch);
    }
  // 광석 더미: 테두리 위로 솟은 덩이들 (금 알갱이)
  for (let k = 0; k < 7; k++) {
    const i = 4 + k * 3.3, up = Math.round(2.6 * Math.sin(((k + 0.5) / 7) * Math.PI));
    rock(B, x + i, y + 2 - up + sink(Math.round(i)), 2.6 + hash(k, 1, 77) * 0.8, 2.2, 7700 + k, MINE.rock, { b: 0.7, fw: 0, rim: true, cracks: false, speck: k % 2 ? ["g", "y", 1] : null });
  }
  // 앞판 (쇠): 아래로 갈수록 좁아짐
  for (let j = 5; j < 15; j++) {
    const inset = Math.min(4, Math.floor((j - 5) / 2.3));
    for (let i = inset; i < w - inset; i++) {
      const L = i - inset, R = w - 1 - inset - i;
      let ch;
      if (L === 0 || R === 0 || j === 14) ch = "K";
      else if (j === 5) ch = L < 4 ? "s" : "e";
      else if (j === 8 || j === 12) ch = "l";
      else if (L === 1) ch = "s";
      else if (R === 1) ch = "l";
      else if (R < 6) ch = "S";
      else ch = "e";
      if ((j === 8 || j === 12) && i % 4 === 2) ch = "s"; // 리벳
      if (ch !== "K" && j > 5 && hash(i >> 1, j >> 1, 76) < 0.12) ch = j > 10 ? "b" : "k"; // 녹
      put(i, j, ch);
    }
  }
  // 찌그러진 자국
  put(18, 10, "l"); put(19, 10, "S"); put(18, 11, "S"); put(19, 9, "s");
}
const MINE_CRYSTALS = [
  { x: 164, y: 46, c: "b", s: [[0, 9, -0.25], [4, 16, 0.1], [9, 11, 0.3], [13, 6, 0.4]] },
  { x: 258, y: 167, c: "b", s: [[0, 8, -0.25], [4, 13, 0], [9, 8, 0.3]] },
  { x: 32, y: 55, c: "p", s: [[0, 7, -0.3], [4, 12, 0], [8, 7, 0.35]] },
];
const CRY = { b: ["n", "u", "B", "C", "W"], p: ["n", "p", "M", "P", "W"] };
function crystal(B, x, fy, h, lean, ramp, w = 5) {
  for (let j = 0; j < h; j++) {
    const y = fy - j;
    const sx = Math.round(x + j * lean);
    const fromTop = h - 1 - j;
    for (let i = 0; i < w; i++) {
      if (fromTop === 0 && (i < 1 || i > w - 2)) continue;
      if (fromTop === 1 && (i === 0 || i === w - 1) && w > 4) continue;
      const edge = i === 0 || i === w - 1 || fromTop === 0;
      let ch = edge ? ramp[0] : i === 1 ? (fromTop < 3 ? ramp[4] : ramp[3]) : i === w - 2 ? ramp[1] : ramp[2];
      if (!edge && i > 1 && j < 2) ch = ramp[1];
      B.set(sx + i, y, ch);
    }
  }
}
function crystalCluster(B, c) {
  const ramp = CRY[c.c];
  B.shadeOval(c.x + 6, c.y + 1, 8, 2);
  for (const [dx, h, lean] of c.s) crystal(B, c.x + dx, c.y, h, lean, ramp);
  rock(B, c.x + 7, c.y + 1, 9, 2.5, c.x, MINE.rock, { flat: 0.2, b: 0.3, cracks: false });
}
function timberH(B, x, y, w) {
  for (let i = 0; i < w; i++) {
    const k = hash(i, y, 7) < 0.1;
    B.set(x + i, y, "d");
    B.set(x + i, y + 1, k ? "k" : "t");
    B.set(x + i, y + 2, "k");
    B.set(x + i, y + 3, k ? "d" : "k");
    B.set(x + i, y + 4, "b");
    B.set(x + i, y + 5, "d");
  }
}
function timberV(B, x, y, h) {
  for (let j = 0; j < h; j++) {
    const k = hash(j, x, 7) < 0.1;
    B.set(x, y + j, "d");
    B.set(x + 1, y + j, "t");
    B.set(x + 2, y + j, k ? "b" : "k");
    B.set(x + 3, y + j, "k");
    B.set(x + 4, y + j, "b");
    B.set(x + 5, y + j, "d");
  }
  B.rect(x, y + h, 6, 1, "d");
}
function planks(B, x, y, w, h, broken) {
  for (let j = 0; j < h; j++) {
    const row = Math.floor(j / 5), r = j % 5;
    if (broken && row === 1) continue;
    for (let i = 0; i < w; i++) {
      const ch = r === 0 ? "d" : r === 1 ? "t" : r === 4 ? "b" : hash(i >> 2, row, 5) < 0.15 && r === 2 ? "b" : "k";
      B.set(x + i, y + j, i === 0 || i === w - 1 ? "d" : ch);
    }
    if (r === 2) (B.set(x + 2, y + j, "S"), B.set(x + w - 3, y + j, "S"));
  }
  B.rect(x, y + h, w, 1, "d");
  if (broken) {
    // 비스듬히 매달린 판자
    for (let i = 0; i < w - 4; i++) {
      const yy = y + 5 + Math.round((i / (w - 4)) * 7);
      B.set(x + 2 + i, yy, "d");
      B.set(x + 2 + i, yy + 1, "t");
      B.set(x + 2 + i, yy + 2, "k");
      B.set(x + 2 + i, yy + 3, "b");
      B.set(x + 2 + i, yy + 4, "d");
    }
  }
}
function drawRails(B, pts) {
  // 받침목: 6칸마다 진행 방향에 수직 (가끔 빠지거나 삐뚤어짐)
  let acc = 0, n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x, y, th] = pts[i];
    acc += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    if (acc < 6) continue;
    acc = 0;
    n++;
    if (hash(n, 1, 81) < 0.08) continue;
    const tx = Math.cos(th), ty = -Math.sin(th);
    const nx = -ty * 1.25, ny = tx * 0.75;
    const sh = hash(n, 2, 81) < 0.2 ? 1 : 0;
    for (let k = -5; k <= 5; k++) {
      const X = Math.round(x + nx * k + sh), Y = Math.round(y + ny * k);
      const end = Math.abs(k) === 5;
      B.set(X - Math.round(tx), Y - Math.round(ty), "d");
      B.set(X, Y, end ? "d" : k < -3 ? "t" : "k");
      B.set(X + Math.round(tx), Y + Math.round(ty), end ? "d" : "b");
      B.set(X + 2 * Math.round(tx), Y + 2 * Math.round(ty), "d");
    }
  }
  for (const side of [-1, 1]) {
    pts.forEach(([x, y, th], i) => {
      const tx = Math.cos(th), ty = -Math.sin(th);
      const nx = -ty * 1.25, ny = tx * 0.75;
      const X = Math.round(x + nx * 3.5 * side), Y = Math.round(y + ny * 3.5 * side);
      if (th < 0.6) {
        B.set(X, Y - 1, hash(i >> 2, side, 82) < 0.2 ? "s" : "e");
        B.set(X, Y, "S");
        B.set(X, Y + 1, "K");
      } else {
        B.set(X - 1, Y, "e");
        B.set(X, Y, "S");
        B.set(X + 1, Y, "K");
      }
    });
  }
  // 끊어진 곳: 레일 한 토막이 휘어 들림
  for (let i = 0; i < 7; i++) {
    const lift = i > 2 ? i - 2 : 0;
    B.set(150 + i, 147 - lift, "e");
    B.set(150 + i, 148 - lift, "S");
    B.set(150 + i, 149 - lift, "K");
  }
}
// 출구: 무너진 바위가 굴을 막음 (닫힘) / 바위를 옆으로 밀어 두고 안쪽에 등불 빛 (열림)
function doorMine(B, open) {
  const R = MINE.rock;
  const bx = IN_R + 9;
  if (!open) {
    for (let y = GAP_T + 1; y < GAP_B; y++) for (let x = IN_R + 4; x < W; x++) if (B.get(x, y) !== "K") B.set(x, y, x > IN_R + 10 ? "K" : "n");
    // 뒤에서 앞으로 쌓인 바위 더미 (구멍을 꽉 채움)
    const heap = [[bx + 6, GAP_T + 12, 9, 8, -0.4], [bx - 2, GAP_T + 20, 8, 7, 0], [bx + 8, GAP_T + 30, 10, 9, 0], [bx - 4, GAP_T + 36, 9, 8, 0.3], [bx + 4, GAP_B - 2, 12, 10, 0.4], [bx - 10, GAP_B - 2, 6, 5, 0.5], [bx - 9, GAP_T + 28, 5, 4, 0.4]];
    heap.forEach(([x, by, rx, ry, b], k) => floorRock(B, x, by, rx, ry, 3001 + k * 13, R, { b, fw: 0.45, rough: 0.35 }));
    for (let i = 0; i < 12; i++) floorRock(B, bx - 26 + i * 2.6 + hash(i, 1, 9) * 2, GAP_B + 3 - hash(i, 2, 9) * 16, 1.4 + hash(i, 3, 9) * 1.4, 1.3, 3110 + i, R, { fw: 0, b: 0.6 });
    // 부러진 버팀목 한 토막이 더미에 박힘
    B.line(bx - 14, GAP_T + 14, bx + 2, GAP_T + 24, (x, y) => (B.set(x, y, "d"), B.set(x, y + 1, "k"), B.set(x, y + 2, "b"), B.set(x, y + 3, "d")));
    B.set(bx - 15, GAP_T + 15, "t");
    B.set(bx - 15, GAP_T + 16, "k");
    // 위험 표지판
    B.shadeOval(286, 112, 4, 1);
    B.spr(S.sign, 279, 97);
  } else {
    floorRock(B, bx + 4, GAP_B + 13, 11, 9, 3002, R, { b: 0.2, fw: 0.45 });
    for (let i = 0; i < 6; i++) floorRock(B, bx - 12 + i * 4, GAP_B + 3 - hash(i, 2, 9) * 4, 1.6 + hash(i, 3, 9), 1.4, 3010 + i, R, { fw: 0, b: 0.5 });
  }
}
function animMine(ctx, ox, oy, t) {
  MINE.lamps.forEach(([lx, ly], k) => {
    const f = flick(t, k + 3);
    const sway = Math.round(Math.sin(t * 1.3 + k) * 0.6);
    drawPool(ctx, ox + lx, oy + 60, 36, 15, "O", 0.05, 0.55 + f * 0.45);
    drawPool(ctx, ox + lx + sway, oy + ly + 5, 11, 10, "y", 0.07, 0.5 + f * 0.5);
    blit(ctx, S.lantern[Math.floor(t * 7 + k * 1.3) % 3], ox + lx - 3 + sway, oy + ly);
  });
  // 수정 반짝임
  MINE_CRYSTALS.forEach((c, k) => {
    const g = 0.5 + 0.5 * Math.sin(t * 2.2 + k * 2);
    drawPool(ctx, ox + c.x + 6, oy + c.y - 6, 12, 10, c.c === "b" ? "C" : "M", 0.05, 0.5 + 0.5 * g);
    const s = c.s[Math.floor(t * 1.5 + k) % c.s.length];
    const p = (t * 1.5 + k) % 1;
    if (p < 0.45) {
      const x = ox + c.x + s[0] + 1 + Math.round(s[1] * s[2]), y = oy + c.y - s[1] + 2;
      dot(ctx, x, y, "W");
      if (p > 0.1 && p < 0.35) (dot(ctx, x - 1, y, "C"), dot(ctx, x + 1, y, "C"), dot(ctx, x, y - 1, "C"), dot(ctx, x, y + 1, "C"));
    }
  });
}

// ═════════ 3단계: 늑대 소굴 (밤 숲) ═════════
const FOREST = {
  grass: ["K", "n", "D", "F", "G"],
  dirt: ["K", "n", "d", "b", "k"],
  leaf: ["K", "n", "D", "F", "G"],
  bark: ["K", "n", "d", "b", "p"],
  stone: ["K", "n", "l", "S", "e", "s"],
  moon: [[88, 74, 26, 12], [150, 124, 30, 13], [226, 84, 24, 12], [42, 150, 18, 8], [268, 140, 18, 9], [120, 58, 16, 6]],
};
const pathY = (x) => 98 + 5 * Math.sin(x / 47 + 0.6) - 3 * Math.sin(x / 19);
function forestLight(open) {
  return (x, y) => {
    let v = 1.85;
    for (const [mx, my, rx, ry] of FOREST.moon) v += 0.9 * pool(x, y, mx, my, rx, ry) * (0.4 + 1.0 * vnoise(x, y, 6, 99));
    if (open) v += 1.6 * pool(x, y, 326, 98, 46, 26);
    v += (vnoise(x, y, 22, 51) - 0.5) * 0.5;
    return v - edgeDark(x, y, open);
  };
}
function forestRoom(B, open) {
  const light = forestLight(open);
  const off = new Int8Array(W * H);
  const isDirt = (x, y) => {
    const hw = 10 + 4 * vnoise(x, 0, 23, 52) + 2.2 * (hash(x >> 1, y >> 1, 53) - 0.5);
    if (Math.abs(y - pathY(x)) < hw) return true;
    // 소굴 앞 흙바닥
    return pool(x, y, 238, 150, 34, 14) + (hash(x >> 1, y >> 1, 54) - 0.5) * 0.3 > 0.35;
  };
  const dirt = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dirt[y * W + x] = isDirt(x, y) ? 1 : 0;
  // 풀 덤불: 덩어리로 모아서 (가장자리·바위 곁에 많이, 가운데는 드물게). 풀이 찍힌 곳은 풀색
  const TUFT = [["h.h", "bhb", ".b."], ["h..h", ".bb.", ".bb."], [".h.", "hbh", ".b."], ["h...", "b.h.", "bbb."], ["h.", "b."]];
  const tuft = (x, y, m) => {
    stamp(off, x, y, m);
    for (let j = 0; j < m.length; j++) for (let i = 0; i < m[j].length; i++) if (m[j][i] !== "." && y + j < H) dirt[(y + j) * W + x + i] = 0;
  };
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(IN_L + hash(i, 1, 55) * (IN_R - IN_L)), y = Math.floor(IN_T + 2 + hash(i, 2, 55) * (IN_B - IN_T));
    if (dirt[y * W + x] || hash(i, 3, 55) > busy(x, y) + 0.1) continue;
    const n = 2 + Math.floor(hash(i, 4, 55) * 4);
    for (let k = 0; k < n; k++) tuft(x + Math.round((hash(k, i, 56) - 0.5) * 9), y + Math.round((hash(i, k, 57) - 0.5) * 5), TUFT[Math.floor(hash(i, k, 58) * TUFT.length)]);
  }
  // 어두운 풀결 (잔 무늬)
  speckle(off, 61, 7, 5, 0.5, [["x"], ["x.", ".x"], ["x", "x"]]);
  // 길 가장자리에 풀이 삐져나옴
  for (let x = IN_L; x < IN_R; x += 4) {
    const hw = 10 + 4 * vnoise(x, 0, 23, 52);
    for (const sg of [-1, 1]) if (hash(x, sg, 59) < 0.45) tuft(x, Math.round(pathY(x) + sg * hw - (sg < 0 ? 0 : 2)), TUFT[Math.floor(hash(x, sg, 60) * 5)]);
  }
  // 흙길 위 돌멩이
  scatter(off, 40, 71, PEB.slice(1, 4), 0.9);
  const lit = floorPass(B, light, off, (x, y) => (dirt[y * W + x] ? FOREST.dirt : FOREST.grass));
  B.light = lit;

  // 위쪽: 먼 숲(남색 실루엣) → 줄기 → 나무마다 잎 덩이 → 밑동 덤불
  const LF = FOREST.leaf;
  for (let x = 0; x < W; x++) for (let y = 0; y < IN_T + 2; y++) B.set(x, y, "K");
  for (let k = 0; k < 22; k++) rock(B, k * 16 + hash(k, 1, 80) * 10, 6 + hash(k, 2, 80) * 14, 10 + hash(k, 3, 80) * 6, 8 + hash(k, 4, 80) * 5, 2500 + k, ["K", "K", "n", "n", "l"], { rim: false, cracks: false, rough: 0.6, base: 1, gain: 1.2 });
  for (let k = 0; k < 14; k++) {
    const x = k * 24 + hash(k, 1, 81) * 12, w = 4 + Math.floor(hash(k, 2, 81) * 4);
    for (let y = 14; y < IN_T; y++) for (let i = 0; i < w; i++) B.set(x + i, y, i === 0 ? "l" : i < 2 ? "n" : "K");
  }
  const trees = [[20, 12], [58, 15], [102, 11], [138, 17], [186, 12], [222, 16], [262, 12], [288, 14]];
  for (const [x, w] of trees) trunk(B, x, w, 6, IN_T + 1 + (w > 14 ? 1 : 0), x);
  // 나무마다 잎 덩이 3~5개 (크기·높이 제각각, 달빛 쪽인 왼쪽 위가 밝게)
  trees.forEach(([x, w], t) => {
    const n = 3 + Math.floor(hash(t, 1, 83) * 3);
    for (let k = 0; k < n; k++) {
      const cx = x + w / 2 + (hash(t, k, 84) - 0.5) * 34, cy = 2 + hash(k, t, 85) * 16 - (k === 0 ? 2 : 0);
      const rx = 8 + hash(t, k, 86) * 9, ry = 6 + hash(t, k, 87) * 5;
      foliage(B, cx, cy, rx, ry, 2700 + t * 10 + k, -0.6 + (k === n - 1 ? 0.3 : 0) + 0.6 * pool(cx, cy, 96, 4, 70, 26));
    }
  });
  // 늘어진 덩굴 몇 가닥
  for (const [x, len] of [[44, 14], [124, 10], [208, 16], [246, 9]]) for (let j = 0; j < len; j++) B.set(x + (j > len / 2 ? 1 : 0), 14 + j, j % 3 === 2 ? "G" : "F");
  // 나무 아래 덤불·고사리 (번갈아, 크기·밝기 다르게)
  for (let k = 0; k < 15; k++) {
    const x = 6 + k * 21 + hash(k, 1, 82) * 9;
    const r = hash(k, 2, 82);
    if (r < 0.6) foliage(B, x, 42, 7 + hash(k, 3, 82) * 4, 5 + hash(k, 4, 82) * 2.5, 2900 + k, -0.5 + hash(k, 5, 82) * 0.4, { flat: 0.5 });
    else B.spr(S.fern, x - 6, 39 + Math.floor(hash(k, 6, 82) * 3), { lit: false, shift: r < 0.8 ? -1 : 0, flip: r > 0.7 });
  }
  forestSides(B, lit, open);

  // ── 소품 ──
  // 큰 바위 (이끼 낀)
  mossRock(B, 34, 170, 12, 9, 3101);
  mossRock(B, 274, 62, 9, 7, 3102);
  mossRock(B, 150, 170, 6, 4, 3103);
  mossRock(B, 196, 54, 5, 4, 3104);
  // 뼈 무더기 (소굴)
  B.shadeOval(244, 153, 14, 3);
  B.spr(S.ribs, 232, 146);
  B.spr(S.skull, 246, 148);
  B.spr(S.bone, 252, 155);
  B.spr(S.bone2, 226, 151);
  B.spr(S.bone, 108, 158, { flip: true });
  B.spr(S.bone2, 284, 108);
  // 버섯
  B.spr(S.shroomG, 70, 46);
  B.spr(S.shroomG, 252, 47, { flip: true });
  B.spr(S.shroomR, 18, 140);
  B.spr(S.shroomR, 176, 156, { flip: true });
  // 쓰러진 통나무
  logH(B, 60, 160, 22);
  doorForest(B, open);
  // 달빛 (파르스름하게 아주 옅게) — 바닥에 반투명으로
  B.moon = true;
}
const FOREST_SHROOMS = [[74, 49], [256, 50]];
// 잎 덩이: 바깥 실루엣(어두움) 위에 작은 덩이 여러 개 — 덩이마다 왼쪽 위가 밝아 울퉁불퉁한 나무 꼭대기처럼
function foliage(B, cx, cy, rx, ry, seed, b = 0, o = {}) {
  const LF = FOREST.leaf;
  rock(B, cx, cy, rx, ry, seed, LF, { rough: 0.45, bumps: 12, cracks: false, rim: false, b: b - 1.2, flat: o.flat });
  const n = Math.max(3, Math.round((rx * ry) / 14));
  const subs = [];
  for (let k = 0; k < n; k++) {
    const a = hash(k, 1, seed) * Math.PI * 2, r = Math.sqrt(hash(k, 2, seed)) * 0.55;
    subs.push([cx + Math.cos(a) * r * rx, cy + Math.sin(a) * r * ry * 0.9 - ry * 0.12, 2.8 + hash(k, 3, seed) * Math.min(4, rx * 0.35)]);
  }
  subs.sort((p, q) => p[1] - q[1]);
  for (const [x, y, r] of subs) {
    if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 0.75) continue;
    rock(B, x, y, r, r * 0.85, seed + Math.round(x * 7 + y), LF, { outline: "D", rough: 0.3, cracks: false, rim: true, b: b + 0.15 * ((cy - y) / ry), base: 1.3, gain: 1.6 });
  }
  if (o.berries) for (let k = 0; k < 3; k++) B.set(cx + (hash(k, 9, seed) - 0.5) * rx, cy + (hash(k, 8, seed) - 0.3) * ry * 0.8, "r");
}
function trunk(B, x, w, top, foot, seed) {
  for (let y = top; y <= foot; y++) {
    const flare = Math.max(0, y - (foot - 6));
    const l = x - Math.round(flare * 0.6), r = x + w + Math.round(flare * 0.6);
    for (let X = l; X < r; X++) {
      const i = X - l, ww = r - l;
      let ch = i === 0 || i === ww - 1 ? "K" : i < 3 ? "p" : i < ww * 0.55 ? "d" : i < ww - 2 ? "n" : "n";
      if (i === 1 && hash(y >> 2, x, seed) < 0.35) ch = "d";
      // 세로 결
      if (i > 2 && i < ww - 2 && ((i + Math.floor(hash(i, y >> 3, seed) * 2)) % 4 === 0) && hash(i, y >> 1, seed + 1) < 0.7) ch = ch === "d" ? "n" : "K";
      B.set(X, y, ch);
    }
  }
  // 옹이 구멍
  if (w > 12) {
    const kx = x + (w >> 1), ky = top + 18 + Math.floor(hash(seed, 2, 3) * 8);
    B.rect(kx - 1, ky - 1, 4, 5, "K");
    B.rect(kx - 2, ky, 1, 3, "p");
    B.rect(kx, ky - 2, 2, 1, "d");
  }
  // 뿌리
  for (const s of [-1, 1]) {
    const rx = s < 0 ? x - 4 : x + w + 3;
    B.line(rx, foot - 1, rx + s * 5, foot + 3, (X, Y) => (B.set(X, Y, s < 0 ? "p" : "n"), B.set(X, Y + 1, "K")));
  }
}
function mossRock(B, cx, by, rx, ry, seed) {
  B.shadeOval(cx + 2, by, rx + 1, Math.max(1, Math.round(ry * 0.45)), -1);
  const lv = rock(B, cx, by - ry + 1, rx, ry, seed, FOREST.stone, { flat: 0.45, facets: 5, bias: (x, y) => 0.3 * pool(x, y, cx - rx * 0.4, by - ry * 1.6, rx, ry) });
  // 윗면 이끼
  for (let i = -rx; i <= rx; i++)
    for (let j = 0; j < ry; j++) {
      const x = Math.round(cx + i), y = Math.round(by - ry * 2 + 2 + j);
      const ch = B.get(x, y);
      if (!ch || !"lSes".includes(ch)) continue;
      const lim = 1.5 + 2.5 * vnoise(i * 3, 0, 4, seed);
      if (j > lim) continue;
      B.set(x, y, j < 1 && i < 0 ? "G" : hash(i, j, seed) < 0.3 ? "G" : "F");
      break;
    }
  return lv;
}
function forestSides(B, light, open) {
  for (const side of [0, 1]) {
    const x0 = side ? IN_R : 0, x1 = side ? W : IN_L;
    const g0 = side ? GAP_T : ENT_T, g1 = side ? GAP_B : ENT_B;
    for (let y = IN_T - 6; y < H; y++) {
      if (y > g0 && y < g1) continue;
      for (let x = x0; x < x1; x++) B.set(x, y, "K");
    }
    let y = IN_T - 2, k = 0;
    while (y < H + 6) {
      const ry = 6 + hash(k, side, 3300) * 3;
      const cy = y + ry * 0.6;
      if (!(cy > g0 - 4 && cy < g1 + 4)) {
        const rx = 8 + hash(k, side, 3301) * 4;
        const cx = side ? IN_R + 8 + hash(k, 3, 3302) * 6 : IN_L - 5 - hash(k, 3, 3302) * 4;
        foliage(B, cx, cy, rx, ry, 3310 + k * 7 + side * 100, -0.6 + 0.3 * (light(cx, cy) - 2));
      }
      y += ry * 1.2;
      k++;
    }
    const jx = side ? IN_R + 8 : IN_L - 4;
    trunk(B, jx - 5, 10, IN_T - 8, g0 - 2, 3400 + side);
    foliage(B, jx, g1 + 5, 11, 8, 3410 + side, -0.2);
  }
}
// 출구: 가시덤불 (닫힘) / 갈라진 덤불 + 발자국 (열림)
function doorForest(B, open) {
  const bx = IN_R + 8;
  if (!open) {
    for (let y = GAP_T; y < GAP_B; y++) for (let x = IN_R + 4; x < W; x++) B.set(x, y, "K");
    const TH = ["K", "K", "n", "p", "M"];
    foliage(B, bx + 4, GAP_T + 12, 11, 11, 3501, -0.9);
    foliage(B, bx, GAP_B - 13, 13, 12, 3502, -0.6);
    rock(B, bx - 6, GAP_T + 28, 8, 9, 3506, TH, { rough: 0.7, bumps: 11, leaf: true, cracks: false, b: -0.3, rim: false });
    bramble(B, bx - 2, GAP_T + 2, GAP_B - 4, 3503, 6);
  } else {
    foliage(B, bx + 6, GAP_T + 2, 7, 6, 3501, -0.4);
    foliage(B, bx + 4, GAP_B, 8, 6, 3502, -0.3);
    bramble(B, bx + 4, GAP_B, GAP_B + 8, 3504, 2);
    bramble(B, bx + 6, GAP_T - 8, GAP_T, 3505, 2);
    // 늑대 발자국이 출구로
    for (let i = 0; i < 6; i++) {
      const x = 246 + i * 10, y = 96 + (i % 2 ? 4 : -1);
      B.shade(x, y, -1); B.shade(x + 2, y, -1); B.shade(x + 1, y + 1, -1);
      B.shade(x, y + 2, -1); B.shade(x + 1, y + 2, -1); B.shade(x + 2, y + 2, -1);
    }
  }
}
// 가시덩굴: 어두운 덤불 덩이 위로 굵은 줄기가 고리처럼 휘감고, 가시는 드문드문
function bramble(B, cx, y0, y1, seed, n = 6) {
  for (let v = 0; v < n; v++) {
    // 줄기 하나 = 큰 호(arc)
    const ax = cx - 14 + hash(v, 1, seed) * 18, ay = y0 + (v + 0.5) * ((y1 - y0) / n) + (hash(v, 2, seed) - 0.5) * 6;
    const r = 7 + hash(v, 3, seed) * 6, a0 = Math.PI * (0.9 + hash(v, 4, seed) * 0.3), a1 = a0 + Math.PI * (1.0 + hash(v, 5, seed) * 0.5);
    const steps = Math.round(r * (a1 - a0));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const x = Math.round(ax + Math.cos(a) * r * 1.3), y = Math.round(ay + Math.sin(a) * r * 0.8);
      if (x > W + 1) continue;
      const upper = Math.sin(a) < 0;
      B.set(x, y - 1, "K");
      B.set(x, y, upper ? "b" : "d");
      B.set(x, y + 1, upper ? "d" : "K");
      if (upper && i % 4 === 0) B.set(x, y, "k");
      B.set(x, y + 2, "K");
      if (i % 5 === 2) {
        // 가시: 바깥쪽으로 2칸
        const ox = Math.round(Math.cos(a) * 2), oy = Math.round(Math.sin(a) * 2);
        B.set(x + ox, y + oy + (oy < 0 ? -1 : 2), "k");
        if (Math.abs(ox) + Math.abs(oy) > 1) B.set(x + ox * 1.5, y + oy * 1.5 + (oy < 0 ? -1 : 2), "t");
      }
      if (i % 9 === 4) (B.set(x + 1, y - 2, "G"), B.set(x + 2, y - 2, "F"), B.set(x + 2, y - 3, "G"));
    }
  }
  // 열매 몇 알
  for (let k = 0; k < 3; k++) {
    const x = Math.round(cx - 8 + hash(k, 7, seed) * 14), y = Math.round(y0 + 6 + hash(k, 8, seed) * (y1 - y0 - 10));
    B.set(x, y, "r"); B.set(x + 1, y, "m"); B.set(x, y + 1, "m"); B.set(x, y - 1, "P");
  }
}
const FIREFLIES = Array.from({ length: 14 }, (_, i) => [IN_L + 10 + hash(i, 1, 91) * (IN_R - IN_L - 20), 52 + hash(i, 2, 91) * 110, hash(i, 3, 91) * 6.28]);
const WOLF_EYES = [[[232, 40], 0], [[4, 141], 2.1]];
function animForest(ctx, ox, oy, t, open) {
  // 덤불 속에서 가끔 깜빡이는 늑대 눈
  for (const [[ex, ey], ph] of WOLF_EYES) {
    const c = (t * 0.45 + ph) % 4;
    if (c > 2.6 || (c > 1.2 && c < 1.3)) continue;
    drawPool(ctx, ox + ex + 1, oy + ey, 3, 2, "y", 0.12, 1);
    dot(ctx, ox + ex, oy + ey, "y");
    dot(ctx, ox + ex + 3, oy + ey, "y");
  }
  // 빛나는 버섯
  FOREST_SHROOMS.forEach(([x, y], k) => drawPool(ctx, ox + x, oy + y, 9, 6, "C", 0.06, 0.5 + 0.5 * Math.sin(t * 1.7 + k * 2)));
  // 반딧불
  FIREFLIES.forEach(([bx, by, ph], i) => {
    const x = Math.round(ox + bx + Math.sin(t * 0.5 + ph) * 10 + Math.sin(t * 1.3 + ph * 2) * 3);
    const y = Math.round(oy + by + Math.cos(t * 0.4 + ph * 1.7) * 6 + Math.sin(t * 1.9 + ph) * 2);
    const b = Math.sin(t * 2.3 + ph * 3);
    if (b < -0.5) return;
    drawPool(ctx, x, y, 3, 3, "y", 0.12, b > 0 ? 1 : 0.5);
    dot(ctx, x, y, b > 0.3 ? "y" : "g");
  });
}

// ═════════ 굽기 + 그리기 ═════════
const ROOMS = { cave: caveRoom, mine: mineRoom, forest: forestRoom };
const baked = new Map();
const pending = new Set();
function getRoom(theme, open) {
  if (!ROOMS[theme]) theme = "cave";
  const key = theme + (open ? 1 : 0);
  if (baked.has(key)) return baked.get(key);
  // 다른 문 상태도 한가할 때 미리 구워 둔다 (문이 열리는 순간 멈칫하지 않게)
  const other = theme + (open ? 0 : 1);
  if (!baked.has(other) && !pending.has(other)) {
    pending.add(other);
    const later = typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 2000 }) : (f) => setTimeout(f, 300);
    later(() => getRoom(theme, !open));
  }
  const c = bake(W, H, (ctx) => {
    const B = new Buf();
    ROOMS[theme](B, open);
    B.paint(ctx);
    if (B.moon) moonbeams(ctx);
    for (const [x, y, flip] of B.webs || []) blit(ctx, S.web, x, y, { flip });
  });
  baked.set(key, c);
  return c;
}

// 달빛 기둥: 왼쪽 위에서 비스듬히 내려오는 반투명 띠 (가장자리는 바둑판) + 바닥의 푸른 웅덩이
function moonbeams(ctx) {
  for (const [mx, my, rx, ry] of FOREST.moon) {
    const y0 = 0, x0 = mx - (my - y0) * 0.42;
    for (let y = y0; y <= my; y++) {
      const p = (y - y0) / (my - y0);
      const cx = x0 + (mx - x0) * p, hw = rx * (0.35 + 0.4 * p);
      for (let x = Math.floor(cx - hw); x <= cx + hw; x++) {
        const e = Math.abs(x - cx) / hw;
        if (e > 0.75 && (x + y) & 1) continue;
        ctx.fillStyle = rgba("s", e < 0.4 ? 0.05 : 0.035);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.drawImage(poolCanvas(rx, ry, "s", 0.04), mx - rx, my - ry);
  }
}
function drawExitHint(ctx, ox, oy, t, ch) {
  // 출구 쪽에서 새는 빛 + 깜빡이는 화살표
  const f = 0.5 + 0.5 * Math.sin(t * 3);
  drawPool(ctx, ox + 316, oy + 98, 30, 22, ch, 0.06, 0.6 + 0.4 * f);
  const bob = Math.round(Math.sin(t * 4) * 1.5);
  blit(ctx, S.arrow, ox + 284 + bob, oy + 93, { alpha: 0.7 + 0.3 * f });
}

export function drawRoom(ctx, theme, ox, oy, t, o = {}) {
  ox = Math.round(ox);
  oy = Math.round(oy);
  if (!ROOMS[theme]) theme = "cave";
  const open = o.door !== false && !!o.open;
  ctx.drawImage(getRoom(theme, open), ox, oy);
  if (theme === "cave") animCave(ctx, ox, oy, t);
  else if (theme === "mine") animMine(ctx, ox, oy, t);
  else animForest(ctx, ox, oy, t, open);
  if (open) drawExitHint(ctx, ox, oy, t, theme === "forest" ? "s" : "g");
}

// 미리 굽기 (선택): 던전에 들어가며 불러 두면 첫 화면에서 멈칫하지 않는다
export function prebakeRoom(theme) {
  if (!ROOMS[theme]) theme = "cave";
  getRoom(theme, false);
  getRoom(theme, true);
  frontOf(theme);
}

// 앞쪽 그림 (사람 위에 덮임): 아래 가장자리의 얇은 바위·풀 띠와 아래 구석만. 발을 거의 가리지 않게 y 172 아래 위주
const frontBaked = new Map();
function frontOf(theme) {
  if (frontBaked.has(theme)) return frontBaked.get(theme);
  const c = bake(W, H, (ctx) => {
    const B = new Buf(null);
    if (theme === "forest") {
      const G = ["K", "K", "n", "D", "F"];
      for (const [x, y, rx, ry, s] of [[6, 176, 12, 12, 1], [314, 177, 12, 13, 2], [120, 182, 10, 6, 3], [210, 183, 12, 6, 4]]) rock(B, x, y, rx, ry, 4000 + s, G, { rough: 0.7, bumps: 12, leaf: true, cracks: false, b: -0.6, rim: false });
      // 풀잎 실루엣
      for (let x = 0; x < W; x += 2) {
        if (hash(x, 1, 4100) < 0.45) continue;
        const h = 2 + Math.floor(hash(x, 2, 4100) * (x < 24 || x > 296 ? 9 : 5));
        const lean = hash(x, 3, 4100) < 0.5 ? -1 : 1;
        for (let j = 0; j < h; j++) B.set(x + (j > h * 0.6 ? lean : 0), H - 1 - j, j === h - 1 ? "F" : j > h - 3 ? "D" : "n");
      }
    } else {
      const R = theme === "mine" ? ["K", "K", "n", "l", "S"] : ["K", "K", "d", "b", "k"];
      for (const [x, y, rx, ry, s] of [[5, 178, 12, 13, 1], [316, 178, 11, 12, 2], [96, 183, 9, 5, 3], [178, 184, 11, 6, 4], [252, 183, 8, 5, 5]]) rock(B, x, y, rx, ry, 4200 + s, R, { b: -0.4, fw: 0.4, cracks: false });
      if (theme === "mine") {
        // 쓰러진 버팀목 한 토막 (왼쪽 아래)
        for (let i = 0; i < 26; i++) {
          const X = 12 + i, Y = 176 - Math.floor(i / 6);
          B.set(X, Y, "K");
          B.set(X, Y + 1, "b");
          B.set(X, Y + 2, "d");
          B.set(X, Y + 3, "K");
        }
      }
    }
    B.paint(ctx);
  });
  frontBaked.set(theme, c);
  return c;
}
export function drawRoomFront(ctx, theme, ox, oy, t) {
  if (!ROOMS[theme]) theme = "cave";
  ctx.drawImage(frontOf(theme), Math.round(ox), Math.round(oy));
}


// 미리보기: 동굴(닫힘)·광산(열림)·숲(닫힘). ph를 1080으로 주면 나머지 상태 셋도 아래에 더 그린다
export function preview(ctx, W2, H2, t) {
  const list = [["cave", false], ["mine", true], ["forest", false], ["cave", true], ["mine", false], ["forest", true]];
  list.slice(0, Math.max(1, Math.floor(H2 / ROOM_H))).forEach(([th, open], i) => {
    drawRoom(ctx, th, 0, i * ROOM_H, t, { open });
    drawRoomFront(ctx, th, 0, i * ROOM_H, t);
  });
}
