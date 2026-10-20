// 전투 연출 (픽셀): 날아가는 마법, 베기, 할퀴기, 번개, 빛기둥, 운석, 분노, 거미줄, 지진, 파편.
// 좌표는 모두 지금 그림판의 픽셀 (전투는 4배 → 화면에 약 240×135). 모든 점은 정수 자리, 팔레트 색만 쓴다.
// 시간은 기본으로 performance.now(). 미리보기에서는 fx.clock(초)을 직접 정해 멈춘 장면을 그린다.
import { PAL, spr, blit, hash } from "../pixel.js";

// ───── 색 도구 ─────
const RGB = {};
for (const [k, v] of Object.entries(PAL)) RGB[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
// CSS 색(#hex, rgb(), rgba()) 또는 팔레트 글자 → 가장 가까운 팔레트 글자 + 알파
const snapCache = new Map();
function snap(c) {
  if (!c) return ["W", 1];
  if (snapCache.has(c)) return snapCache.get(c);
  let r, g, b, a = 1;
  if (c.length === 1 && RGB[c]) {
    const out = [c, 1];
    snapCache.set(c, out);
    return out;
  }
  if (c[0] === "#") {
    const h = c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1, 7);
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = c.match(/[\d.]+/g) || [255, 255, 255];
    [r, g, b] = m.map(Number);
    if (m[3] != null) a = Number(m[3]);
  }
  let best = "W", bd = 1e9;
  for (const [k, v] of Object.entries(RGB)) {
    const d = (v[0] - r) ** 2 * 0.3 + (v[1] - g) ** 2 * 0.59 + (v[2] - b) ** 2 * 0.11;
    if (d < bd) (bd = d), (best = k);
  }
  const out = [best, a];
  snapCache.set(c, out);
  return out;
}
// 글자 → 단계 [어두움, 중간, 밝음, 가장 밝음]
const RAMP = {};
for (const [keys, ramp] of [
  ["Wse", ["e", "s", "W", "W"]],
  ["rPmh", ["m", "r", "P", "W"]],
  ["ygO", ["O", "g", "y", "W"]],
  ["Ro", ["R", "O", "g", "y"]],
  ["CBu", ["u", "B", "C", "W"]],
  ["LGFD", ["F", "G", "L", "W"]],
  ["Mp", ["p", "M", "P", "W"]],
  ["tckbd", ["b", "k", "t", "c"]],
  ["SlnK", ["l", "S", "e", "s"]],
  ["12", ["2", "1", "c", "W"]],
]) for (const k of keys) RAMP[k] = ramp;
const rampOf = (c) => RAMP[snap(c)[0]] || RAMP.W;

const dot = (ctx, x, y, ch) => {
  ctx.fillStyle = PAL[ch];
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
};
const box = (ctx, x, y, w, h, ch) => {
  ctx.fillStyle = PAL[ch];
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};
const lerp = (a, b, p) => a + (b - a) * p;
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const easeOut = (p) => 1 - (1 - p) * (1 - p);
// 정수 점 선 (fn(x, y, i))
function plotLine(x0, y0, x1, y1, fn) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 600; i++) {
    fn(x0, y0, i);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) (err += dy), (x0 += sx);
    if (e2 <= dx) (err += dx), (y0 += sy);
  }
}
// 타원 테두리 점 (중복 없이)
function ringPts(rx, ry) {
  const pts = [], seen = new Set();
  const n = Math.max(8, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 1.6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * rx), y = Math.round(Math.sin(a) * ry);
    const k = x * 1000 + y;
    if (seen.has(k)) continue;
    seen.add(k);
    pts.push([x, y, a]);
  }
  return pts;
}
// 반투명 채운 타원 (가장자리 바둑판)
// glow = true면 더하기 섞기 (빛이 어두운 바탕에서 탁해지지 않게)
function softOval(ctx, cx, cy, rx, ry, ch, a, glow = false) {
  if (a <= 0 || rx < 1) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  if (glow) ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = PAL[ch];
  cx = Math.round(cx);
  cy = Math.round(cy);
  for (let j = -ry; j <= ry; j++)
    for (let i = -rx; i <= rx; i++) {
      const d = (i * i) / (rx * rx + 0.5) + (j * j) / (ry * ry + 0.5);
      if (d > 1 || (d > 0.6 && (cx + i + cy + j) & 1)) continue;
      ctx.fillRect(cx + i, cy + j, 1, 1);
    }
  ctx.restore();
}

