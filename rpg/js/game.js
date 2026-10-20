// 화면 하나(canvas)와 게임 전체 상태, 매 프레임 돌리기, 키보드·터치 입력.
// 그림판 크기는 높이 540 기준이고 가로는 화면 비율에 맞춰 800~1200 사이로 바뀐다 (휴대폰 세로는 640부터).

export const G = {
  me: null, // /api/rpg/me 의 user
  mats: { stone: 0, pack: 0, guard_drop: 0, guard_break: 0 },
  admin: false,
  bossToday: {},
  scene: null,
  W: 960,
  H: 540,
  scale: 1,
  keys: new Set(),
  touch: matchMedia("(pointer: coarse)").matches,
  t: 0,
};

// 개발자 도구에서 들여다보기용 (서버가 결과를 정하니 고쳐도 게임에는 영향 없음)
window.rpg = G;

export const cv = document.getElementById("cv");
export const ctx = cv.getContext("2d");

export function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  G.H = 540;
  G.W = Math.round(Math.max(vw < vh ? 640 : 800, Math.min(1200, (540 * vw) / vh)));
  G.scale = Math.min(vw / G.W, vh / G.H);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = `${G.W * G.scale}px`;
  cv.style.height = `${G.H * G.scale}px`;
  cv.width = Math.round(G.W * G.scale * dpr);
  cv.height = Math.round(G.H * G.scale * dpr);
  G.px = G.scale * dpr;
  document.documentElement.style.setProperty("--cv-top", `${(vh - G.H * G.scale) / 2}px`);
  document.documentElement.style.setProperty("--cv-h", `${G.H * G.scale}px`);
  document.body.classList.toggle("portrait", vw < vh);
}
window.addEventListener("resize", resize);
resize();

export function setScene(s) {
  if (G.scene && G.scene.exit) G.scene.exit();
  G.scene = s;
  if (s && s.enter) s.enter();
}

// 픽셀 그림은 작은 그림판(buf)에 그린 뒤 S배로 키워 붙인다(번짐 없이). 장면마다 S가 다를 수 있다(전투 4배).
// 글자(이름, 피해 숫자)는 그 위에 큰 그림판 좌표로 따로 쓴다(overlay).
export const buf = document.createElement("canvas");
export const bctx = buf.getContext("2d");
G.S = 3;
G.BW = 320;
G.BH = 180;

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.t += dt;
  const sc = G.scene;
  G.S = (sc && sc.S) || 3;
  G.BW = Math.ceil(G.W / G.S);
  G.BH = Math.ceil(G.H / G.S);
  if (buf.width !== G.BW || buf.height !== G.BH) {
    buf.width = G.BW;
    buf.height = G.BH;
  }
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.imageSmoothingEnabled = false;
  bctx.fillStyle = "#181425";
  bctx.fillRect(0, 0, G.BW, G.BH);
  if (sc) {
    try {
      sc.update && sc.update(dt);
      sc.draw && sc.draw(bctx);
    } catch (e) {
      console.error(e);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, G.BW * G.S * G.px, G.BH * G.S * G.px);
  ctx.setTransform(G.px, 0, 0, G.px, 0, 0);
  if (sc && sc.overlay) {
    try {
      sc.overlay(ctx);
    } catch (e) {
      console.error(e);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 키보드: 글자를 치는 중에는 움직이지 않는다
const typing = () => {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
};
const KEYMAP = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
window.addEventListener("keydown", (e) => {
  if (typing()) return;
  const k = KEYMAP[e.code];
  if (k) {
    G.keys.add(k);
    e.preventDefault();
  }
  if (G.scene && G.scene.key) G.scene.key(e);
});
window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.code];
  if (k) G.keys.delete(k);
});
window.addEventListener("blur", () => G.keys.clear());

// 화면 누르기 → 그림판 좌표
cv.addEventListener("pointerdown", (e) => {
  const r = cv.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * G.W;
  const y = ((e.clientY - r.top) / r.height) * G.H;
  if (G.scene && G.scene.tap) G.scene.tap(x, y, e);
});

// 방향 입력 (-1~1)
export function axis() {
  let x = 0;
  let y = 0;
  if (G.keys.has("left")) x -= 1;
  if (G.keys.has("right")) x += 1;
  if (G.keys.has("up")) y -= 1;
  if (G.keys.has("down")) y += 1;
  if (x && y) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return { x, y };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
