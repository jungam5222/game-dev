// 코드로 그리는 그림: 영웅 3직업, 몬스터 9종, 마을 건물·나무, 던전 방, 전투 효과.
// 모든 그림은 발끝 가운데가 (x, y). dir 1 = 오른쪽을 봄, -1 = 왼쪽.

const TAU = Math.PI * 2;

function ell(ctx, x, y, rx, ry, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
function circ(ctx, x, y, r, fill) {
  ell(ctx, x, y, r, r, fill);
}
function rr(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function line(ctx, x1, y1, x2, y2, color, w = 2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.stroke();
}
function shadow(ctx, w = 16) {
  ell(ctx, 0, 0, w, w * 0.32, "rgba(0,0,0,0.28)");
}
const SKIN = "#f2c79a";

// ───────── 영웅 ─────────
// o: { dir, t, walking, scale, swing(0~1 무기 휘두르기), cast(0~1), down, hurt(0~1), alpha }
export function drawHero(ctx, cls, x, y, o = {}) {
  const s = o.scale || 1;
  const dir = o.dir || 1;
  const t = o.t || 0;
  const step = o.walking ? Math.sin(t * 13) : 0;
  const bob = o.walking ? Math.abs(Math.sin(t * 13)) * 2.2 : Math.sin(t * 2.2) * 0.7;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  shadow(ctx);
  ctx.scale(dir, 1);
  if (o.down) {
    ctx.translate(-4, -6);
    ctx.rotate(-Math.PI / 2);
    ctx.globalAlpha *= 0.75;
  }
  ctx.translate(0, -bob);
  hurtGlow(ctx, o.hurt, "255,70,70", t);
  if (cls === "warrior") warrior(ctx, step, t, o);
  else if (cls === "mage") mage(ctx, step, t, o);
  else priest(ctx, step, t, o);
  ctx.restore();
}

// 맞았을 때: 빛나는 테두리 + 살짝 흔들림 (모든 브라우저에서 되는 방법)
function hurtGlow(ctx, hurt, rgb, t) {
  if (!hurt) return;
  ctx.translate(Math.sin(t * 70) * 3 * hurt, 0);
  ctx.shadowColor = `rgba(${rgb},${Math.min(1, hurt * 1.2)})`;
  ctx.shadowBlur = 22 * hurt;
}

function legs(ctx, step, pants, boots) {
  rr(ctx, -7 + step * 3, -15, 5.5, 14, 2, pants);
  rr(ctx, 1.5 - step * 3, -15, 5.5, 14, 2, pants);
  rr(ctx, -8 + step * 3, -4, 7, 4, 2, boots);
  rr(ctx, 1 - step * 3, -4, 7, 4, 2, boots);
}
function face(ctx, y = -44) {
  circ(ctx, 0, y, 10, SKIN);
  circ(ctx, 3.5, y + 0.5, 1.5, "#2a1d16");
  circ(ctx, 7.5, y + 0.5, 1.4, "#2a1d16");
  ctx.fillStyle = "rgba(230,120,110,0.45)";
  ell(ctx, 6, y + 4.5, 2.2, 1.3, "rgba(230,120,110,0.45)");
}

function warrior(ctx, step, t, o) {
  // 칼 (몸 뒤)
  ctx.save();
  ctx.translate(-9, -24);
  ctx.rotate(-0.5 + (o.swing || 0) * 2.6);
  rr(ctx, -2, -30, 4, 28, 1.5, "#e3e9ef", "#9aa6b2");
  rr(ctx, -6, -3, 12, 3, 1, "#c9a227");
  rr(ctx, -1.5, 0, 3, 7, 1, "#5a3b22");
  ctx.restore();
  legs(ctx, step, "#5a3b2a", "#2b1d14");
  rr(ctx, -10, -35, 20, 23, 5, "#9aa3ad");
  rr(ctx, -6, -34, 12, 21, 3, "#c0392b");
  rr(ctx, -10, -18, 20, 3.5, 1, "#3b2a1a");
  circ(ctx, 0, -16.3, 2, "#c9a227");
  face(ctx);
  // 투구
  ctx.beginPath();
  ctx.arc(0, -46, 11, Math.PI, 0);
  ctx.fillStyle = "#8e99a3";
  ctx.fill();
  rr(ctx, -11, -47, 22, 3, 1, "#6f7a84");
  rr(ctx, 1, -47, 2.5, 8, 1, "#6f7a84");
  ctx.beginPath();
  ctx.moveTo(-2, -57);
  ctx.quadraticCurveTo(-14, -66 - Math.sin(t * 3) * 1.5, -16, -54);
  ctx.quadraticCurveTo(-8, -58, -2, -55);
  ctx.fillStyle = "#d0503f";
  ctx.fill();
  // 방패 (앞)
  rr(ctx, 4, -32, 15, 19, 7, "#8b5a2b", "#c9a227");
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#c9a227";
  ctx.strokeRect(10.5, -30, 2, 15);
  circ(ctx, 11.5, -22.5, 2.5, "#e0c060");
}

function mage(ctx, step, t, o) {
  // 지팡이
  const lift = (o.cast || 0) * 8;
  line(ctx, 13, -2 - lift, 13, -60 - lift, "#7a5230", 3);
  const glow = 0.6 + Math.sin(t * 5) * 0.2 + (o.cast || 0) * 0.6;
  ctx.save();
  ctx.shadowColor = "#7fd3ff";
  ctx.shadowBlur = 10 + glow * 10;
  circ(ctx, 13, -63 - lift, 5.5, `rgba(127,211,255,${Math.min(1, 0.7 + glow * 0.3)})`);
  ctx.restore();
  circ(ctx, 11.5, -64.5 - lift, 1.8, "rgba(255,255,255,0.9)");
  rr(ctx, -6 + step * 2.5, -6, 6, 5, 2, "#2b2235");
  rr(ctx, 1 - step * 2.5, -6, 6, 5, 2, "#2b2235");
  poly(ctx, [-9, -35, 9, -35, 13, -3, -13, -3], "#3f5fbf");
  poly(ctx, [-2, -35, 2, -35, 3, -3, -3, -3], "#2f4a9a");
  rr(ctx, -10, -21, 20, 3, 1, "#d4af37");
  // 소매·손
  rr(ctx, 6, -31, 8, 7, 3, "#3f5fbf");
  circ(ctx, 13, -27 - lift * 0.5, 3, SKIN);
  face(ctx);
  // 모자
  ell(ctx, 0, -50, 15, 3.5, "#2f4a9a");
  ctx.beginPath();
  ctx.moveTo(-10, -51);
  ctx.quadraticCurveTo(-4, -64, -9, -80 - Math.sin(t * 2) * 1.5);
  ctx.quadraticCurveTo(4, -66, 10, -51);
  ctx.closePath();
  ctx.fillStyle = "#3f5fbf";
  ctx.fill();
  star(ctx, 0, -60, 3, "#ffd84a");
}

function priest(ctx, step, t, o) {
  // 홀
  const lift = (o.cast || 0) * 6 + (o.swing || 0) * 4;
  ctx.save();
  ctx.translate(13, -26);
  ctx.rotate(-(o.swing || 0) * 1.2);
  line(ctx, 0, 22, 0, -24 - lift, "#b08a2e", 3);
  circ(ctx, 0, -27 - lift, 5, "#e8c95a");
  rr(ctx, -1, -36 - lift, 2, 8, 1, "#fff3c2");
  rr(ctx, -3.5, -33.5 - lift, 7, 2, 1, "#fff3c2");
  ctx.restore();
  rr(ctx, -6 + step * 2.5, -6, 6, 5, 2, "#6b5a3e");
  rr(ctx, 1 - step * 2.5, -6, 6, 5, 2, "#6b5a3e");
  poly(ctx, [-9, -35, 9, -35, 12, -3, -12, -3], "#f3f0e6");
  rr(ctx, -2, -34, 4, 31, 1, "#d4af37");
  rr(ctx, -6, -28, 12, 2.5, 1, "#d4af37");
  rr(ctx, 6, -31, 8, 7, 3, "#f3f0e6");
  circ(ctx, 13, -27, 3, SKIN);
  // 두건
  circ(ctx, -1, -45, 12.5, "#e6e0cf");
  face(ctx);
  ctx.beginPath();
  ctx.arc(0, -46, 11, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#e6e0cf";
  ctx.stroke();
  // 후광
  ctx.save();
  ctx.shadowColor = "#ffe27a";
  ctx.shadowBlur = 8 + (o.cast || 0) * 12;
  ctx.beginPath();
  ctx.ellipse(0, -63 + Math.sin(t * 2.5), 9, 3, 0, 0, TAU);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#ffd84a";
  ctx.stroke();
  ctx.restore();
}

function star(ctx, x, y, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  poly(ctx, pts, fill);
}

// ───────── 수호 정령 ─────────
export function drawSpirit(ctx, x, y, o = {}) {
  const t = o.t || 0;
  const s = o.scale || 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ell(ctx, 0, 0, 10, 3, "rgba(120,200,255,0.25)");
  const fy = -26 + Math.sin(t * 3) * 4;
  ctx.shadowColor = o.hurt ? "#ff6060" : "#9fe7ff";
  ctx.shadowBlur = 16 + (o.hurt || 0) * 10;
  ctx.beginPath();
  ctx.moveTo(-11, fy + 8);
  ctx.quadraticCurveTo(-13, fy - 14, 0, fy - 16);
  ctx.quadraticCurveTo(13, fy - 14, 11, fy + 8);
  for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(8 - i * 5.5, fy + 14 + Math.sin(t * 6 + i) * 3, 5.5 - i * 5.5, fy + 8);
  ctx.fillStyle = "rgba(190,240,255,0.85)";
  ctx.fill();
  ctx.shadowBlur = 0;
  circ(ctx, -3.5, fy - 4, 2, "#2a5470");
  circ(ctx, 3.5, fy - 4, 2, "#2a5470");
  ctx.restore();
}

// ───────── 몬스터 ─────────
export const MONSTER_SIZE = { slime: 1, goblin: 1, goblin_chief: 1.5, bat: 1, skeleton: 1.05, golem: 1.75, wolf: 1.05, spider: 1.05, wolf_king: 1.75 };
// 머리 꼭대기 높이 (크기 반영, 체력바 자리)
export const MONSTER_TOP = { slime: 26, goblin: 50, goblin_chief: 86, bat: 58, skeleton: 60, golem: 146, wolf: 48, spider: 30, wolf_king: 90 };

export function drawMonster(ctx, k, x, y, o = {}) {
  const s = (o.scale || 1) * (MONSTER_SIZE[k] || 1);
  const t = o.t || 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  shadow(ctx, k === "bat" ? 10 : k === "wolf" || k === "wolf_king" || k === "spider" ? 20 : 16);
  ctx.scale(o.dir || -1, 1);
  if (o.dead) {
    ctx.globalAlpha *= 0.5;
    ctx.translate(0, -4);
    ctx.rotate(Math.PI / 2.3);
  }
  const fn = MON[k] || MON.slime;
  hurtGlow(ctx, o.hurt, "255,255,255", t);
  fn(ctx, t, o);
  ctx.restore();
}

const MON = {
  slime(ctx, t) {
    const sq = 1 + Math.sin(t * 4) * 0.07;
    ctx.beginPath();
    ctx.moveTo(-17 * sq, 0);
    ctx.bezierCurveTo(-18 * sq, -24 / sq, 18 * sq, -24 / sq, 17 * sq, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -22, 0, 0);
    g.addColorStop(0, "#9be27a");
    g.addColorStop(1, "#4fa63b");
    ctx.fillStyle = g;
    ctx.fill();
    ell(ctx, -6, -14 / sq, 4, 2.5, "rgba(255,255,255,0.55)");
    ell(ctx, 3, -10 / sq, 2.6, 3.4, "#1d2b16");
    ell(ctx, 9, -10 / sq, 2.6, 3.4, "#1d2b16");
    circ(ctx, 3.8, -11 / sq, 0.9, "#fff");
    circ(ctx, 9.8, -11 / sq, 0.9, "#fff");
  },
  goblin(ctx, t, o) {
    goblinBody(ctx, t, o, false);
  },
  goblin_chief(ctx, t, o) {
    goblinBody(ctx, t, o, true);
  },
  bat(ctx, t) {
    const fy = -36 + Math.sin(t * 4) * 5;
    const f = Math.sin(t * 16);
    ctx.save();
    ctx.translate(0, fy);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(f * 0.45);
      poly(ctx, [3, -2, 26, -12, 22, -2, 26, 4, 15, 2, 10, 8, 4, 4], "#4a3561");
      ctx.restore();
    }
    ell(ctx, 0, 0, 8, 9, "#5e4580");
    poly(ctx, [-6, -6, -4, -15, -1, -8], "#5e4580");
    poly(ctx, [6, -6, 4, -15, 1, -8], "#5e4580");
    circ(ctx, 2.5, -2, 1.8, "#ff4b4b");
    circ(ctx, 6, -2, 1.6, "#ff4b4b");
    poly(ctx, [2, 3.5, 3.5, 7, 4.5, 3.5], "#fff");
    ctx.restore();
  },
  skeleton(ctx, t, o) {
    const B = "#ece6d6";
    const step = Math.sin(t * 3) * 1.5;
    line(ctx, -4, -18, -6 + step, 0, B, 3);
    line(ctx, 4, -18, 6 - step, 0, B, 3);
    line(ctx, 0, -38, 0, -18, B, 3);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, -33 + i * 5, 7 - i, 2.4, 0, 0, Math.PI);
      ctx.strokeStyle = B;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    rr(ctx, -6, -20, 12, 3, 1.5, B);
    line(ctx, -2, -37, -9, -24, B, 2.5);
    // 칼
    ctx.save();
    ctx.translate(8, -30);
    ctx.rotate(0.2 + (o.swing || 0) * 1.8);
    line(ctx, 0, 0, 10, 0, B, 2.5);
    rr(ctx, 9, -2.5, 3, 5, 1, "#6b4b2a");
    rr(ctx, 12, -1.5, 18, 3, 1, "#a8a29a");
    ctx.restore();
    circ(ctx, 0, -46, 9, B);
    rr(ctx, -4, -41, 9, 6, 2, B);
    circ(ctx, 2, -47, 2.6, "#2a2420");
    circ(ctx, 7, -47, 2.3, "#2a2420");
    circ(ctx, 2, -47, 0.9, "#ff6a3d");
    circ(ctx, 7, -47, 0.8, "#ff6a3d");
    for (let i = 0; i < 3; i++) line(ctx, -1 + i * 2.6, -38.5, -1 + i * 2.6, -36.5, "#2a2420", 1);
  },
  golem(ctx, t, o) {
    const sw = Math.sin(t * 1.6) * 2;
    rr(ctx, -16, -22, 12, 22, 3, "#6d7078");
    rr(ctx, 4, -22, 12, 22, 3, "#6d7078");
    rr(ctx, -22, -62, 44, 44, 9, "#82858e");
    ell(ctx, -10, -50, 7, 4, "#5f8f4e");
    line(ctx, -2, -60, 4, -44, "#5d6068", 2);
    line(ctx, 4, -44, 0, -34, "#5d6068", 2);
    // 팔
    const lift = (o.swing || 0) * 22;
    rr(ctx, -34, -58 + sw, 14, 34, 7, "#757881");
    ctx.save();
    ctx.translate(26, -54);
    ctx.rotate(-lift * 0.04);
    rr(ctx, -7, -4 - sw, 14, 36, 7, "#757881");
    rr(ctx, -9, 26 - sw, 18, 12, 5, "#686b73");
    ctx.restore();
    rr(ctx, -12, -82, 24, 22, 6, "#8d9099");
    ctx.save();
    ctx.shadowColor = "#ffb347";
    ctx.shadowBlur = 10;
    rr(ctx, -2, -74, 6, 4, 2, "#ffb347");
    rr(ctx, 6, -74, 5, 4, 2, "#ffb347");
    ctx.restore();
  },
  wolf(ctx, t, o) {
    wolfBody(ctx, t, o, "#7a818c", "#5a606a", false);
  },
  wolf_king(ctx, t, o) {
    wolfBody(ctx, t, o, "#dfe3ea", "#aab2bf", true);
  },
  spider(ctx, t) {
    for (let i = 0; i < 4; i++) {
      const ph = Math.sin(t * 8 + i * 1.3) * 2;
      for (const side of [-1, 1]) {
        const bx = -4 + i * 4;
        ctx.beginPath();
        ctx.moveTo(bx, -14);
        ctx.lineTo(bx + side * 3 + (i - 1.5) * 6, -24 + ph * side);
        ctx.lineTo(bx + (i - 1.5) * 10 + side * 2, -1);
        ctx.strokeStyle = "#1c1c22";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ell(ctx, -8, -16, 13, 11, "#2b2b35");
    ell(ctx, -10, -21, 4, 3, "rgba(255,255,255,0.12)");
    ctx.save();
    ctx.translate(-9, -16);
    poly(ctx, [-3, -4, 3, -4, 0, 4], "#c0392b");
    ctx.restore();
    ell(ctx, 7, -14, 7, 6, "#34343f");
    for (const [ex, ey] of [[8, -17], [11, -16], [9, -13.5], [12, -13]]) circ(ctx, ex, ey, 1.2, "#ff3b3b");
    line(ctx, 12, -10, 14, -7, "#1c1c22", 1.5);
  },
};

function goblinBody(ctx, t, o, chief) {
  const G = chief ? "#4f8c3a" : "#6aad4f";
  const step = Math.sin(t * 5) * 1.2;
  if (chief) {
    ctx.beginPath();
    ctx.moveTo(-8, -30);
    ctx.quadraticCurveTo(-18, -14, -14 + Math.sin(t * 2) * 2, 0);
    ctx.lineTo(4, 0);
    ctx.lineTo(4, -30);
    ctx.fillStyle = "#9b2d2d";
    ctx.fill();
  }
  rr(ctx, -6 + step, -12, 4.5, 12, 2, G);
  rr(ctx, 1.5 - step, -12, 4.5, 12, 2, G);
  rr(ctx, -8, -28, 16, 17, 6, G);
  poly(ctx, [-8, -15, 8, -15, 6, -7, -6, -7], "#7a5531");
  // 무기
  ctx.save();
  ctx.translate(8, -20);
  ctx.rotate(-0.4 + (o.swing || 0) * 2.2);
  if (chief) {
    rr(ctx, -2, -20, 4, 22, 2, "#6b4b2a");
    rr(ctx, -4.5, -28, 9, 12, 4, "#5a3b22");
  } else {
    rr(ctx, -1.2, -14, 2.4, 13, 1, "#cfd6dd");
    rr(ctx, -3, -1, 6, 2, 1, "#6b4b2a");
  }
  ctx.restore();
  circ(ctx, 8, -19, 2.8, G);
  // 머리
  circ(ctx, 1, -37, 10, G);
  poly(ctx, [-6, -40, -19, -46, -8, -33], G);
  poly(ctx, [8, -40, 19, -47, 9, -33], G);
  circ(ctx, 3.5, -38, 2.2, "#ffeb3b");
  circ(ctx, 8, -38, 2, "#ffeb3b");
  circ(ctx, 4, -38, 1, "#3b1d00");
  circ(ctx, 8.4, -38, 0.9, "#3b1d00");
  line(ctx, 2, -32, 9, -32.5, "#2c3b20", 1.5);
  poly(ctx, [4, -32.3, 5, -30, 6, -32.4], "#fff");
  if (chief) poly(ctx, [-7, -46, -7, -53, -3.5, -49, 0, -55, 3.5, -49, 7, -53, 7, -46], "#f1c232", "#b8901c");
}

function wolfBody(ctx, t, o, fur, dark, king) {
  const step = Math.sin(t * 6) * 2.5;
  const lunge = (o.swing || 0) * 4;
  // 꼬리
  ctx.beginPath();
  ctx.moveTo(-18, -22);
  ctx.quadraticCurveTo(-30, -30 + Math.sin(t * 4) * 3, -32, -18);
  ctx.quadraticCurveTo(-26, -22, -18, -18);
  ctx.fillStyle = dark;
  ctx.fill();
  for (const [lx, ph] of [[-14, step], [-8, -step], [8, -step], [14, step]]) rr(ctx, lx - 2 + ph, -14, 4.5, 14, 2, lx === -8 || lx === 8 ? dark : fur);
  ell(ctx, -2, -20, 20, 9, fur);
  ell(ctx, -2, -16, 15, 5, dark);
  if (king) {
    ell(ctx, 12, -25, 9, 11, "#f4f6fa");
  }
  ctx.save();
  ctx.translate(14 + lunge, -30);
  circ(ctx, 0, 0, 8, fur);
  poly(ctx, [4, -3, 16, 1, 15, 5, 4, 6], fur);
  circ(ctx, 15.5, 2, 1.8, "#1c1c1c");
  poly(ctx, [-5, -5, -3, -15, 1, -7], dark);
  poly(ctx, [1, -6, 4, -15, 6, -5], dark);
  if (king) {
    ctx.save();
    ctx.shadowColor = "#7fd3ff";
    ctx.shadowBlur = 8;
    circ(ctx, 5, -1, 1.8, "#7fd3ff");
    ctx.restore();
    poly(ctx, [-5, -11, -5, -18, -2, -14, 1, -20, 4, -14, 7, -18, 7, -11], "#f1c232", "#b8901c");
  } else circ(ctx, 5, -1, 1.6, "#f5c542");
  if (o.swing) poly(ctx, [6, 5, 15, 5, 14, 9, 7, 8], "#7a1f1f");
  ctx.restore();
}

// ───────── 마을 ─────────
export function drawTree(ctx, x, y, s = 1, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ell(ctx, 0, 0, 22, 7, "rgba(0,0,0,0.22)");
  rr(ctx, -5, -30, 10, 30, 3, "#7a5230");
  const sway = Math.sin(t * 1.2 + x) * 1.2;
  circ(ctx, -12 + sway, -40, 17, "#2f7d3a");
  circ(ctx, 12 + sway, -42, 16, "#2f7d3a");
  circ(ctx, 0 + sway, -58, 20, "#3a9447");
  circ(ctx, -6 + sway, -64, 8, "rgba(255,255,255,0.08)");
  ctx.restore();
}

export function drawBuilding(ctx, b, t) {
  const { x, y, w, h } = b;
  ctx.save();
  ell(ctx, x + w / 2, y + h, w * 0.55, 12, "rgba(0,0,0,0.2)");
  if (b.kind === "gate") {
    rr(ctx, x, y + 20, w, h - 20, 16, "#6b6f78");
    for (let i = 0; i < 6; i++) rr(ctx, x + 8 + i * ((w - 16) / 6), y + 26 + (i % 2) * 6, (w - 16) / 6 - 4, 14, 3, "#7d828c");
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + h);
    ctx.lineTo(x + w * 0.25, y + h * 0.5);
    ctx.arc(x + w / 2, y + h * 0.5, w * 0.25, Math.PI, 0);
    ctx.lineTo(x + w * 0.75, y + h);
    const g = ctx.createLinearGradient(0, y + h * 0.3, 0, y + h);
    g.addColorStop(0, "#120d14");
    g.addColorStop(1, "#2a1d2e");
    ctx.fillStyle = g;
    ctx.fill();
    for (const tx of [x + w * 0.14, x + w * 0.86]) torch(ctx, tx, y + h * 0.48, t);
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(t * 2) * 0.1;
    ell(ctx, x + w / 2, y + h * 0.75, w * 0.16, h * 0.18, "#8a5cff");
    ctx.restore();
  } else if (b.kind === "smithy") {
    rr(ctx, x, y + h * 0.35, w, h * 0.65, 6, "#8a6a4a");
    rr(ctx, x, y + h * 0.85, w, h * 0.15, 4, "#6b6f78");
    poly(ctx, [x - 10, y + h * 0.4, x + w / 2, y, x + w + 10, y + h * 0.4], "#4a3a3a");
    rr(ctx, x + w * 0.7, y - 8, 18, 40, 3, "#5d5f66");
    smoke(ctx, x + w * 0.7 + 9, y - 10, t);
    rr(ctx, x + w * 0.38, y + h * 0.55, w * 0.24, h * 0.45, 4, "#3b2a1a");
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(t * 7) * 0.2;
    rr(ctx, x + w * 0.1, y + h * 0.5, 22, 18, 3, "#ff8a3d");
    ctx.restore();
    // 모루
    poly(ctx, [x + w + 6, y + h - 22, x + w + 40, y + h - 22, x + w + 34, y + h - 14, x + w + 12, y + h - 14], "#40434a");
    rr(ctx, x + w + 18, y + h - 14, 10, 14, 2, "#40434a");
  } else if (b.kind === "shop") {
    rr(ctx, x, y + h * 0.3, w, h * 0.7, 6, "#c79a62");
    poly(ctx, [x - 8, y + h * 0.35, x + w / 2, y, x + w + 8, y + h * 0.35], "#8f3b3b");
    for (let i = 0; i < 7; i++) {
      const sx = x - 6 + i * ((w + 12) / 7);
      poly(ctx, [sx, y + h * 0.42, sx + (w + 12) / 7, y + h * 0.42, sx + (w + 12) / 7 - 4, y + h * 0.56, sx + 4, y + h * 0.56], i % 2 ? "#f4f1ea" : "#d0503f");
    }
    rr(ctx, x + w * 0.4, y + h * 0.6, w * 0.22, h * 0.4, 4, "#5a3b22");
    rr(ctx, x + 12, y + h * 0.62, 28, 22, 3, "#a8d8f0", "#5a3b22");
    for (const [cx, cy] of [[x - 30, y + h - 18], [x - 12, y + h - 30]]) rr(ctx, cx, cy, 20, 18, 2, "#9b6b3a", "#6b4b2a");
    circ(ctx, x + w + 22, y + h - 10, 9, "#d9a54a");
  } else if (b.kind === "cards") {
    rr(ctx, x, y + h * 0.3, w, h * 0.7, 6, "#cdbfe0");
    poly(ctx, [x - 8, y + h * 0.35, x + w / 2, y - 10, x + w + 8, y + h * 0.35], "#6a4c9c");
    rr(ctx, x + w * 0.38, y + h * 0.58, w * 0.24, h * 0.42, 10, "#4a3570");
    ctx.save();
    ctx.translate(x + w / 2, y + h * 0.18);
    ctx.rotate(Math.sin(t * 1.5) * 0.12);
    rr(ctx, -10, -13, 20, 26, 3, "#fff8e1", "#6a4c9c");
    star(ctx, 0, 0, 6, "#c07bff");
    ctx.restore();
    for (const wx of [x + 14, x + w - 38]) rr(ctx, wx, y + h * 0.5, 24, 20, 3, "#ffe9a8", "#6a4c9c");
  } else if (b.kind === "fountain") {
    ell(ctx, x + w / 2, y + h / 2, w / 2, h / 2, "#9aa0aa");
    ell(ctx, x + w / 2, y + h / 2 - 3, w / 2 - 8, h / 2 - 8, "#4aa3d8");
    for (let i = 0; i < 3; i++) {
      const r = ((t * 20 + i * 12) % 36) + 4;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2 - 3, r, r * 0.45, 0, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - r / 40)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    rr(ctx, x + w / 2 - 5, y + h / 2 - 30, 10, 28, 3, "#b4bac4");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t;
      circ(ctx, x + w / 2 + Math.cos(a) * 7, y + h / 2 - 30 + ((t * 40 + i * 9) % 26), 2, "rgba(170,220,255,0.8)");
    }
  }
  ctx.restore();
}

function torch(ctx, x, y, t) {
  rr(ctx, x - 3, y, 6, 16, 2, "#5a3b22");
  ctx.save();
  ctx.shadowColor = "#ffb347";
  ctx.shadowBlur = 18;
  const f = Math.sin(t * 13 + x) * 1.5;
  poly(ctx, [x - 5, y, x, y - 14 - f, x + 5, y], "#ff8a3d");
  poly(ctx, [x - 2.5, y, x, y - 8 - f, x + 2.5, y], "#ffe08a");
  ctx.restore();
}
function smoke(ctx, x, y, t) {
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.4 + i / 4) % 1;
    circ(ctx, x + Math.sin(p * 6 + i) * 6, y - p * 50, 5 + p * 9, `rgba(200,200,205,${0.45 * (1 - p)})`);
  }
}

