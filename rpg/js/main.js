// 처음: 로그인·가입 → 직업 고르기 → 마을 (던전 안이었으면 던전으로)
import { G, setScene } from "./game.js";
import { api, net } from "./net.js";
import { $, el, toast, setupChat, setupDpad, showLayer, closeModal, applyFrames, icon } from "./ui.js";
import { townScene, GATE_SPAWN } from "./town.js";
import { dungeonScene } from "./dungeon.js";
import { drawHero } from "./draw.js";
import { TOWN_W, TOWN_H, drawGround, objects, drawAbove } from "./art/town.js";
import { PAL, rect, hash } from "./pixel.js";
import { CLASSES, CLASS_KEYS, SKILLS, skillText, cardsOf } from "../shared/content.js";

applyFrames();
setupChat();
setupDpad();
net.onLogin = () => location.reload();

// 로그인·직업 고르기 뒤에 천천히 흘러가는 마을 풍경
const titleScene = {
  S: 3,
  cam: { x: 0, y: 0 },
  update(dt) {
    const T = (G.t * 6) % (2 * Math.max(1, TOWN_W - G.BW));
    this.cam.x = Math.round(Math.max(0, Math.min(TOWN_W - G.BW, T < TOWN_W - G.BW ? T : 2 * (TOWN_W - G.BW) - T)));
    this.cam.y = Math.round(Math.max(0, Math.min(TOWN_H - G.BH, TOWN_H * 0.42 - G.BH / 2)));
  },
  draw(c) {
    const { x, y } = this.cam;
    drawGround(c, x, y, G.t);
    for (const o of objects(G.t).sort((a, b) => a.y - b.y)) o.draw(c, x, y);
    drawAbove(c, x, y, G.t);
  },
};

function hideGame() {
  setScene(titleScene);
  showLayer(null);
  $("#chat").hidden = true;
  $("#dpad").hidden = true;
}

function authScreen(mode = "login") {
  hideGame();
  const err = el("div.err");
  const name = el("input", { name: "name", autocomplete: "name", maxlength: 12, placeholder: "예: 홍길동" });
  const login = el("input", { name: "username", autocomplete: "username", maxlength: 16, placeholder: "영문 소문자·숫자 4~16자", autocapitalize: "off", spellcheck: "false" });
  const pw = el("input", { name: "password", type: "password", autocomplete: mode === "login" ? "current-password" : "new-password", maxlength: 64, placeholder: "6자 이상" });
  const pw2 = el("input", { type: "password", autocomplete: "new-password", maxlength: 64, placeholder: "한 번 더" });
  const btn = el("button.btn", { type: "submit" }, mode === "login" ? "로그인" : "가입하기");
  const form = el(
    "form",
    {
      on: {
        submit: async (e) => {
          e.preventDefault();
          err.textContent = "";
          if (mode === "signup" && pw.value !== pw2.value) return (err.textContent = "비밀번호 두 개가 달라요.");
          btn.disabled = true;
          try {
            if (mode === "login") await api("login", { login: login.value, password: pw.value });
            else await api("signup", { name: name.value, login: login.value, password: pw.value });
            await boot();
          } catch (x) {
            err.textContent = x.message;
            btn.disabled = false;
          }
        },
      },
    },
    mode === "signup" ? el("label", {}, "이름 (실명, 게임 안에서 보여요)", name) : null,
    el("label", {}, "아이디", login),
    el("label", {}, "비밀번호", pw),
    mode === "signup" ? el("label", {}, "비밀번호 확인", pw2) : null,
    err,
    btn,
    mode === "signup" ? el("p.muted", { style: { margin: 0 } }, "비밀번호 찾기 메일은 없어요. 잊으면 관리자에게 임시 비밀번호를 받아요.") : null,
  );
  $("#screen").replaceChildren(
    el(
      "div.auth",
      {},
      el("h1", {}, "던전 RPG"),
      el("p.lead", {}, "친구들과 같이 키우는 턴제 카드 RPG"),
      el("div.tabs", {}, el("button" + (mode === "login" ? ".on" : ""), { on: { click: () => authScreen("login") } }, "로그인"), el("button" + (mode === "signup" ? ".on" : ""), { on: { click: () => authScreen("signup") } }, "가입")),
      form,
    ),
  );
  (mode === "signup" ? name : login).focus();
}