// ───── 그림 조각 ─────
const FB = [
  spr(`
    .......RRR..
    ....mRROOOR.
    ..mRROOggyOR
    .mRROggyyWyO
    ..mRROggyyOR
    ....mRROOOR.
    .......RRR..
  `),
  spr(`
    .......RRR..
    ...m.RROOOR.
    .mRRROOggyOR
    mRROOggyyWyO
    .mRRROggyyOR
    ...mRROOOOR.
    .......RRR..
  `),
  spr(`
    ......RRRR..
    .....RROOOR.
    ...mRROggyOR
    .mRROOgyyWyO
    ...mRROggyOR
    .....RROOOR.
    ......RRRR..
  `),
];
const ICE_E = spr(`
  ...nuu.....
  .nuCCsss...
  nuBBCCCsWW.
  .nuuBBBC...
  ...nnu.....
`);
const ICE_NE = spr(`
  .......sW
  ......sCB
  .....sCB.
  ....sCB..
  ...CCu...
  ..BBu....
  .uun.....
  nn.......
`);
const ORB = spr(`
  ..ppp..
  .pMMMp.
  pMPWPMp
  pMPPPMp
  pMMPMMp
  .pMMMp.
  ..ppp..
`);
const ORB2 = spr(`
  ..ppp..
  .pMMMp.
  pMPPWMp
  pMPPPMp
  pMMMPMp
  .pMMMp.
  ..ppp..
`);
const ORBS = {
  arcane: [ORB, ORB2],
  holy: [ORB, ORB2].map((s) => recol(s, { p: "O", M: "g", P: "y" })),
  dark: [ORB, ORB2].map((s) => recol(s, { p: "K", M: "p", P: "M", W: "P" })),
};
const WEBBALL = [
  spr(`
    .s.s.s.
    s.sWs.s
    .sWsWs.
    sWseeWs
    .sWsWs.
    s.sWs.s
    .s.s.s.
  `),
  spr(`
    ..s.s..
    .ssWss.
    ssWsWss
    .WseeW.
    ssWsWss
    .ssWss.
    ..s.s..
  `),
];
const ROCK = spr(`
  ..KKK..
  .KsseK.
  KseeeSK
  KeeeSlK
  KeSSllK
  .KSllK.
  ..KKK..
`);
const SHIELD = spr(`
  .nnnnnnn.
  nsssssCBn
  nsCCgCBBn
  nsCgygBun
  nsCCgCBun
  nsCCgBBun
  .nCCBBun.
  .nCBBuun.
  ..nBuun..
  ...nun...
  ....n....
`);
const SHIELD_S = spr(`
  nnnnn
  nsCBn
  nCgun
  .nBn.
  ..n..
`);
const SHIELD_L = spr(`
  .nnnnnnnnn.
  nssssssCCBn
  nsCCCgCCBBn
  nsCCgygCBBn
  nsCgyWygBun
  nsCCgygCBun
  nsCCCgCBBun
  .nCCCCBBun.
  .nCCCBBuun.
  ..nCBBuun..
  ...nBuun...
  ....nun....
  .....n.....
`);
const FLAME = [
  spr(`
    ..r..
    .mr..
    .rPr.
    mrPrm
    mPOPr
    rOyOr
    .rOr.
    ..m..
  `),
  spr(`
    ...r.
    ..rm.
    .rPr.
    mrPrm
    rPOPm
    rOyOr
    .rOr.
    ..m..
  `),
  spr(`
    .r...
    .mr..
    .rPrm
    mrPPr
    rPOPr
    mOyOr
    .rOr.
    ..m..
  `),
];
const FLAME_S = [
  spr(`
    .r.
    rPr
    rOr
    .m.
  `),
  spr(`
    r..
    rPr
    mOr
    .m.
  `),
];
const SPIKE = spr(`
  ...K...
  ..KsK..
  ..KeSK.
  .KseSK.
  .KeeSlK
  KseSSlK
  KeSSllK
  KSSlllK
`);
const CHUNK = [
  spr(`
    .KK.
    KseK
    KeSK
    .KK.
  `),
  spr(`
    KK.
    KeK
    .KK
  `),
  spr(`
    .dd.
    dtkd
    dkbd
    .dd.
  `),
];
function recol(s, map) {
  const rows = s.rows.map((r) => [...r].map((c) => map[c] || c).join(""));
  return { w: s.w, h: s.h, rows, pal: s.pal, _c: null };
}

// ───── 베기 초승달 (r·방향·색·장면마다 한 번 굽기) ─────
const slashCache = new Map();
function slashCanvas(r, rot, ramp, frame) {
  const key = `${r},${rot.toFixed(2)},${ramp.join("")},${frame}`;
  if (slashCache.has(key)) return slashCache.get(key);
  const size = r * 2 + 7;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const x = c.getContext("2d");
  const a0 = -1.25 + rot, a1 = 1.05 + rot;
  // 장면별: 앞 끝(head)과 뒤 끝(tail), 두께
  const [head, tail, thick] = [[0.55, 0, 1], [1, 0, 1.15], [1, 0.35, 0.8], [1, 0.7, 0.5]][frame];
  const hw = Math.max(1.5, r * 0.28) * thick;
  const cx = size / 2, cy = size / 2;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      let a = Math.atan2(dy, dx);
      while (a < a0 - 0.6) a += Math.PI * 2;
      while (a > a0 + Math.PI * 2 - 0.6) a -= Math.PI * 2;
      const u = (a - a0) / (a1 - a0);
      if (u < tail || u > head) continue;
      const k = (u - tail) / Math.max(0.01, head - tail); // 0 = 꼬리, 1 = 머리
      const w = hw * Math.pow(Math.sin(Math.PI * Math.min(1, u / Math.max(0.3, head))), 0.6) * (0.35 + 0.65 * k);
      const off = d - (r - w * 0.4);
      if (Math.abs(off) > w) continue;
      const across = (off + w) / (2 * w); // 0 = 안쪽, 1 = 바깥쪽
      if (k < 0.3 && (i + j) & 1) continue; // 꼬리는 바둑판으로 흩어짐
      let ch = across > 0.62 ? ramp[3] : across > 0.3 ? ramp[2] : ramp[1];
      if (frame >= 2 && across > 0.62) ch = ramp[2];
      if (frame === 3) ch = across > 0.5 ? ramp[1] : ramp[0];
      x.fillStyle = PAL[ch];
      x.fillRect(i, j, 1, 1);
    }
  slashCache.set(key, c);
  return c;
}

