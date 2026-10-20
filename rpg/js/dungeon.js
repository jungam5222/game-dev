// 던전: 방을 걸어 다니다가 몬스터에게 닿으면 전투. 전투는 서버가 보낸 events를 차례로 연출한다.
import { G, axis, sleep } from "./game.js";
import { openSocket, api } from "./net.js";
import { drawHero, drawMonster, drawSpirit, drawRoom, drawLabel, Effects, MONSTER_TOP } from "./draw.js";
import { $, el, toast, chat, setPrompt, showLayer, modalOpen, cardTile, ask, closeModal } from "./ui.js";
import { showRewards } from "./panels.js";
import { CARDS, SKILLS, MOVES, STAGES, MONSTERS, needsTarget, skillText } from "../shared/content.js";

const ROOM = { w: 960, h: 540, foeX: 600, doorX: 905, midY: 290 };
const SPEED = 220;
const PSLOT = [[0.31, 330], [0.2, 272], [0.2, 384], [0.09, 330]];
const ESLOT = [[0.69, 330], [0.8, 272], [0.8, 384], [0.91, 330]];
const ESLOT_BOSS = [[0.7, 345], [0.86, 262], [0.87, 395], [0.94, 330]];
const HERO_SCALE = 1.45;
const MON_SCALE = 1.45;
const tween = (fn, ms) =>
  new Promise((res) => {
    if (document.hidden || ms <= 0) {
      fn(1);
      return res();
    }
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      fn(p);
      if (p < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
const ease = (p) => 1 - (1 - p) * (1 - p);

export function dungeonScene(run, { onExit }) {
  let V = null; // 마지막으로 적용한 서버 상태
  let sock = null;
  const me = { x: 110, y: 290, d: 1, walking: false };
  let myRoom = -1;
  const others = new Map(); // 탐험 중 다른 사람 위치
  const units = new Map(); // 전투 그림 단위 "p:1", "e:5", "s:9"
  const fx = new Effects();
  const queue = [];
  let busy = false;
  let target = null; // 고른 적 id
  let pendingPlay = false;
  let deadlineAt = 0;
  let lastTouch = 0;
  let lastSent = 0;
  let sentPos = "";
  let banner = null; // {text, t0, dur, color}
  let ended = false;
  let exiting = false;

  const send = (m) => sock && sock.send(m);
  const W = () => G.W;
  const roomOff = () => (G.W >= ROOM.w ? (G.W - ROOM.w) / 2 : -Math.max(0, Math.min(ROOM.w - G.W, me.x - G.W / 2)));
  const isBattle = () => V && V.phase === "battle";
  const myView = () => V && V.players.find((p) => p.uid === G.me.id);

  function showBanner(text, color = "#ffe9a8", dur = 1.1) {
    banner = { text, color, t0: performance.now() / 1000, dur };
  }

  // ───── 전투 그림 단위 ─────
  function slotOf(kind, i, bossFight) {
    const s = kind === "p" ? PSLOT[i % 4] : (bossFight ? ESLOT_BOSS : ESLOT)[i % 4];
    return { x: s[0] * W(), y: s[1] };
  }
  function layout(v = V) {
    if (!v) return;
    const ps = v.players.filter((p) => !p.left);
    ps.forEach((p, i) => {
      const u = units.get("p:" + p.uid);
      if (u) Object.assign(u, slotOf("p", i));
    });
    const bossFight = v.enemies.some((e) => e.boss);
    let order = [...v.enemies];
    if (bossFight) order.sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0));
    order.forEach((e, i) => {
      const u = units.get("e:" + e.id);
      if (u) Object.assign(u, slotOf("e", i, bossFight));
    });
    for (const s of v.spirits) {
      const u = units.get("s:" + s.id);
      const owner = units.get("p:" + s.owner);
      if (u && owner) {
        const mine = v.spirits.filter((x) => x.owner === s.owner);
        const j = mine.indexOf(s);
        u.x = owner.x + 52 + j * 26;
        u.y = owner.y + 18 - j * 30;
      }
    }
  }
  function unitFor(id, kind, d) {
    let u = units.get(id);
    if (!u) {
      u = { id, kind, d: { ...d }, x: 0, y: 0, ox: 0, oy: 0, hurt: 0, swing: 0, cast: 0, alpha: kind === "p" ? 1 : 0, dead: false, born: performance.now() };
      units.set(id, u);
    } else u.d = { ...u.d, ...d };
    return u;
  }
  function syncUnits(v) {
    const keep = new Set();
    for (const p of v.players) {
      if (p.left) continue;
      const u = unitFor("p:" + p.uid, "p", p);
      u.dead = p.down;
      keep.add(u.id);
    }
    for (const e of v.enemies) {
      const u = unitFor("e:" + e.id, "e", e);
      u.dead = e.hp <= 0;
      keep.add(u.id);
    }
    for (const s of v.spirits) {
      const u = unitFor("s:" + s.id, "s", s);
      keep.add(u.id);
    }
    for (const id of [...units.keys()]) if (!keep.has(id)) units.delete(id);
    if (target == null || !v.enemies.some((e) => e.id === target && e.hp > 0)) {
      const first = v.enemies.find((e) => e.hp > 0);
      target = first ? first.id : null;
    }
    layout(v);
  }
  const top = (u) => (u.kind === "p" ? 92 * HERO_SCALE * 0.72 + 28 : u.kind === "s" ? 56 : (MONSTER_TOP[u.d.k] || 50) * MON_SCALE + 14);
  const center = (u) => ({ x: u.x + u.ox, y: u.y + u.oy - top(u) * 0.45 });

  // ───── 서버 상태 적용 ─────
  function applyView(v) {
    const prevPhase = V && V.phase;
    V = v;
    if (v.phase === "explore") {
      units.clear();
      if (myRoom !== v.room) {
        myRoom = v.room;
        const p = myView();
        if (p) {
          me.x = p.x;
          me.y = p.y;
        }
        others.clear();
      }
      for (const p of v.players)
        if (p.uid !== G.me.id && !p.left) {
          const o = others.get(p.uid);
          if (o) Object.assign(o, { tx: p.x, ty: p.y, name: p.name, cls: p.cls, online: p.online });
          else others.set(p.uid, { ...p, tx: p.x, ty: p.y });
        }
      for (const uid of [...others.keys()]) if (!v.players.some((p) => p.uid === uid && !p.left)) others.delete(uid);
    } else if (v.phase === "battle") {
      syncUnits(v);
      deadlineAt = performance.now() + v.left;
    }
    if (prevPhase !== v.phase) document.body.classList.toggle("battle", v.phase === "battle");
    renderUi();
  }

  // ───── 연출 ─────
  const MELEE = new Set(["slash", "smash", "charge", "counter", "attack", "heavy", "drain", "poison", "spiritHit"]);
  const PROJ = { fire: "fire", ice: "ice", arcane: "arcane", web: "web" };
  async function lunge(u, to, dist = 70, ms = 170) {
    if (!u) return;
    const dir = u.kind === "e" ? -1 : 1;
    const tx = to ? to.x + to.ox - u.x - dir * dist : dir * 40;
    const ty = to ? (to.y - u.y) * 0.6 : 0;
    await tween((p) => {
      u.ox = tx * ease(p);
      u.oy = ty * ease(p) - Math.sin(p * Math.PI) * 10;
      u.swing = p;
    }, ms);
    setTimeout(() => {
      tween((p) => {
        u.ox = tx * (1 - p);
        u.oy = ty * (1 - p);
        u.swing = 1 - p;
      }, 220);
    }, 140);
  }
  async function castPose(u, ms = 180) {
    if (!u) return;
    await tween((p) => (u.cast = Math.sin(p * Math.PI)), ms);
  }
  async function impact(anim, actor, tu, first) {
    if (!tu) return;
    const c = center(tu);
    if (PROJ[anim] && actor) {
      const a = center(actor);
      await new Promise((r) => {
        const dur = first ? 0.26 : 0.16;
        fx.add("proj", { x1: a.x + (actor.kind === "e" ? -20 : 20), y1: a.y - 10, x2: c.x, y2: c.y, color: PROJ[anim], dur, arc: 30, r: anim === "arcane" ? 7 : 9 });
        setTimeout(r, document.hidden ? 0 : dur * 1000);
      });
      fx.burst(c.x, c.y, { fire: "#ff9a3d", ice: "#bff0ff", arcane: "#d6a8ff", web: "#ffffff" }[anim], 12);
    } else if (anim === "bolt") {
      fx.add("bolt", { x: c.x, y: tu.y, dur: 0.3 });
      fx.burst(c.x, c.y, "#dff3ff", 10);
    } else if (anim === "meteor") {
      fx.add("meteor", { x: tu.x, y: tu.y, dur: 0.35 });
      await sleep(document.hidden ? 0 : 330);
      fx.burst(tu.x, tu.y - 20, "#ff8a3d", 22, 220, 5);
      fx.shake(8, 0.3);
    } else if (anim === "holy") {
      fx.add("beam", { x: tu.x, y: tu.y, dur: 0.5 });
      await sleep(document.hidden ? 0 : 160);
      fx.burst(c.x, c.y, "#ffe27a", 12);
    } else if (anim === "sweep" || anim === "howl") {
      fx.add("slash", { x: c.x, y: c.y, r: 46, rot: 0, color: anim === "howl" ? "#ff7070" : "#ffffff", dur: 0.25, w: 8 });
    } else if (anim === "quake") {
      fx.burst(tu.x, tu.y - 4, "#8a7a66", 8, 120, 4);
    } else if (actor && actor.kind === "e") {
      fx.add("claw", { x: c.x, y: c.y, dur: 0.3 });
    } else if (anim === "spiritHit") {
      fx.burst(c.x, c.y, "#bff0ff", 8, 100, 3);
    } else {
      fx.add("slash", { x: c.x, y: c.y, r: anim === "smash" ? 40 : 32, rot: -0.7, color: "#ffffff", dur: 0.22, w: anim === "smash" ? 9 : 6 });
      if (anim === "smash") fx.shake(5, 0.18);
    }
  }

  let cur = null; // 지금 행동 중 {actor, anim, hits}
  async function playEvent(e, v) {
    const fast = document.hidden || queue.length > 4;
    const wait = (ms) => (fast ? null : sleep(ms));
    const u = e.to ? units.get(e.to) : null;
    const pos = u ? center(u) : null;
    switch (e.e) {
      case "battle":
        V = v;
        document.body.classList.add("battle");
        syncUnits(v);
        renderUi();
        for (const x of units.values()) if (x.kind === "e") tween((p) => (x.alpha = p), 400);
        showBanner("전투 시작!", "#ffd27a");
        await wait(700);
        break;
      case "turn":
        cur = null;
        for (const x of units.values()) if (x.kind === "p") x.d.ready = false;
        showBanner(`${e.turn}턴`, "#ffe9a8", 0.9);
        await wait(400);
        break;
      case "phase":
        cur = null;
        showBanner("적의 차례", "#ff9a8a", 0.8);
        await wait(450);
        break;
      case "act": {
        const actor = units.get(e.by);
        const tu = e.target ? units.get(e.target) : null;
        cur = { actor, anim: e.anim, n: 0 };
        if (e.card || e.skill) {
          const c = e.card ? CARDS[e.card] : SKILLS[e.skill];
          if (actor && c) fx.text(actor.x, actor.y - top(actor) - 26, `${c.icon} ${c.name}`, "#ffe9a8", 15, 1.0);
        } else if (e.move && actor && actor.kind === "e") {
          const M = MOVES[e.move];
          if (M && e.move !== "attack") fx.text(actor.x, actor.y - top(actor) - 26, `${M.icon} ${M.name}`, "#ffb3a8", 15, 1.0);
        }
        if (MELEE.has(e.anim)) await lunge(actor, tu, e.anim === "charge" ? 50 : 70, e.anim === "heavy" ? 240 : 170);
        else if (e.anim === "sweep") await lunge(actor, null);
        else if (e.anim === "quake") {
          await tween((p) => actor && (actor.oy = -Math.sin(p * Math.PI) * 30), 260);
          fx.add("quake", { x: e.by.startsWith("e") ? W() * 0.28 : W() * 0.75, y: 340, dur: 0.6 });
          fx.shake(9, 0.35);
        } else if (e.anim === "howl" || e.anim === "shout") {
          if (actor) fx.add("ring", { x: actor.x, y: actor.y - top(actor) * 0.5, r: 120, color: e.anim === "howl" ? "#ff7070" : "#ffd27a", dur: 0.5 });
          await castPose(actor);
          if (e.anim === "howl") fx.shake(5, 0.25);
        } else if (e.anim === "summon") {
          if (actor) fx.add("ring", { x: actor.x, y: actor.y - 20, r: 70, color: "#c0c0c0", dur: 0.5 });
          await wait(250);
        } else if (e.anim === "enrage") {
          if (actor) fx.add("aura", { x: actor.x, y: actor.y, dur: 0.7, color: "rgba(255,60,60,0.45)" });
          await wait(300);
        } else if (e.anim === "block") {
          await wait(150);
        } else if (e.anim === "web") {
          await castPose(actor, 150);
        } else await castPose(actor);
        break;
      }
      case "dmg": {
        if (!u) break;
        const anim = cur ? cur.anim : null;
        if (cur && e.to !== (cur.actor && cur.actor.id) && anim) {
          await impact(anim, cur.actor, u, cur.n === 0);
          cur.n++;
        }
        u.d.hp = e.hp;
        u.d.block = e.block;
        u.hurt = 1;
        const p2 = center(u);
        if (e.n > 0) fx.text(p2.x, p2.y - 10, `${e.crit ? "치명타! " : ""}-${e.n}`, e.crit ? "#ffd84a" : u.kind === "p" ? "#ff8a80" : "#ffffff", e.crit ? 28 : 22);
        else if (e.blocked) fx.text(p2.x, p2.y - 10, `🛡 ${e.blocked} 막음`, "#9fd0ff", 18);
        if (e.blocked && e.n > 0) fx.text(p2.x + 28, p2.y + 12, `🛡${e.blocked}`, "#9fd0ff", 14);
        if (e.crit) fx.shake(7, 0.22);
        else if (u.kind === "p" && e.n > 0) fx.shake(3, 0.15);
        await wait(130);
        break;
      }
      case "dodge":
        if (u) {
          fx.text(pos.x, pos.y - 10, "회피!", "#7fe7ff", 22);
          const dir = u.kind === "e" ? 1 : -1;
          tween((p) => (u.ox = dir * Math.sin(p * Math.PI) * 34), 320);
        }
        await wait(200);
        break;
      case "fail":
        if (u) fx.text(pos.x, pos.y + 14, `${e.what} 실패`, "#b8bdc9", 14, 0.9);
        await wait(110);
        break;
      case "heal":
        if (u) {
          u.d.hp = e.hp;
          if (e.n > 0) fx.text(pos.x, pos.y - 10, `+${e.n}`, "#7dff9a", 22);
          fx.rise(u.x, u.y - 30, "#7dff9a", 10);
        }
        await wait(150);
        break;
      case "block":
        if (u) {
          u.d.block = e.block;
          fx.add("bubble", { x: u.x, y: u.y - (u.kind === "e" && MONSTERS[u.d.k] && MONSTERS[u.d.k].boss ? 30 : 10), dur: 0.6 });
          fx.text(pos.x, pos.y - 10, `🛡 +${e.n}`, "#9fd0ff", 18);
        }
        await wait(150);
        break;
      case "buff":
        if (u) {
          const t = { dodge: `💨 회피 준비 ${e.n}%`, counter: `↩️ 되갚기 ${e.n}`, taunt: "📢 도발!", crit: `🎯 치명타 +${e.n}%`, rage: "😡 분노!" }[e.what];
          if (e.what === "taunt") u.d.taunt = true;
          if (e.what === "dodge") u.d.dodgeBuff = e.n;
          if (e.what === "counter") u.d.counter = e.n;
          if (t) fx.text(pos.x, pos.y - 4, t, "#ffe9a8", 16);
        }
        await wait(150);
        break;
      case "mana":
        if (u) fx.text(pos.x, pos.y - 4, `💠 마나 +${e.n}`, "#9fd0ff", 16);
        await wait(120);
        break;
      case "stun":
        if (u) {
          fx.text(pos.x, pos.y - 4, "💫 기절!", "#ffe27a", 20);
          if (u.kind === "e") u.d.stun = true;
          else u.d.stun = true;
        }
        await wait(200);
        break;
      case "stunSkip": {
        const a = units.get(e.by);
        if (a) {
          fx.text(a.x, a.y - top(a) - 10, "💫 기절해서 못 움직여요", "#ffe27a", 15);
          a.d.stun = false;
        }
        await wait(350);
        break;
      }
      case "dotOn":
        if (u) {
          fx.text(pos.x, pos.y + 6, e.kind === "burn" ? "🔥 화상" : "🧪 독", e.kind === "burn" ? "#ffb070" : "#9dff7a", 16);
          u.d.dots = [...(u.d.dots || []).filter((d) => d.kind !== e.kind), { kind: e.kind, n: 1, turns: 1 }];
        }
        await wait(100);
        break;
      case "dot":
        if (u) {
          u.d.hp = e.hp;
          u.hurt = 0.6;
          fx.text(pos.x, pos.y - 6, `${e.kind === "burn" ? "🔥" : "🧪"} -${e.n}`, e.kind === "burn" ? "#ffb070" : "#9dff7a", 18);
        }
        await wait(160);
        break;
      case "die":
        if (u) {
          u.dead = true;
          if (u.kind !== "p") tween((p) => (u.alpha = 1 - p * 0.85), 500);
          fx.burst(pos.x, pos.y, u.kind === "p" ? "#ff8a80" : "#d8d8d8", 16, 140, 4);
        }
        await wait(300);
        break;
      case "again":
        if (u) fx.text(pos.x, pos.y - 30, "✨ 한 번 더!", "#d6a8ff", 20);
        await wait(250);
        break;
      case "spirit": {
        if (e.gone) units.delete(e.gone);
        const s = unitFor("s:" + e.unit.id, "s", e.unit);
        s.alpha = 0;
        V.spirits = [...V.spirits.filter((x) => x.id !== e.unit.id && "s:" + x.id !== e.gone), e.unit];
        layout();
        tween((p) => (s.alpha = p), 400);
        fx.rise(s.x, s.y - 20, "#bff0ff", 12);
        await wait(300);
        break;
      }
      case "summon": {
        const s = unitFor("e:" + e.unit.id, "e", e.unit);
        s.alpha = 0;
        V.enemies = [...V.enemies.filter((x) => x.id !== e.unit.id), e.unit];
        layout();
        fx.burst(s.x, s.y - 20, "#c8c8c8", 18, 120, 6, 0);
        tween((p) => (s.alpha = p), 400);
        await wait(400);
        break;
      }
      case "cleanse":
        for (const x of units.values()) if (x.kind === "p" && !x.dead) {
          x.d.dots = [];
          fx.rise(x.x, x.y - 30, "#fff3a0", 8);
        }
        await wait(150);
        break;
      case "ready":
        if (u) u.d.ready = true;
        break;
      case "left":
        if (u) fx.text(pos.x, pos.y - 20, "나갔어요", "#b8bdc9", 16);
        break;
      case "win":
        cur = null;
        showBanner(e.boss ? "보스를 쓰러뜨렸어요!" : "승리!", "#ffd84a", 1.6);
        if (e.exp) fx.text(W() / 2, 250, `경험치 +${e.exp} · 골드 +${e.gold}`, "#ffe9a8", 20, 1.6);
        await wait(1300);
        break;
      case "lose":
        showBanner("모두 쓰러졌어요…", "#ff9a8a", 1.8);
        await wait(1500);
        break;
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const q = queue.shift();
        if (q.ev) for (const e of q.ev) await playEvent(e, q.v);
        applyView(q.v);
        if (q.end) await finish(q.v.result, q.v.won);
      }
    } finally {
      busy = false;
    }
  }

  async function finish(result, won) {
    if (ended) return;
    ended = true;
    await sleep(300);
    showRewards(result, won, () => leaveToTown());
  }

  async function leaveToTown() {
    if (exiting) return;
    exiting = true;
    closeModal();
    if (sock) sock.close();
    sock = null;
    try {
      const m = await api("me");
      Object.assign(G, { me: m.user, mats: m.mats, admin: m.admin, bossToday: m.bossToday });
    } catch (e) {}
    onExit();
  }

  function onMessage(d) {
    if (d.t === "state" || d.t === "ev" || d.t === "end") {
      if (d.t === "ev") pendingPlay = false;
      if (d.v && d.v.me && V) {
        // 손패·마나는 바로 보여 준다
        V = { ...V, me: d.v.me, players: V.players.map((p) => ({ ...p, ready: (d.v.players.find((x) => x.uid === p.uid) || p).ready })) };
        renderUi();
      }
      queue.push({ ev: d.ev || null, v: d.v, end: d.t === "end" });
      pump();
    } else if (d.t === "mv") {
      const o = others.get(d.uid);
      if (o) Object.assign(o, { tx: d.x, ty: d.y, d: d.d });
    } else if (d.t === "chat") chat.add({ name: d.name, text: d.text });
    else if (d.t === "err") {
      pendingPlay = false;
      toast(d.text, "bad");
      renderUi();
    } else if (d.t === "left") {
      ended = true;
      showRewards(d.result, false, () => leaveToTown(), true);
    }
  }

  function connect() {
    sock = openSocket("dungeon/ws?run=" + encodeURIComponent(run), {
      message: onMessage,
      kicked: () => toast("다른 창에서 이 던전에 들어가서 이 창은 멈췄어요.", "bad"),
      fail: async () => {
        try {
          const m = await api("me");
          if (m.user.run === run && !exiting) return connect();
          if (m.user.run && m.user.run !== run) return;
        } catch (e) {}
        if (!ended) toast("던전이 끝났어요.");
        leaveToTown();
      },
    });
  }

  // ───── 화면 아래 손패·기술·턴 끝 ─────
  function canAct() {
    const p = myView();
    return isBattle() && p && !p.down && !p.ready && !p.stunned && !busyBlock();
  }
  const busyBlock = () => pendingPlay;
  function renderUi() {
    const bar = $("#dtop");
    if (!V) return;
    const st = `${V.stage}단계 · ${V.stageName}`;
    const leaveBtn = el("button.btn.ghost.small", { on: { click: confirmLeave } }, "나가기");
    if (V.phase === "battle") {
      const p = myView();
      bar.replaceChildren(el("span", {}, `${st} · 방 ${V.room + 1}/${V.rooms} · ${V.turn}턴`), el("div.timer", {}, el("div")), leaveBtn);
      $("#battle").hidden = false;
      setPrompt(null);
      const m = V.me;
      $("#mana").replaceChildren(...Array.from({ length: Math.max(m.maxMana, m.mana) }, (_, i) => el("i" + (i < m.mana ? ".on" : ""))), el("span", { style: { marginLeft: "4px" } }, `${m.mana}/${m.maxMana}`));
      $("#piles").textContent = `덱 ${m.draw} · 버림 ${m.disc}`;
      const ok = canAct();
      $("#hand").replaceChildren(
        ...m.hand.map((c) =>
          cardTile(c.k, {
            disabled: !ok || CARDS[c.k].cost > m.mana,
            onClick: (ev) => {
              if (!canAct() || CARDS[c.k].cost > V.me.mana) {
                if (p && p.stunned) toast("기절해서 이번 턴은 쉬어요.");
                return;
              }
              ev.currentTarget.classList.add("go");
              pendingPlay = true;
              send({ t: "play", id: c.id, target });
              setTimeout(() => {
                if (pendingPlay) {
                  pendingPlay = false;
                  renderUi();
                }
              }, 4000);
            },
          }),
        ),
      );
      $("#skills").replaceChildren(
        ...m.skills.map((k) => {
          const s = SKILLS[k];
          const cd = m.cd[k] || 0;
          const off = !ok || cd > 0 || m.usedSkill;
          return el(
            "button.skill" + (off ? ".off" : ""),
            {
              title: `${s.name}: ${skillText(s)} (마나 없이, 다시 쓰려면 ${s.cd}턴)`,
              on: {
                click: () => {
                  if (off) return toast(cd > 0 ? `${cd}턴 뒤에 쓸 수 있어요.` : m.usedSkill ? "기술은 한 턴에 하나만 써요." : "지금은 쓸 수 없어요.");
                  pendingPlay = true;
                  send({ t: "skill", key: k, target });
                },
              },
            },
            el("b", {}, s.icon),
            el("span", {}, s.name),
            cd > 0 ? el("span.cd", {}, cd) : null,
          );
        }),
      );
      const btn = $("#endturn");
      const waiting = V.players.filter((x) => !x.left && !x.down && !x.ready);
      if (p && (p.ready || p.down)) {
        btn.className = "btn wait";
        btn.textContent = p.down ? "쓰러짐" : waiting.length ? `기다리는 중 (${waiting.length}명)` : "적의 차례";
        btn.onclick = null;
      } else {
        btn.className = "btn";
        btn.textContent = p && p.stunned ? "기절 (넘기기)" : "턴 끝";
        btn.onclick = () => send({ t: "end" });
      }
    } else {
      $("#battle").hidden = true;
      const hint = V.phase === "done" ? "던전이 끝났어요" : V.cleared ? (V.room + 1 < V.rooms ? "오른쪽 문으로 가면 다음 방이에요" : "") : V.room + 1 === V.rooms ? "보스가 있어요! 다가가면 전투가 시작돼요" : "몬스터에게 다가가면 전투가 시작돼요";
      bar.replaceChildren(el("span", {}, `${st} · 방 ${V.room + 1}/${V.rooms}`), hint ? el("span.muted", {}, hint) : null, leaveBtn);
    }
    $("#dpad").hidden = !G.touch || V.phase !== "explore";
  }

  async function confirmLeave() {
    if (ended) return leaveToTown();
    const ok = await ask("던전에서 나갈까요? 지금까지 얻은 경험치·골드·강화석은 받고, 보스 보상은 못 받아요.", "나가기", "계속하기");
    if (!ok) return;
    if (sock && sock.open) send({ t: "leave" });
    else {
      try {
        await api("run/leave", {});
      } catch (e) {}
      leaveToTown();
    }
    setTimeout(() => !exiting && leaveToTown(), 4000);
  }

  // ───── 그리기 ─────
  function drawBar(c, x, y, w, hp, max, color, block) {
    c.fillStyle = "rgba(0,0,0,0.6)";
    c.beginPath();
    c.roundRect(x - w / 2 - 2, y - 2, w + 4, 11, 4);
    c.fill();
    c.fillStyle = "#3a1010";
    c.fillRect(x - w / 2, y, w, 7);
    c.fillStyle = color;
    c.fillRect(x - w / 2, y, (w * Math.max(0, hp)) / max, 7);
    c.font = "700 10px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#fff";
    c.fillText(`${Math.max(0, hp)}/${max}`, x, y + 3.5);
    if (block > 0) {
      c.fillStyle = "#2f6fd6";
      c.beginPath();
      c.moveTo(x - w / 2 - 16, y - 5);
      c.lineTo(x - w / 2 - 4, y - 5);
      c.lineTo(x - w / 2 - 4, y + 6);
      c.quadraticCurveTo(x - w / 2 - 10, y + 13, x - w / 2 - 16, y + 6);
      c.closePath();
      c.fill();
      c.fillStyle = "#fff";
      c.fillText(block, x - w / 2 - 10, y + 2);
    }
  }
  function statusIcons(d) {
    const s = [];
    if (d.stun || d.stunned) s.push("💫");
    for (const x of d.dots || []) s.push(x.kind === "burn" ? "🔥" : "🧪");
    if (d.taunt) s.push("📢");
    if (d.dodgeBuff > 0) s.push("💨");
    if (d.counter > 0) s.push("↩️");
    if (d.rage > 0) s.push(`😡${d.rage}`);
    return s.join("");
  }
  function drawUnit(c, u, t) {
    const d = u.d;
    const x = u.x + u.ox;
    const y = u.y + u.oy;
    const hurt = u.hurt;
    if (u.kind === "p") drawHero(c, d.cls, x, y, { dir: 1, t: t + d.uid, scale: HERO_SCALE, swing: u.swing, cast: u.cast, hurt, down: u.dead, alpha: d.online === false ? 0.55 : 1 });
    else if (u.kind === "e") drawMonster(c, d.k, x, y, { dir: -1, t: t + d.id, scale: MON_SCALE, swing: u.swing, hurt, dead: u.dead, alpha: u.alpha });
    else drawSpirit(c, x, y, { t: t + d.id, scale: 1.2, hurt, alpha: u.alpha });
    if (u.dead && u.kind !== "p") return;
    const h = top(u);
    const bw = u.kind === "e" && d.boss ? 120 : u.kind === "s" ? 40 : 74;
    drawBar(c, u.x, u.y - h, bw, d.hp, d.maxHp, u.kind === "e" ? "#e5534b" : u.kind === "s" ? "#7fd3ff" : "#4cc46a", d.block);
    if (u.kind === "s") return;
    const isMe = u.kind === "p" && d.uid === G.me.id;
    drawLabel(c, (u.kind === "p" ? `${d.name}` : d.name) + (u.dead ? " (쓰러짐)" : ""), u.x, u.y - h - 12, { size: 11, bg: isMe ? "rgba(40,90,170,0.85)" : u.kind === "e" && d.boss ? "rgba(140,30,30,0.85)" : undefined });
    const icons = statusIcons(d);
    if (icons) {
      c.font = "14px system-ui, sans-serif";
      c.textAlign = "center";
      c.fillText(icons, u.x, u.y - h - 30);
    }
    if (u.kind === "p" && d.ready && !u.dead) drawLabel(c, d.stunned ? "💫 쉬는 중" : "✓ 끝", u.x + 46, u.y - h + 3, { size: 10, bg: "rgba(40,120,60,0.85)" });
    if (u.kind === "e" && d.intent && !u.dead && V.phase === "battle") {
      const M = MOVES[d.intent.m] || {};
      const txt = `${M.icon || "?"}${d.intent.n ? " " + d.intent.n : ""}${d.intent.all ? " 전체" : ""}`;
      drawLabel(c, txt, u.x, u.y - h - (icons ? 50 : 32), { size: 13, bold: true, bg: d.stun ? "rgba(90,90,90,0.8)" : "rgba(120,20,20,0.85)" });
    }
    if (u.kind === "e" && d.id === target && V.phase === "battle" && canAct()) {
      const by = u.y - h - (icons ? 70 : 52) + Math.sin(t * 6) * 3;
      c.fillStyle = "#ffd84a";
      c.beginPath();
      c.moveTo(u.x - 8, by - 8);
      c.lineTo(u.x + 8, by - 8);
      c.lineTo(u.x, by + 2);
      c.closePath();
      c.fill();
    }
  }

  return {
    enter() {
      showLayer("dungeonui");
      $("#chat").hidden = false;
      $("#dpad").hidden = !G.touch;
      chat.send = (text) => send({ t: "chat", text });
      G.debug = { scene: "dungeon", me, units, view: () => V, send };
      connect();
    },
    exit() {
      if (sock) sock.close();
      sock = null;
      document.body.classList.remove("battle");
      setPrompt(null);
      $("#battle").hidden = true;
    },
    key(e) {
      if (!V || modalOpen()) return;
      if (V.phase === "battle" && e.code === "Space") {
        e.preventDefault();
        if (canAct()) send({ t: "end" });
      }
      if (V.phase === "battle" && /^Digit[1-8]$/.test(e.code)) {
        const card = $("#hand").children[Number(e.code.slice(5)) - 1];
        if (card) card.click();
      }
      if (V.phase === "battle" && e.code === "Tab") {
        e.preventDefault();
        const alive = V.enemies.filter((x) => x.hp > 0);
        if (alive.length) target = alive[(alive.findIndex((x) => x.id === target) + 1) % alive.length].id;
      }
    },
    tap(x, y) {
      if (!V || modalOpen()) return;
      if (V.phase === "battle") {
        let best = null;
        let bd = 70;
        for (const u of units.values()) {
          if (u.kind !== "e" || u.dead) continue;
          const c = center(u);
          const dd = Math.hypot(c.x - x, c.y - y);
          if (dd < bd + (u.d.boss ? 30 : 0)) {
            bd = dd;
            best = u;
          }
        }
        if (best) target = best.d.id;
        return;
      }
      if (V.phase === "explore") me.tapTo = { x: x - roomOff(), y };
    },
    update(dt) {
      fx.update(dt);
      for (const u of units.values()) u.hurt = Math.max(0, u.hurt - dt * 3);
      if (V && V.phase === "battle") {
        const left = Math.max(0, deadlineAt - performance.now());
        const bar = $("#dtop .timer");
        if (bar) {
          bar.firstChild.style.width = `${(100 * left) / 30000}%`;
          bar.classList.toggle("low", left < 8000);
        }
      }
      if (!V || V.phase !== "explore" || modalOpen()) {
        me.walking = false;
        return;
      }
      let { x: ax, y: ay } = axis();
      if (ax || ay) me.tapTo = null;
      else if (me.tapTo) {
        const dx = me.tapTo.x - me.x;
        const dy = me.tapTo.y - me.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 6) me.tapTo = null;
        else {
          ax = dx / dist;
          ay = dy / dist;
        }
      }
      me.walking = !!(ax || ay);
      if (ax) me.d = ax < 0 ? -1 : 1;
      const doorOpen = V.cleared && V.room + 1 < V.rooms;
      me.x = Math.max(30, Math.min(doorOpen ? 940 : 880, me.x + ax * SPEED * dt));
      me.y = Math.max(150, Math.min(515, me.y + ay * SPEED * dt));
      const now = performance.now();
      const pos = `${Math.round(me.x)},${Math.round(me.y)},${me.d}`;
      if (pos !== sentPos && now - lastSent > 150) {
        send({ t: "move", x: Math.round(me.x), y: Math.round(me.y), d: me.d });
        sentPos = pos;
        lastSent = now;
      }
      for (const o of others.values()) {
        const dx = o.tx - o.x;
        const dy = o.ty - o.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.5) {
          const step = Math.max(SPEED * 1.15, dist * 4) * dt;
          o.x += (dx / dist) * Math.min(dist, step);
          o.y += (dy / dist) * Math.min(dist, step);
        }
        o.walking = dist > 2;
      }
      if (!V.cleared && Math.hypot(me.x - ROOM.foeX, me.y - ROOM.midY) < 95 && now - lastTouch > 1000) {
        lastTouch = now;
        send({ t: "touch" });
      }
      if (doorOpen && me.x > 895 && Math.abs(me.y - 290) < 80 && now - lastTouch > 1000) {
        lastTouch = now;
        send({ t: "door" });
      }
    },
    draw(c) {
      const t = G.t;
      if (!V) {
        c.fillStyle = "#151824";
        c.fillRect(0, 0, G.W, G.H);
        drawLabel(c, "던전에 들어가는 중…", G.W / 2, G.H / 2, { size: 16 });
        return;
      }
      const [sx, sy] = fx.offset();
      c.save();
      c.translate(sx, sy);
      c.fillStyle = "#0f1119";
      c.fillRect(-20, -20, G.W + 40, G.H + 40);
      if (V.phase === "battle" || (units.size && V.phase === "done")) {
        drawRoom(c, V.theme, (G.W - ROOM.w) / 2, 0, t, { door: false });
        if (G.W > ROOM.w) {
          c.fillStyle = "#0f1119";
          c.fillRect(0, 0, (G.W - ROOM.w) / 2, G.H);
          c.fillRect(G.W - (G.W - ROOM.w) / 2, 0, (G.W - ROOM.w) / 2, G.H);
        }
        c.fillStyle = "rgba(10,10,20,0.35)";
        c.fillRect(0, 0, G.W, G.H);
        const list = [...units.values()].sort((a, b) => a.y - b.y);
        for (const u of list) drawUnit(c, u, t);
      } else {
        const ox = roomOff();
        drawRoom(c, V.theme, ox, 0, t, { open: V.cleared && V.room + 1 < V.rooms });
        c.save();
        c.translate(ox, 0);
        const items = [];
        if (!V.cleared && V.phase === "explore") {
          const foes = STAGES[V.stage].rooms[V.room];
          foes.forEach((k, i) => {
            const fx2 = ROOM.foeX + (i - (foes.length - 1) / 2) * 30 + (i % 2) * 34;
            const fy = ROOM.midY + (i - (foes.length - 1) / 2) * 56;
            items.push({ y: fy, draw: () => drawMonster(c, k, fx2, fy, { dir: -1, t: t + i, scale: MONSTERS[k].boss ? 1.15 : 1 }) });
          });
          if (Math.hypot(me.x - ROOM.foeX, me.y - ROOM.midY) < 220) items.push({ y: 999, draw: () => drawLabel(c, MONSTERS[foes[0]].boss ? `⚠️ ${STAGES[V.stage].n}단계 보스` : "⚔️ 전투", ROOM.foeX, ROOM.midY - 120, { size: 13, bold: true, bg: "rgba(140,30,30,0.85)" }) });
        }
        for (const o of others.values())
          items.push({
            y: o.y,
            draw: () => {
              drawHero(c, o.cls, o.x, o.y, { dir: o.d, t: t + o.uid, walking: o.walking, alpha: o.online === false ? 0.5 : 1 });
              drawLabel(c, o.name, o.x, o.y - 90, { size: 11 });
            },
          });
        items.push({
          y: me.y,
          draw: () => {
            drawHero(c, G.me.cls, me.x, me.y, { dir: me.d, t, walking: me.walking });
            drawLabel(c, G.me.name, me.x, me.y - 90, { size: 11, bg: "rgba(40,90,170,0.85)" });
          },
        });
        items.sort((a, b) => a.y - b.y);
        for (const it of items) it.draw();
        c.restore();
      }
      fx.draw(c);
      if (banner) {
        const p = (performance.now() / 1000 - banner.t0) / banner.dur;
        if (p >= 1) banner = null;
        else {
          c.save();
          c.globalAlpha = p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) / 0.25 : 1;
          c.fillStyle = "rgba(10,10,20,0.55)";
          c.fillRect(0, G.H * 0.36, G.W, 64);
          c.font = "900 34px system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.lineWidth = 5;
          c.strokeStyle = "rgba(0,0,0,0.7)";
          c.strokeText(banner.text, G.W / 2, G.H * 0.36 + 32);
          c.fillStyle = banner.color;
          c.fillText(banner.text, G.W / 2, G.H * 0.36 + 32);
          c.restore();
        }
      }
      c.restore();
    },
  };
}
