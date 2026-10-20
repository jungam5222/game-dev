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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.t += dt;
  ctx.setTransform(G.px, 0, 0, G.px, 0, 0);
  if (G.scene) {
    try {
      G.scene.update && G.scene.update(dt);
      G.scene.draw && G.scene.draw(ctx);
    } catch (e) {
      console.error(e);
    }
  } else {
    ctx.fillStyle = "#151824";
    ctx.fillRect(0, 0, G.W, G.H);
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