// ───── 거미줄 (반지름별 한 번 굽기) ─────
const webCache = new Map();
function webCanvas(r) {
  if (webCache.has(r)) return webCache.get(r);
  const size = r * 2 + 3, cx = r + 1, cy = r + 1;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const x = c.getContext("2d");
  const put = (px, py, ch) => {
    x.fillStyle = PAL[ch];
    x.fillRect(px, py, 1, 1);
  };
  const N = 8;
  const spoke = (k, rr) => {
    const a = (k / N) * Math.PI * 2 + 0.2 + (k % 2) * 0.08;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  for (let k = 0; k < N; k++) {
    const [ex, ey] = spoke(k, r);
    plotLine(cx, cy, ex, ey, (px, py) => put(px, py, "s"));
  }
  for (const f of [0.35, 0.65, 0.95]) {
    for (let k = 0; k < N; k++) {
      const [ax, ay] = spoke(k, r * f), [bx, by] = spoke(k + 1, r * f);
      // 가운데가 살짝 처진 실
      const mx = (ax + bx) / 2 + (cx - (ax + bx) / 2) * 0.12, my = (ay + by) / 2 + (cy - (ay + by) / 2) * 0.12 + 0.5;
      plotLine(ax, ay, mx, my, (px, py) => put(px, py, "e"));
      plotLine(mx, my, bx, by, (px, py) => put(px, py, "e"));
      put(Math.round(ax), Math.round(ay), "W");
    }
  }
  put(cx, cy, "W");
  webCache.set(r, c);
  return c;
}

// ───── 효과 하나씩 그리기 (p = 0~1 진행, f = 효과 정보) ─────
const FX = {
  proj(ctx, f, p, now) {
    const pos = (q) => [lerp(f.x1, f.x2, q), lerp(f.y1, f.y2, q) - Math.sin(q * Math.PI) * (f.arc || 0)];
    const [x, y] = pos(p);
    const [bx, by] = pos(Math.max(0, p - 0.06));
    const vx = x - bx, vy = y - by;
    const fr = Math.floor(now * 14 + f.seed) % 3;
    const kind = f.color || "fire";
    // 짧은 잔상 (지나온 자리에 작은 점)
    const tr = { fire: ["O", "R", "m"], ice: ["C", "B", "u"], arcane: ["P", "M", "p"], web: ["W", "s", "e"], holy: ["y", "g", "O"], dark: ["M", "p", "n"], rock: ["e", "S", "l"] }[kind] || ["W", "s", "e"];
    for (let i = 1; i <= 3; i++) {
      const [tx, ty] = pos(Math.max(0, p - i * 0.045));
      const sz = i === 1 ? 2 : 1;
      if (kind === "rock" && i > 1) continue;
      box(ctx, tx - (sz >> 1) + (hash(i, fr, f.seed) < 0.5 ? 0 : 1), ty - (sz >> 1), sz, sz, tr[i - 1]);
    }
    if (kind === "fire") {
      const s = FB[fr];
      blit(ctx, s, x - s.w + 4 + (vx < 0 ? s.w - 8 : 0), y - (s.h >> 1), { flip: vx < 0 });
    } else if (kind === "ice") {
      // 8방향 중 가까운 것 (오른쪽·오른쪽 위 두 장 + 90도 돌리기)
      const oct = ((Math.round(Math.atan2(-vy, vx) / (Math.PI / 4)) % 8) + 8) % 8;
      const s = oct % 2 ? ICE_NE : ICE_E;
      const rot = [0, 0, 3, 3, 2, 2, 1, 1][oct];
      const w = rot % 2 ? s.h : s.w, h = rot % 2 ? s.w : s.h;
      blit(ctx, s, x - (w >> 1), y - (h >> 1), { rot });
    } else if (kind === "web") {
      const s = WEBBALL[fr % 2];
      blit(ctx, s, x - 3, y - 3);
    } else if (kind === "rock") {
      blit(ctx, ROCK, x - 3, y - 3, { rot: Math.floor(now * 12 + f.seed) % 4 });
      dot(ctx, x - 4 - (vx > 0 ? 0 : -8), y + 1, "e");
    } else {
      const set = ORBS[kind] || ORBS.arcane;
      const ramp = { arcane: ["p", "M", "P", "W"], holy: ["O", "g", "y", "W"], dark: ["n", "p", "M", "P"] }[kind] || ["p", "M", "P", "W"];
      softOval(ctx, x, y, 5, 5, ramp[1], 0.3, kind !== "dark");
      blit(ctx, set[fr % 2], x - 3, y - 3);
      // 주위를 도는 반짝이 두 개
      for (let k = 0; k < 2; k++) {
        const a = now * 9 + k * Math.PI + f.seed;
        dot(ctx, x + Math.round(Math.cos(a) * 5), y + Math.round(Math.sin(a) * 4), k ? ramp[2] : ramp[3]);
      }
      if (kind === "holy" && fr === 0) (dot(ctx, x, y - 5, "W"), dot(ctx, x, y + 5, "W"), dot(ctx, x - 5, y, "W"), dot(ctx, x + 5, y, "W"));
    }
  },
  slash(ctx, f, p) {
    const r = Math.max(6, Math.min(18, Math.round(f.r || 10)));
    const frame = Math.min(3, Math.floor(p * 4));
    const rot = Math.round((f.rot || 0) * 4) / 4;
    const c = slashCanvas(r, rot, rampOf(f.color || "#ffffff"), frame);
    ctx.drawImage(c, Math.round(f.x - c.width / 2), Math.round(f.y - c.height / 2));
  },
  claw(ctx, f, p) {
    // 세 줄이 차례로 그어지고 붉게 식어 사라짐
    for (let i = 0; i < 3; i++) {
      const s = (p - i * 0.1) / 0.62;
      if (s <= 0) continue;
      const grow = Math.min(1, s * 2.2), fade = Math.max(0, (s - 0.6) / 0.4);
      if (fade >= 1) continue;
      const x0 = f.x - 8 + i * 4, y0 = f.y - 9 + Math.abs(i - 1);
      const x1 = x0 + 9, y1 = y0 + 15;
      const ex = lerp(x0, x1, grow), ey = lerp(y0, y1, grow);
      const n = Math.max(1, Math.round(Math.hypot(ex - x0, ey - y0)));
      plotLine(x0, y0, ex, ey, (x, y, k) => {
        const u = k / n;
        if (fade > 0.3 && (x + y) & 1) return;
        const thick = u > 0.15 && u < 0.85;
        dot(ctx, x, y, fade > 0.5 ? "m" : u > 0.9 ? "P" : "W");
        if (thick) dot(ctx, x + 1, y, fade > 0.5 ? "m" : "r");
        if (thick && !fade) dot(ctx, x - 1, y, "m");
      });
    }
  },
  ring(ctx, f, p) {
    const [ch, a] = snap(f.color || "#ffffff");
    const ramp = RAMP[ch] || RAMP.W;
    const R = Math.max(4, Math.min(40, f.r || 20));
    const rr = Math.round(2 + R * easeOut(p));
    const ry = Math.round(rr * (f.flat || 1));
    ctx.save();
    ctx.globalAlpha = a < 1 ? Math.max(0.6, a) : 1;
    for (const [w, c] of [[0, p < 0.5 ? ramp[3] : ramp[2]], [-1, ramp[1]]]) {
      for (const [x, y] of ringPts(rr + w, Math.max(1, ry + w))) {
        if (p > 0.55 && (x + y) & 1) continue;
        if (p > 0.8 && (x + y) & 2) continue;
        dot(ctx, f.x + x, f.y + y, c);
      }
    }
    ctx.restore();
  },
  bubble(ctx, f, p) {
    // 방패가 톡 튀어나오고(작게→크게→보통), 둥근 막이 감쌌다가 깜빡이며 사라짐
    const cx = Math.round(f.x), cy = Math.round(f.y - 10);
    const lift = Math.round(Math.min(1, p * 3) * 3);
    if (p > 0.2) {
      const rr = p < 0.3 ? 9 : 11;
      softOval(ctx, cx, cy + 2, rr, rr + 2, "B", 0.18 * (1 - p), true);
      for (const [x, y] of ringPts(rr, rr + 2)) if (((x + y) & 1) === 0 || p < 0.5) dot(ctx, cx + x, cy + 2 + y, y < -rr * 0.5 && x < 0 ? "W" : "C");
    }
    if (p > 0.85 && Math.floor(p * 40) % 2) return;
    const s = p < 0.1 ? SHIELD_S : p < 0.2 ? SHIELD_L : SHIELD;
    blit(ctx, s, cx - (s.w >> 1), cy - (s.h >> 1) - lift);
    if (p > 0.25 && p < 0.45) {
      const sx = cx - 3, sy = cy - 6 - lift;
      dot(ctx, sx, sy, "W");
      dot(ctx, sx - 1, sy, "s");
      dot(ctx, sx + 1, sy, "s");
      dot(ctx, sx, sy - 1, "s");
      dot(ctx, sx, sy + 1, "s");
    }
  },
  bolt(ctx, f, p, now) {
    if (!f.paths) f.paths = [0, 1, 2].map((k) => boltPath(f, k));
    const strobe = p < 0.12 || (p > 0.3 && p < 0.38) || p > 0.85;
    const path = f.paths[Math.floor(now * 20) % 3];
    if (!strobe) {
      for (const [x, y] of path) {
        dot(ctx, x - 1, y, "C");
        dot(ctx, x + 1, y, "B");
      }
      for (const [x, y] of path) dot(ctx, x, y, "W");
    }
    // 맞은 자리: 빛 터짐
    const fl = 1 - p;
    softOval(ctx, f.x, f.y, 10, 3, "B", 0.45 * fl);
    softOval(ctx, f.x, f.y, 5, 1, "C", 0.8 * fl);
    if (p < 0.6) {
      const L = p < 0.25 ? 5 : 3;
      for (let i = -L; i <= L; i++) {
        dot(ctx, f.x + i, f.y - 3, Math.abs(i) < 2 ? "W" : "C");
        dot(ctx, f.x, f.y - 3 + i, Math.abs(i) < 2 ? "W" : "C");
      }
      for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [-3, -3], [3, -3], [-3, 3], [3, 3]]) if (p < 0.3 || Math.abs(dx) < 3) dot(ctx, f.x + dx, f.y - 3 + dy, "s");
    }
  },
  beam(ctx, f, p, now) {
    const y0 = f.y0 == null ? -2 : f.y0;
    const grow = p < 0.2 ? p / 0.2 : p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 1;
    const hw = Math.max(1, Math.round((f.w || 7) * grow));
    const x = Math.round(f.x), yb = Math.round(f.y);
    ctx.save();
    for (let yy = y0; yy <= yb; yy++) {
      const top = (yy - y0) / Math.max(1, yb - y0); // 위는 0, 바닥은 1
      for (let i = -hw - 2; i <= hw + 2; i++) {
        const e = Math.abs(i) / (hw + 0.5);
        let ch, a;
        // 가운데는 반투명 흰빛, 바깥은 불투명 점을 바둑판으로 (어두운 바탕에서도 탁해지지 않게)
        if (e < 0.35) (ch = "W"), (a = 0.85);
        else if (e < 0.7) (ch = (x + i + yy) & 1 ? "y" : "W"), (a = (x + i + yy) & 1 ? 1 : 0.4);
        else if (e < 1) (ch = "y"), (a = 1);
        else (ch = "g"), (a = 1);
        if (e >= 0.7 && (x + i + yy) & 1) continue;
        if (e >= 1 && (x + i + yy) & 2) continue;
        ctx.globalAlpha = a * (grow < 1 ? 0.5 + 0.5 * grow : 1);
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(x + i, yy, 1, 1);
      }
    }
    ctx.restore();
    // 떠오르는 빛 알갱이
    for (let k = 0; k < 7; k++) {
      const h = yb - y0;
      const yy = yb - ((now * 50 + k * 23 + f.seed * 7) % h);
      const xx = x + Math.round((hash(k, 1, f.seed) - 0.5) * hw * 1.6);
      dot(ctx, xx, yy, k % 3 ? "y" : "W");
    }
    // 바닥 빛
    softOval(ctx, x, yb, hw + 6, 3, "g", 0.85 * grow);
    softOval(ctx, x, yb, hw + 3, 2, "y", 0.9 * grow);
    softOval(ctx, x, yb, hw, 1, "W", 0.9 * grow);
  },
  meteor(ctx, f, p, now) {
    const [fx0, fy0] = f.from || [70, -120];
    const q = p * p * 0.3 + p * 0.7;
    const x = Math.round(lerp(f.x + fx0, f.x, q)), y = Math.round(lerp(f.y + fy0, f.y - 6, q));
    const dx = -fx0, dy = -fy0, dl = Math.hypot(dx, dy);
    const ux = dx / dl, uy = dy / dl; // 진행 방향
    // 꼬리: 지나온 길에 작아지는 불덩이
    for (let i = 6; i >= 1; i--) {
      const tx = Math.round(x - ux * i * 5 + (hash(i, Math.floor(now * 12), f.seed) - 0.5) * 2), ty = Math.round(y - uy * i * 5);
      const r = Math.max(1, 5 - i * 0.7);
      softOval(ctx, tx, ty, Math.round(r), Math.round(r), i > 3 ? "m" : "R", 0.75);
      if (i < 3) box(ctx, tx - 1, ty - 1, 2, 2, "O");
    }
    // 머리: 앞쪽 아래가 가장 뜨겁게
    const fr = Math.floor(now * 16 + f.seed);
    for (let j = -8; j <= 8; j++)
      for (let i = -8; i <= 8; i++) {
        let d = Math.hypot(i, j);
        const back = -(i * ux + j * uy); // 뒤쪽일수록 +
        const lick = back > 2 ? hash(i, j + fr, f.seed) * 2.5 : 0;
        if (d > 6 + lick) continue;
        const hot = Math.hypot(i - ux * 2, j - uy * 2);
        const ch = hot < 1.6 ? "W" : hot < 2.8 ? "y" : hot < 4.2 ? "g" : d < 5.4 ? "O" : d < 6.4 ? "R" : "m";
        dot(ctx, x + i, y + j, ch);
      }
  },
  aura(ctx, f, p, now) {
    // 몸을 감싸는 붉은 기운 + 옆구리·발밑에서 솟는 불꽃 + 불티
    const fade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : Math.min(1, p * 5);
    const x = Math.round(f.x), y = Math.round(f.y);
    softOval(ctx, x, y, 12, 3, "r", 0.3 * fade, true);
    softOval(ctx, x, y - 13, 10, 15, "r", 0.16 * fade, true);
    ctx.save();
    for (const [px, py] of ringPts(10, 15)) {
      if (((px + py + Math.floor(now * 10)) & 3) !== 0) continue;
      ctx.globalAlpha = 0.7 * fade;
      dot(ctx, x + px, y - 13 + py, py < 0 ? "P" : "r");
    }
    for (let k = 0; k < 10; k++) {
      const ph = (now * 1.5 + hash(k, 1, f.seed)) % 1;
      const side = k % 2 ? 1 : -1;
      const fx = x + side * (6 + Math.round(hash(k, 2, f.seed) * 6)) - 2;
      const fy = y - 8 - Math.round(ph * 22) - Math.round(hash(k, 3, f.seed) * 3);
      if (ph > 0.9) continue;
      ctx.globalAlpha = fade * (ph > 0.65 ? 0.6 : 1);
      const big = ph < 0.55 && k < 6;
      const s = big ? FLAME[Math.floor(now * 12 + k) % 3] : FLAME_S[Math.floor(now * 12 + k) % 2];
      blit(ctx, s, fx, fy);
    }
    // 발밑 불꽃 줄
    ctx.globalAlpha = fade;
    for (let k = -2; k <= 2; k++) blit(ctx, FLAME_S[(Math.floor(now * 10) + k + 9) % 2], x + k * 5 - 1, y - 4 - (Math.abs(k) === 1 ? 1 : 0));
    ctx.restore();
    for (let k = 0; k < 6; k++) {
      const ph = (now * 1.1 + k / 6) % 1;
      dot(ctx, x + Math.round(Math.sin(k * 2.3 + now * 3) * 10), y - 8 - Math.round(ph * 30), ph < 0.4 ? "y" : ph < 0.7 ? "P" : "r");
    }
  },
  web(ctx, f, p) {
    const fade = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
    const c = webCanvas(p < 0.08 ? 5 : p < 0.16 ? 11 : 10);
    ctx.save();
    ctx.globalAlpha = 0.9 * fade;
    ctx.drawImage(c, Math.round(f.x - c.width / 2), Math.round(f.y - 10 - c.height / 2));
    ctx.restore();
  },
  quake(ctx, f, p, now) {
    if (!f.cracks) f.cracks = quakeCracks(f);
    const fade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
    const grow = Math.min(1, p / 0.3);
    const t = p * (f.dur || 0.6);
    ctx.save();
    ctx.globalAlpha = fade;
    // 갈라진 금: 가운데는 굵게, 아래 가장자리는 밝게
    for (const cr of f.cracks) {
      const n = Math.round(cr.length * grow);
      for (let i = 0; i < n; i++) {
        const [x, y] = cr[i];
        dot(ctx, x, y, "K");
        if (i < n * 0.35) dot(ctx, x, y - 1, "K");
        if (i < n * 0.7) dot(ctx, x, y + 1, "S");
        if (i < n * 0.2) dot(ctx, x, y + 2, "e");
      }
    }
    // 금을 따라 솟는 바위 가시 (올라왔다 내려감)
    for (let k = 0; k < 3; k++) {
      const st = (t - 0.05 - k * 0.04) / 0.35;
      if (st <= 0 || st >= 1) continue;
      const h = Math.round(SPIKE.h * Math.sin(Math.PI * st));
      if (h <= 0) continue;
      const sx = Math.round(f.x + (k - 1) * 16 + (k === 1 ? 0 : (hash(k, 4, f.seed) - 0.5) * 6)), gy = Math.round(f.y + (k === 1 ? -1 : 1));
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx - 4, gy - h, 8, h);
      ctx.clip();
      blit(ctx, SPIKE, sx - 3, gy - h);
      ctx.restore();
      dot(ctx, sx - 4, gy, "K");
      dot(ctx, sx + 4, gy, "K");
    }
    ctx.restore();
    // 흙먼지
    for (let k = 0; k < 7; k++) {
      const st = Math.max(0, t - k * 0.02);
      const cx = f.x + (k - 3) * 9 + (hash(k, 5, f.seed) - 0.5) * 4, r = Math.round(1 + st * 12);
      softOval(ctx, cx, f.y - 1 - Math.round(st * 10), r, Math.max(1, Math.round(r * 0.6)), "s", 0.22 * (1 - p));
    }
    // 튀어 오르는 돌 조각
    for (let k = 0; k < 8; k++) {
      const vx = (hash(k, 1, f.seed) - 0.5) * 60, vy = -45 - hash(k, 2, f.seed) * 50;
      const st = t - hash(k, 3, f.seed) * 0.12;
      if (st <= 0) continue;
      const x = f.x + (k - 3.5) * 7 + vx * st, y = f.y + vy * st + 170 * st * st;
      if (y > f.y + 2) continue;
      blit(ctx, CHUNK[k % 3], x - 2, y - 2, { rot: Math.floor(st * 14 + k) % 4 });
    }
  },
};
// 번개 길: 위에서 (x, y)까지 꺾이며 내려오고 짧은 곁가지 하나
function boltPath(f, k) {
  const pts = [];
  const y0 = f.y0 == null ? -2 : f.y0;
  let x = f.x + (hash(k, 1, f.seed) - 0.5) * 14, y = y0;
  const seg = [];
  while (y < f.y - 4) {
    const ny = Math.min(f.y - 4, y + 6 + hash(y, k, f.seed) * 7);
    const pull = (f.x - x) * ((ny - y0) / Math.max(1, f.y - y0)) * 0.6;
    const nx = x + (hash(y, k + 3, f.seed) - 0.5) * 10 + pull;
    seg.push([x, y, nx, ny]);
    (x = nx), (y = ny);
  }
  seg.push([x, y, f.x, f.y - 3]);
  for (const [a, b, c, d] of seg) plotLine(a, b, c, d, (px, py) => pts.push([px, py]));
  // 곁가지
  const s = seg[Math.min(seg.length - 1, 1 + (k % Math.max(1, seg.length - 1)))];
  const dir = hash(k, 9, f.seed) < 0.5 ? -1 : 1;
  plotLine(s[2], s[3], s[2] + dir * 6, s[3] + 5, (px, py) => pts.push([px, py]));
  return pts;
}
// 지진 금: 가운데에서 좌우로 지그재그
function quakeCracks(f) {
  const out = [];
  for (const dir of [-1, 1]) {
    for (let b = 0; b < 2; b++) {
      const pts = [];
      let x = f.x, y = f.y + b;
      const len = 26 + hash(dir, b, f.seed) * 14 - b * 10;
      for (let i = 0; i < len; i++) {
        pts.push([Math.round(x), Math.round(y)]);
        x += dir;
        if (hash(i, dir + b * 5, f.seed) < 0.35) y += hash(i, dir + 9, f.seed) < 0.5 ? -1 : 1;
        y = Math.max(f.y - 4, Math.min(f.y + 4, y));
      }
      out.push(pts);
    }
  }
  return out;
}