function pickScreen() {
  hideGame();
  let chosen = null;
  const err = el("div.err");
  const go = el("button.btn", { disabled: true, on: { click: pick } }, "이 직업으로 시작");
  const cards = CLASS_KEYS.map((k) => {
    const c = CLASSES[k];
    const cv = el("canvas", { width: 72, height: 40 });
    const box = el(
      "div.cl",
      { on: { click: () => select(k) } },
      cv,
      el("h3", {}, c.name),
      el("p", {}, c.desc),
      el("div.stat", {}, `체력 ${c.hp} (레벨마다 +${c.hpPer})`),
      el("div.stat", {}, "기술: ", ...c.skills.map((s) => el("span.money", { title: skillText(SKILLS[s]) }, icon("skill:" + s), `${SKILLS[s].name}(Lv ${SKILLS[s].lv}) `))),
      el("div.stat", { title: cardsOf(k, 0).map((x) => x.name).join(", ") }, `처음 카드: ${cardsOf(k, 0).map((x) => x.name).join(", ")}`),
    );
    box.dataset.k = k;
    return { k, box, cv };
  });
  function select(k) {
    chosen = k;
    go.disabled = false;
    for (const c of cards) c.box.classList.toggle("on", c.k === k);
    go.textContent = `${CLASSES[k].name}로 시작`;
  }
  async function pick() {
    go.disabled = true;
    try {
      await api("class", { cls: chosen });
      await boot();
    } catch (x) {
      err.textContent = x.message;
      go.disabled = false;
    }
  }
  $("#screen").replaceChildren(
    el(
      "div.pick",
      {},
      el("h1", {}, `${G.me.name}님, 직업을 골라 주세요`),
      el("p.muted", {}, "직업은 하나로 쭉 키워요. 나중에 검사·암살자·궁수도 열려요."),
      el("div.classes", {}, ...cards.map((c) => c.box)),
      err,
      el("div", { style: { marginTop: "16px" } }, go),
    ),
  );
  // 고르는 화면의 캐릭터도 움직이게 (고르면 걷다가 무기를 휘두른다)
  let t = 0;
  const tick = () => {
    if (!cards[0].cv.isConnected) return;
    t += 1 / 60;
    for (const c of cards) {
      const x = c.cv.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.fillStyle = PAL.G;
      x.fillRect(0, 0, 72, 40);
      for (let i = 0; i < 72; i++) for (let j = 0; j < 40; j++) if (hash(i, j, 3) < 0.05) rect(x, i, j, 1, 1, hash(i, j, 4) < 0.5 ? PAL.F : PAL.L);
      rect(x, 0, 30, 72, 10, PAL.k);
      rect(x, 0, 30, 72, 1, PAL.t);
      const on = c.k === chosen;
      const p = (t * 1.2) % 1;
      const atk = c.k === "warrior" ? { swing: on ? Math.max(0, Math.sin(p * Math.PI)) : 0 } : { cast: on ? Math.max(0, Math.sin(p * Math.PI)) : 0 };
      drawHero(x, c.k, 36, 34, { battle: true, t: t + c.k.length, ...atk });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function goTown(spawn) {
  closeModal();
  const s = townScene(spawn);
  s.onGo((run) => goDungeon(run));
  setScene(s);
}
function goDungeon(run) {
  setScene(dungeonScene(run, { onExit: () => goTown(GATE_SPAWN) }));
}

async function boot() {
  let m;
  try {
    m = await api("me");
  } catch (e) {
    if (e.status === 401) return authScreen();
    $("#screen").replaceChildren(el("div.auth", {}, el("p", {}, e.message), el("button.btn", { on: { click: () => location.reload() } }, "다시 하기")));
    return;
  }
  Object.assign(G, { me: m.user, mats: m.mats, admin: m.admin, bossToday: m.bossToday });
  if (!m.user.cls) return pickScreen();
  $("#screen").replaceChildren();
  if (m.daily) setTimeout(() => toast("오늘 첫 접속 선물로 카드 팩 1개를 받았어요!", "good"), 600);
  if (m.user.run) goDungeon(m.user.run);
  else goTown();
}

boot();