export function drawLabel(ctx, text, x, y, o = {}) {
  ctx.save();
  ctx.font = `${o.bold ? "700 " : ""}${o.size || 12}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 12;
  const h = (o.size || 12) + 8;
  rr(ctx, x - w / 2, y - h / 2, w, h, h / 2, o.bg || "rgba(20,20,30,0.65)");
  ctx.fillStyle = o.color || "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

// 바닥 무늬: 같은 자리에 같은 점이 찍히게 좌표로 정하는 난수
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function drawGrass(ctx, cam, W, H) {
  ctx.fillStyle = "#6dbb5a";
  ctx.fillRect(0, 0, W, H);
  const s = 40;
  const x0 = Math.floor(cam.x / s) - 1;
  const y0 = Math.floor(cam.y / s) - 1;
  for (let gx = x0; gx < x0 + W / s + 3; gx++)
    for (let gy = y0; gy < y0 + H / s + 3; gy++) {
      const r = hash(gx, gy);
      const px = gx * s - cam.x + r * 30;
      const py = gy * s - cam.y + hash(gy, gx) * 30;
      if (r < 0.35) {
        line(ctx, px, py, px - 2, py - 6, "#5aa64a", 2);
        line(ctx, px + 3, py, px + 4, py - 5, "#5aa64a", 2);
      } else if (r < 0.4) {
        circ(ctx, px, py, 2.5, r < 0.37 ? "#fff6a8" : "#ffb3c7");
      } else if (r < 0.62) ell(ctx, px, py, 12, 6, "rgba(255,255,255,0.05)");
    }
}
export function drawPath(ctx, pts, cam) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [w, c] of [[64, "#b8935a"], [54, "#d2b07a"]]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - cam.x, y - cam.y) : ctx.moveTo(x - cam.x, y - cam.y)));
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.stroke();
  }
  ctx.restore();
}

// ───────── 던전 ─────────
const THEMES = {
  cave: { floor: "#4a4250", tile: "#544b5b", wall: "#2c2632", deco: "#6b6075", light: "#ffb347" },
  mine: { floor: "#5b4636", tile: "#664f3d", wall: "#33261c", deco: "#7a5a3a", light: "#ffd27a" },
  forest: { floor: "#2f4a33", tile: "#36553a", wall: "#1c2e1f", deco: "#4c7a3f", light: "#b6ff9a" },
};
export function drawRoom(ctx, theme, ox, oy, t, o = {}) {
  const T = THEMES[theme] || THEMES.cave;
  const W = 960;
  const H = 540;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = T.floor;
  ctx.fillRect(0, 0, W, H);
  for (let gx = 0; gx < W / 48; gx++)
    for (let gy = 2; gy < H / 48; gy++) {
      const r = hash(gx + 7, gy + 3);
      rr(ctx, gx * 48 + 2, gy * 48 + 2, 44, 44, 6, r < 0.5 ? T.tile : T.floor);
      if (r > 0.92) circ(ctx, gx * 48 + 24, gy * 48 + 30, 4, T.deco);
    }
  // 위쪽 벽
  ctx.fillStyle = T.wall;
  ctx.fillRect(0, 0, W, 110);
  for (let i = 0; i < 20; i++) rr(ctx, i * 50 + (hash(i, 1) * 10 - 5), 70 + hash(i, 2) * 30, 46, 40, 10, T.wall);
  for (let i = 0; i < 24; i++) rr(ctx, i * 42 + 4, 14 + (i % 2) * 18, 36, 30, 6, "rgba(255,255,255,0.04)");
  if (theme === "mine") {
    for (const bx of [180, 480, 780]) {
      rr(ctx, bx, 20, 16, 120, 2, "#6b4b2a");
      rr(ctx, bx - 30, 20, 76, 14, 2, "#7a5a3a");
    }
    for (let i = 0; i < 20; i++) rr(ctx, i * 50, 455, 30, 6, 2, "#5a3b22");
    line(ctx, 0, 450, W, 450, "#8a8f98", 3);
    line(ctx, 0, 466, W, 466, "#8a8f98", 3);
  }
  if (theme === "forest") {
    for (let i = 0; i < 9; i++) drawTree(ctx, 40 + i * 115, 118 + (i % 2) * 10, 1.1, t);
    for (let i = 0; i < 7; i++) {
      const mx = 60 + hash(i, 9) * 840;
      const my = 160 + hash(9, i) * 340;
      rr(ctx, mx - 2, my - 8, 4, 8, 1, "#f2e6d0");
      ctx.beginPath();
      ctx.arc(mx, my - 8, 7, Math.PI, 0);
      ctx.fillStyle = "#d0503f";
      ctx.fill();
    }
  }
  for (const tx of [120, 420, 720]) {
    if (theme === "forest") break;
    torch(ctx, tx, 70, t);
    const g = ctx.createRadialGradient(tx, 120, 10, tx, 150, 190);
    g.addColorStop(0, `rgba(255,190,90,${0.16 + Math.sin(t * 6 + tx) * 0.03})`);
    g.addColorStop(1, "rgba(255,190,90,0)");
    ctx.fillStyle = g;
    ctx.fillRect(tx - 200, 40, 400, 320);
  }
  // 오른쪽 문
  if (o.door !== false) {
    const dx = 905;
    const dy = 230;
    rr(ctx, dx - 8, dy - 10, 66, 140, 8, T.wall);
    if (o.open) {
      const g = ctx.createLinearGradient(dx, 0, dx + 50, 0);
      g.addColorStop(0, "#0c0a0e");
      g.addColorStop(1, "rgba(255,230,160,0.55)");
      rr(ctx, dx, dy, 50, 120, 6, g);
      ctx.save();
      ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.2;
      drawLabel(ctx, "다음 방 ▶", dx + 4, dy - 26, { size: 13, bold: true, bg: "rgba(255,200,80,0.85)", color: "#3b2a00" });
      ctx.restore();
    } else {
      rr(ctx, dx, dy, 50, 120, 6, "#6b4b2a");
      for (let i = 0; i < 4; i++) line(ctx, dx + 8 + i * 11, dy + 4, dx + 8 + i * 11, dy + 116, "#40434a", 4);
    }
  }
  ctx.restore();
}

// ───────── 효과 ─────────
// 전투 연출: 날아가는 마법, 베기, 터짐, 떠오르는 숫자 등. 시간(초) 기준으로 그린다.
export class Effects {
  constructor() {
    this.list = [];
    this.parts = [];
    this.shakeT = 0;
    this.shakeP = 0;
  }
  add(kind, o) {
    this.list.push({ kind, t0: performance.now() / 1000, dur: 0.5, ...o });
  }
  text(x, y, text, color = "#fff", size = 22, dur = 1.1) {
    this.add("text", { x, y, text, color, size, dur });
  }
  shake(p = 6, d = 0.25) {
    this.shakeP = Math.max(this.shakeP, p);
    this.shakeT = Math.max(this.shakeT, d);
  }
  burst(x, y, color, n = 14, speed = 160, size = 4, g = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: 0.5 + Math.random() * 0.4, age: 0, color, size: size * (0.6 + Math.random() * 0.8), g });
    }
  }
  rise(x, y, color, n = 10, spread = 30) {
    for (let i = 0; i < n; i++)
      this.parts.push({ x: x + (Math.random() - 0.5) * spread * 2, y: y + Math.random() * 20, vx: 0, vy: -50 - Math.random() * 60, life: 0.8 + Math.random() * 0.5, age: 0, color, size: 3 + Math.random() * 3, g: 0, plus: Math.random() < 0.5 });
  }
  offset() {
    if (this.shakeT <= 0) return [0, 0];
    return [(Math.random() - 0.5) * this.shakeP * 2, (Math.random() - 0.5) * this.shakeP * 2];
  }
  update(dt) {
    this.shakeT -= dt;
    if (this.shakeT <= 0) this.shakeP = 0;
    for (const p of this.parts) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    const now = performance.now() / 1000;
    this.list = this.list.filter((f) => now - f.t0 < f.dur);
  }
  draw(ctx) {
    const now = performance.now() / 1000;
    for (const p of this.parts) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, a);
      if (p.plus) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size, p.y - p.size * 0.3, p.size * 2, p.size * 0.6);
        ctx.fillRect(p.x - p.size * 0.3, p.y - p.size, p.size * 0.6, p.size * 2);
      } else circ(ctx, p.x, p.y, p.size, p.color);
    }
    ctx.globalAlpha = 1;
    for (const f of this.list) {
      const p = Math.min(1, (now - f.t0) / f.dur);
      FX[f.kind] && FX[f.kind](ctx, f, p, now);
    }
    ctx.globalAlpha = 1;
  }
}

const lerp = (a, b, p) => a + (b - a) * p;
const FX = {
  text(ctx, f, p) {
    const y = f.y - 46 * Math.min(1, p * 1.6);
    ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    ctx.font = `800 ${f.size * (p < 0.12 ? 0.6 + p * 3.4 : 1)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(f.text, f.x, y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, y);
  },
  proj(ctx, f, p) {
    const x = lerp(f.x1, f.x2, p);
    const y = lerp(f.y1, f.y2, p) - Math.sin(p * Math.PI) * (f.arc || 0);
    const c = { fire: ["#ff8a3d", "#ffe08a"], ice: ["#8fdcff", "#ffffff"], arcane: ["#b57bff", "#f3e3ff"], web: ["#e8e8e8", "#ffffff"], holy: ["#ffd84a", "#fff8d0"], dark: ["#7a2d8c", "#e1a3ff"], rock: ["#8d9099", "#c4c7cf"] }[f.color] || ["#fff", "#fff"];
    ctx.save();
    ctx.shadowColor = c[0];
    ctx.shadowBlur = 16;
    for (let i = 4; i >= 1; i--) {
      const q = Math.max(0, p - i * 0.04);
      circ(ctx, lerp(f.x1, f.x2, q), lerp(f.y1, f.y2, q) - Math.sin(q * Math.PI) * (f.arc || 0), (f.r || 9) * (1 - i * 0.18), c[0] + "88");
    }
    if (f.color === "ice") {
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(f.y2 - f.y1, f.x2 - f.x1));
      poly(ctx, [-14, 0, 0, -6, 14, 0, 0, 6], c[0]);
      poly(ctx, [-6, 0, 0, -3, 8, 0, 0, 3], c[1]);
    } else {
      circ(ctx, x, y, f.r || 9, c[0]);
      circ(ctx, x - 2, y - 2, (f.r || 9) * 0.5, c[1]);
    }
    ctx.restore();
  },
  slash(ctx, f, p) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot || -0.6);
    ctx.globalAlpha = 1 - p;
    const r = (f.r || 34) * (0.7 + p * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r, -1.2 + p * 0.6, 1.0 + p * 0.6);
    ctx.lineWidth = (f.w || 6) * (1 - p * 0.6);
    ctx.strokeStyle = f.color || "#ffffff";
    ctx.shadowColor = f.color || "#fff";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  },
  claw(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p;
    for (let i = -1; i <= 1; i++) line(ctx, f.x - 18 + i * 9, f.y - 22, f.x + 10 + i * 9, f.y + 16 * Math.min(1, p * 3), f.color || "#ff5a5a", 4);
    ctx.restore();
  },
  ring(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, (f.r || 60) * p + 6, ((f.r || 60) * p + 6) * (f.flat || 1), 0, 0, TAU);
    ctx.lineWidth = 4;
    ctx.strokeStyle = f.color || "#fff";
    ctx.stroke();
    ctx.restore();
  },
  bubble(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      pts.push(f.x + Math.cos(a) * 34, f.y - 30 + Math.sin(a) * 38);
    }
    poly(ctx, pts, "rgba(110,180,255,0.18)", "#8fc8ff", 3);
    ctx.restore();
  },
  bolt(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.shadowColor = "#bfe6ff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    let x = f.x + (Math.random() - 0.5) * 20;
    let y = f.y - 260;
    ctx.moveTo(x, y);
    while (y < f.y - 20) {
      y += 22 + Math.random() * 14;
      x += (Math.random() - 0.5) * 34;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(f.x, f.y - 30);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#e9f6ff";
    ctx.stroke();
    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(140,200,255,0.35)";
    ctx.stroke();
    ctx.restore();
  },
  beam(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
    const g = ctx.createLinearGradient(0, f.y - 300, 0, f.y);
    g.addColorStop(0, "rgba(255,240,170,0)");
    g.addColorStop(1, f.color || "rgba(255,225,120,0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(f.x - (f.w || 26), f.y - 300, (f.w || 26) * 2, 300);
    ell(ctx, f.x, f.y, (f.w || 26) * 1.6, 8, "rgba(255,240,170,0.6)");
    ctx.restore();
  },
  meteor(ctx, f, p) {
    const x = lerp(f.x + 220, f.x, p);
    const y = lerp(f.y - 420, f.y - 20, p);
    ctx.save();
    ctx.shadowColor = "#ff6a00";
    ctx.shadowBlur = 24;
    for (let i = 5; i >= 1; i--) circ(ctx, x + i * 14, y - i * 26, 18 - i * 2.5, `rgba(255,${120 + i * 20},60,${0.5 - i * 0.07})`);
    circ(ctx, x, y, 18, "#ff7b2e");
    circ(ctx, x - 4, y - 4, 9, "#ffd27a");
    ctx.restore();
  },
  aura(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.7;
    ell(ctx, f.x, f.y - 30, 34 + p * 14, 46 + p * 14, f.color || "rgba(255,60,60,0.4)");
    ctx.restore();
  },
  web(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = "#f2f2f2";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      line(ctx, f.x, f.y - 30, f.x + Math.cos(a) * 30, f.y - 30 + Math.sin(a) * 30, "#f2f2f2", 1.5);
    }
    for (const r of [10, 20, 30]) {
      ctx.beginPath();
      ctx.arc(f.x, f.y - 30, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  },
  quake(ctx, f, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p;
    for (let i = 0; i < 5; i++) {
      const x = f.x - 120 + i * 60;
      line(ctx, x, f.y + 10, x + 20 * p, f.y - 4, "#2a2018", 4);
      line(ctx, x + 20 * p, f.y - 4, x + 34 * p, f.y + 8, "#2a2018", 3);
    }
    ctx.restore();
  },
};