// ═════════ 효과 관리 ═════════
export class Effects {
  constructor() {
    this.list = [];
    this.parts = [];
    this.texts = [];
    this.shakeT = 0;
    this.shakeD = 0;
    this.shakeP = 0;
    this.clock = null; // 숫자를 넣으면 그 시각(초)으로 그린다 (미리보기용)
  }
  now() {
    return this.clock != null ? this.clock : performance.now() / 1000;
  }
  add(kind, o = {}) {
    this.list.push({ kind, t0: this.now(), dur: 0.5, seed: Math.floor(Math.random() * 997), ...o });
  }
  // 떠오르는 글자: 그림판에는 그리지 않고 모아 둔다 (한글은 게임이 고해상도 층에 그림). eachText로 위치를 받는다
  text(x, y, text, color = "#fff", size = 22, dur = 1.1) {
    this.texts.push({ x, y, text, color, size, dur, t0: this.now() });
  }
  eachText(fn) {
    const now = this.now();
    for (const f of this.texts) {
      const p = Math.min(1, (now - f.t0) / f.dur);
      fn({ x: f.x, y: f.y - 46 * Math.min(1, p * 1.6), text: f.text, color: f.color, size: f.size * (p < 0.12 ? 0.6 + p * 3.4 : 1), alpha: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3 });
    }
  }
  shake(p = 2, d = 0.25) {
    this.shakeP = Math.max(this.shakeP, p);
    this.shakeT = Math.max(this.shakeT, d);
    this.shakeD = Math.max(this.shakeD, d);
  }
  offset() {
    if (this.shakeT <= 0) return [0, 0];
    const k = this.shakeP * Math.min(1, (this.shakeT / this.shakeD) * 1.5);
    return [Math.round((Math.random() * 2 - 1) * k), Math.round((Math.random() * 2 - 1) * k)];
  }
  // 네모 파편 (size 1~2 픽셀). color = CSS 색 → 가까운 팔레트 색
  burst(x, y, color, n = 14, speed = 40, size = 1, g = 70) {
    const ramp = rampOf(color);
    const base = snap(color)[0];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.35, g, age: 0, life: 0.35 + Math.random() * 0.35, ch: i % 4 === 0 ? ramp[3] : base, dk: ramp[0], size: Math.max(1, Math.min(2, Math.round(size * (0.6 + Math.random() * 0.8)))), kind: "sq" });
    }
  }
  // 떠오르는 반짝이·십자 (회복 등)
  rise(x, y, color, n = 10, spread = 8) {
    const ramp = rampOf(color);
    for (let i = 0; i < n; i++)
      this.parts.push({ x: x + (Math.random() * 2 - 1) * spread, y: y + Math.random() * 8, vx: 0, vy: -14 - Math.random() * 14, g: 0, age: -Math.random() * 0.25, life: 0.7 + Math.random() * 0.5, ch: ramp[2], hi: ramp[3], dk: ramp[1], size: 1, kind: i % 3 === 0 ? "spark" : "plus", wob: Math.random() * 6 });
  }
  update(dt) {
    this.shakeT -= dt;
    if (this.shakeT <= 0) (this.shakeP = 0), (this.shakeD = 0);
    for (const p of this.parts) {
      p.age += dt;
      if (p.age < 0) continue;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    const now = this.now();
    // 불덩이·얼음·마법 구슬은 지나간 자리에 작은 불티를 남긴다
    for (const f of this.list)
      if (f.kind === "proj" && Math.random() < 0.6) {
        const q = Math.min(1, (now - f.t0) / f.dur);
        const x = lerp(f.x1, f.x2, q), y = lerp(f.y1, f.y2, q) - Math.sin(q * Math.PI) * (f.arc || 0);
        const ch = { fire: "O", ice: "C", arcane: "P", holy: "y", dark: "M", web: "s", rock: "S" }[f.color] || "W";
        this.parts.push({ x, y: y + (Math.random() * 4 - 2), vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6, g: 0, age: 0, life: 0.2 + Math.random() * 0.15, ch, dk: ch, size: 1, kind: "sq" });
      }
    this.list = this.list.filter((f) => now - f.t0 < f.dur);
    this.texts = this.texts.filter((f) => now - f.t0 < f.dur);
  }
  draw(ctx) {
    const now = this.now();
    for (const f of this.list) {
      const p = Math.max(0, Math.min(1, (now - f.t0) / f.dur));
      if (FX[f.kind]) FX[f.kind](ctx, f, p, now);
    }
    ctx.save();
    for (const p of this.parts) {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      const x = Math.round(p.x), y = Math.round(p.y);
      ctx.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      if (p.kind === "plus") {
        const ch = k < 0.5 ? p.ch : p.dk;
        const xx = x + Math.round(Math.sin(p.age * 6 + p.wob));
        box(ctx, xx - 1, y, 3, 1, ch);
        box(ctx, xx, y - 1, 1, 3, ch);
        if (k < 0.4) dot(ctx, xx, y, p.hi);
      } else if (p.kind === "spark") {
        if (Math.floor(p.age * 14) % 3 === 2) continue;
        dot(ctx, x, y, p.hi);
      } else {
        const sz = k > 0.6 ? 1 : p.size;
        box(ctx, x, y, sz, sz, k > 0.55 ? p.dk : p.ch);
      }
    }
    ctx.restore();
  }
}

// 미리보기: 효과마다 진행 중인 한 장면 (어두운 바탕)
export function preview(ctx, W, H, t = 0.3) {
  ctx.fillStyle = PAL.n;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PAL.K;
  for (let y = 0; y < H; y += 60) ctx.fillRect(0, y + 58, W, 2);
  const fx = new Effects();
  fx.clock = 10;
  const at = (kind, o, p) => fx.list.push({ kind, seed: 7, ...o, t0: fx.clock - p * (o.dur || 0.5), dur: o.dur || 0.5 });
  const ph = Math.min(0.95, Math.max(0.05, t / 0.6)); // t로 진행 정도를 고른다 (0.3 → 0.5)
  // 1줄: 날아가는 마법 일곱 가지 (각자 왼쪽→오른쪽, 마지막 둘은 오른쪽→왼쪽)
  ["fire", "ice", "arcane", "web", "holy", "dark", "rock"].forEach((c, i) => {
    const x1 = 6 + i * 45, back = i >= 5;
    at("proj", { x1: back ? x1 + 36 : x1, y1: 34, x2: back ? x1 : x1 + 36, y2: 34, arc: 18, color: c, dur: 0.3 }, ph);
  });
  // 2줄: 베기 둘, 할퀴기, 고리, 방패, 거미줄
  at("slash", { x: 24, y: 92, r: 11, rot: 0, color: "#ffffff", dur: 0.25 }, Math.min(0.3, ph * 0.6));
  at("slash", { x: 70, y: 92, r: 13, rot: -0.7, color: "#ff7070", dur: 0.25 }, Math.min(0.45, ph * 0.8));
  at("claw", { x: 120, y: 92, dur: 0.3 }, ph);
  at("ring", { x: 168, y: 92, r: 20, color: "#ffd27a", dur: 0.5 }, ph);
  at("bubble", { x: 222, y: 104, dur: 0.6 }, ph);
  at("web", { x: 286, y: 102, dur: 0.6 }, ph);
  // 3줄: 번개, 빛기둥, 운석, 분노, 지진
  at("bolt", { x: 24, y: 168, y0: 122, dur: 0.3 }, 0.2);
  at("beam", { x: 76, y: 168, y0: 122, dur: 0.5 }, ph);
  at("meteor", { x: 130, y: 172, from: [34, -48], dur: 0.35 }, ph);
  at("aura", { x: 190, y: 170, dur: 0.7, color: "rgba(255,60,60,0.45)" }, ph);
  at("quake", { x: 270, y: 166, dur: 0.6, seed: 3 }, ph);
  // 파편·회복 반짝이는 시간을 흘려서
  fx.burst(228, 132, "#ff9a3d", 14, 40, 2);
  fx.rise(232, 100, "#7dff9a", 6, 6);
  const steps = Math.round(Math.min(0.5, t) * 60);
  for (let i = 0; i < steps; i++) {
    for (const p of fx.parts) {
      p.age += 1 / 60;
      if (p.age < 0) continue;
      p.vy += p.g / 60;
      p.x += p.vx / 60;
      p.y += p.vy / 60;
    }
  }
  fx.parts = fx.parts.filter((p) => p.age < p.life);
  fx.draw(ctx);
}
