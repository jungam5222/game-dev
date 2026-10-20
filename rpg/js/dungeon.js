// 던전: 방을 걸어 다니다가 몬스터에게 닿으면 전투. 전투는 서버가 보낸 events를 차례로 연출한다.
// 서버 좌표는 방 960×540(그림판 기준)이고, 그림은 방 320×180 픽셀이다. 탐험은 3배, 전투는 4배로 크게 본다.
import { G, axis, sleep } from "./game.js";
import { openSocket, api } from "./net.js";
import { drawHero, drawMonster, drawSpirit, drawRoom, drawRoomFront, Effects, HERO_TOP, MONSTER_TOP, SPIRIT_TOP, ROOM_W, text, plate, box, hpBar, Floats, banner as drawBanner, FONT } from "./draw.js";
import { $, el, toast, chat, setPrompt, showLayer, modalOpen, cardTile, ask, closeModal, icon } from "./ui.js";
import { showRewards } from "./panels.js";
import { CARDS, SKILLS, MOVES, STAGES, MONSTERS, needsTarget, skillText } from "../shared/content.js";
import { PAL, rect, canvasOf } from "./pixel.js";
import { moveIcon, UI_ICONS } from "./art/icons.js";

const ROOM = { w: 960, h: 540, foeX: 600, doorX: 905, midY: 290 };
const SPEED = 220;
const DIRS = ["down", "up", "left", "right"];
const dirOf = (ax, ay, d) => (Math.abs(ax) > Math.abs(ay) + 0.01 ? (ax < 0 ? 2 : 3) : ay ? (ay < 0 ? 1 : 0) : d);
// 전투 자리: [화면 가로 비율, 발 높이(전투 그림판 픽셀)]
const PSLOT = [[0.31, 86], [0.2, 74], [0.2, 98], [0.09, 86]];
const ESLOT = [[0.69, 86], [0.8, 74], [0.8, 98], [0.91, 86]];
const ESLOT_BOSS = [[0.7, 92], [0.87, 72], [0.88, 100], [0.95, 86]];
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

// 큰 그림판에 픽셀 아이콘 그리기 (가운데 기준)
function iconAt(c, s, x, y, k = 2) {
  if (!s) return;
  c.imageSmoothingEnabled = false;
  c.drawImage(canvasOf(s), Math.round(x - (s.w * k) / 2), Math.round(y - (s.h * k) / 2), s.w * k, s.h * k);
}

export function dungeonScene(run, { onExit }) {
  let V = null; // 마지막으로 적용한 서버 상태
  let sock = null;
  const me = { x: 110, y: 290, d: 3, walking: false };
  let myRoom = -1;
  const others = new Map(); // 탐험 중 다른 사람 위치
  const units = new Map(); // 전투 그림 단위 "p:1", "e:5", "s:9" (좌표는 전투 그림판 픽셀)
  const fx = new Effects();
  const floats = new Floats();
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
  let fade = 0; // 탐험↔전투 바뀔 때 어둡게 덮기

  const send = (m) => sock && sock.send(m);
  const isBattle = () => V && (V.phase === "battle" || (units.size && V.phase === "done"));
  const myView = () => V && V.players.find((p) => p.uid === G.me.id);
  // 탐험 화면: 방이 화면보다 넓으면 나를 따라 움직인다 (픽셀)
  const roomOff = () => (G.BW >= ROOM_W ? Math.floor((G.BW - ROOM_W) / 2) : -Math.round(Math.max(0, Math.min(ROOM_W - G.BW, me.x / 3 - G.BW / 2))));
  // 픽셀 → 큰 그림판
  const up = (v) => v * G.S;

  function showBanner(text, color = PAL.y, dur = 1.1) {
    banner = { text, color, t0: performance.now() / 1000, dur };
  }
  const say = (u, str, color, size = 22, dy = 0, ic = null) => {
    if (!u) return;
    const c = center(u);
    floats.add(up(c.x), up(c.y + dy), str, color, size, 1.1, ic);
  };

  // ───── 전투 그림 단위 ─────
  function slotOf(kind, i, bossFight) {
    const s = kind === "p" ? PSLOT[i % 4] : (bossFight ? ESLOT_BOSS : ESLOT)[i % 4];
    return { x: Math.round(s[0] * G.BW), y: s[1] };
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
        u.x = owner.x + 14 + j * 7;
        u.y = owner.y + 3 - j * 8;
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
  const top = (u) => (u.kind === "p" ? HERO_TOP : u.kind === "s" ? SPIRIT_TOP : MONSTER_TOP[u.d.k] || 16);
  const center = (u) => ({ x: u.x + u.ox, y: u.y + u.oy - Math.round(top(u) * 0.5) });

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
          else others.set(p.uid, { ...p, tx: p.x, ty: p.y, face: p.d });
        }
      for (const uid of [...others.keys()]) if (!v.players.some((p) => p.uid === uid && !p.left)) others.delete(uid);
    } else if (v.phase === "battle") {
      syncUnits(v);
      deadlineAt = performance.now() + v.left;
    }
    if (prevPhase !== v.phase) {
      document.body.classList.toggle("battle", v.phase === "battle");
      if (prevPhase && (v.phase === "explore" || v.phase === "battle")) fade = 1;
    }
    renderUi();
  }

  // ───── 연출 ─────
  const MELEE = new Set(["slash", "smash", "charge", "counter", "attack", "heavy", "drain", "poison", "spiritHit"]);
  const PROJ = { fire: "fire", ice: "ice", arcane: "arcane", web: "web" };
  async function lunge(u, to, dist = 18, ms = 170) {
    if (!u) return;
    const dir = u.kind === "e" ? -1 : 1;
    const tx = to ? to.x + to.ox - u.x - dir * dist : dir * 10;
    const ty = to ? (to.y - u.y) * 0.6 : 0;
    await tween((p) => {
      u.ox = Math.round(tx * ease(p));
      u.oy = Math.round(ty * ease(p) - Math.sin(p * Math.PI) * 3);
      u.swing = p;
    }, ms);
    setTimeout(() => {
      tween((p) => {
        u.ox = Math.round(tx * (1 - p));
        u.oy = Math.round(ty * (1 - p));
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
        fx.add("proj", { x1: a.x + (actor.kind === "e" ? -6 : 6), y1: a.y - 2, x2: c.x, y2: c.y, color: PROJ[anim], dur, arc: 8 });
        setTimeout(r, document.hidden ? 0 : dur * 1000);
      });
      fx.burst(c.x, c.y, { fire: PAL.O, ice: PAL.C, arcane: PAL.M, web: PAL.s }[anim], 12);
    } else if (anim === "bolt") {
      fx.add("bolt", { x: c.x, y: tu.y, dur: 0.3 });
      fx.burst(c.x, c.y, PAL.y, 10);
    } else if (anim === "meteor") {
      fx.add("meteor", { x: tu.x, y: tu.y, dur: 0.35 });
      await sleep(document.hidden ? 0 : 330);
      fx.burst(tu.x, tu.y - 5, PAL.O, 22, 55, 2);
      fx.shake(2, 0.3);
    } else if (anim === "holy") {
      fx.add("beam", { x: tu.x, y: tu.y, dur: 0.5 });
      await sleep(document.hidden ? 0 : 160);
      fx.burst(c.x, c.y, PAL.y, 12);
    } else if (anim === "sweep" || anim === "howl") {
      fx.add("slash", { x: c.x, y: c.y, r: 12, rot: 0, color: anim === "howl" ? PAL.r : PAL.W, dur: 0.25, w: 2 });
    } else if (anim === "quake") {
      fx.burst(tu.x, tu.y - 1, PAL.k, 8, 30, 1);
    } else if (actor && actor.kind === "e") {
      fx.add("claw", { x: c.x, y: c.y, dur: 0.3 });
    } else if (anim === "spiritHit") {
      fx.burst(c.x, c.y, PAL.C, 8, 25, 1);
    } else {
      fx.add("slash", { x: c.x, y: c.y, r: anim === "smash" ? 11 : 9, rot: -0.7, color: PAL.W, dur: 0.22, w: anim === "smash" ? 3 : 2 });
      if (anim === "smash") fx.shake(1, 0.18);
    }
  }

  let cur = null; // 지금 행동 중 {actor, anim, hits}
  async function playEvent(e, v) {
    const fast = document.hidden || queue.length > 4;
    const wait = (ms) => (fast ? null : sleep(ms));
    const u = e.to ? units.get(e.to) : null;
    switch (e.e) {
      case "battle":
        V = v;
        document.body.classList.add("battle");
        fade = 1;
        syncUnits(v);
        renderUi();
        for (const x of units.values()) if (x.kind === "e") tween((p) => (x.alpha = p), 400);
        showBanner("전투 시작!", PAL.g);
        await wait(700);
        break;
      case "turn":
        cur = null;
        for (const x of units.values()) if (x.kind === "p") x.d.ready = false;
        showBanner(`${e.turn}턴`, PAL.c, 0.9);
        await wait(400);
        break;
      case "phase":
        cur = null;
        showBanner("적의 차례", PAL.P, 0.8);
        await wait(450);
        break;
      case "act": {
        const actor = units.get(e.by);
        const tu = e.target ? units.get(e.target) : null;
        cur = { actor, anim: e.anim, n: 0 };
        if (e.card || e.skill) {
          const c = e.card ? CARDS[e.card] : SKILLS[e.skill];
          if (actor && c) floats.add(up(actor.x), up(actor.y - top(actor) - 9), c.name, PAL.c, 22, 1.0);
        } else if (e.move && actor && actor.kind === "e") {
          const M = MOVES[e.move];
          if (M && e.move !== "attack") floats.add(up(actor.x), up(actor.y - top(actor) - 9), M.name, PAL.P, 22, 1.0, moveIcon(e.move));
        }
        if (MELEE.has(e.anim)) await lunge(actor, tu, e.anim === "charge" ? 13 : 18, e.anim === "heavy" ? 240 : 170);
        else if (e.anim === "sweep") await lunge(actor, null);
        else if (e.anim === "quake") {
          await tween((p) => actor && (actor.oy = -Math.round(Math.sin(p * Math.PI) * 8)), 260);
          fx.add("quake", { x: e.by.startsWith("e") ? Math.round(G.BW * 0.25) : Math.round(G.BW * 0.75), y: 88, dur: 0.6 });
          fx.shake(2, 0.35);
        } else if (e.anim === "howl" || e.anim === "shout") {
          if (actor) fx.add("ring", { x: actor.x, y: actor.y - Math.round(top(actor) * 0.5), r: 30, color: e.anim === "howl" ? PAL.r : PAL.g, dur: 0.5 });
          await castPose(actor);
          if (e.anim === "howl") fx.shake(1, 0.25);
        } else if (e.anim === "summon") {
          if (actor) fx.add("ring", { x: actor.x, y: actor.y - 5, r: 18, color: PAL.s, dur: 0.5 });
          await wait(250);
        } else if (e.anim === "enrage") {
          if (actor) fx.add("aura", { x: actor.x, y: actor.y, dur: 0.7, color: PAL.r });
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
        if (e.n > 0) say(u, `${e.crit ? "치명타! " : ""}-${e.n}`, e.crit ? PAL.y : u.kind === "p" ? PAL.P : PAL.W, e.crit ? 33 : 22, -3);
        else if (e.blocked) say(u, `${e.blocked} 막음`, PAL.C, 22, -3, UI_ICONS.block);
        if (e.blocked && e.n > 0) say(u, `${e.blocked}`, PAL.C, 11, 4, UI_ICONS.block);
        if (e.crit) fx.shake(2, 0.22);
        else if (u.kind === "p" && e.n > 0) fx.shake(1, 0.15);
        await wait(130);
        break;
      }
      case "dodge":
        if (u) {
          say(u, "회피!", PAL.C, 22, -3);
          const dir = u.kind === "e" ? 1 : -1;
          tween((p) => (u.ox = Math.round(dir * Math.sin(p * Math.PI) * 9)), 320);
        }
        await wait(200);
        break;
      case "fail":
        if (u) say(u, `${e.what} 실패`, PAL.e, 11, 4);
        await wait(110);
        break;
      case "heal":
        if (u) {
          u.d.hp = e.hp;
          if (e.n > 0) say(u, `+${e.n}`, PAL.L, 22, -3);
          fx.rise(u.x, u.y - 8, PAL.L, 10);
        }
        await wait(150);
        break;
      case "block":
        if (u) {
          u.d.block = e.block;
          fx.add("bubble", { x: u.x, y: u.y - top(u) - 2, dur: 0.6 });
          say(u, `+${e.n}`, PAL.C, 22, -3, UI_ICONS.block);
        }
        await wait(150);
        break;
      case "buff":
        if (u) {
          const b = { dodge: [`회피 준비 ${e.n}%`, UI_ICONS.dodge], counter: [`되갚기 ${e.n}`, UI_ICONS.counter], taunt: ["도발!", UI_ICONS.taunt], crit: [`치명타 +${e.n}%`, UI_ICONS.sword], rage: ["분노!", UI_ICONS.rage] }[e.what];
          if (e.what === "taunt") u.d.taunt = true;
          if (e.what === "dodge") u.d.dodgeBuff = e.n;
          if (e.what === "counter") u.d.counter = e.n;
          if (b) say(u, b[0], PAL.c, 11, 0, b[1]);
        }
        await wait(150);
        break;
      case "mana":
        if (u) say(u, `마나 +${e.n}`, PAL.C, 11, 0, UI_ICONS.mana);
        await wait(120);
        break;
      case "stun":
        if (u) {
          say(u, "기절!", PAL.y, 22, 0, UI_ICONS.stun);
          u.d.stun = true;
        }
        await wait(200);
        break;
      case "stunSkip": {
        const a = units.get(e.by);
        if (a) {
          floats.add(up(a.x), up(a.y - top(a) - 6), "기절해서 못 움직여요", PAL.y, 11, 1.1, UI_ICONS.stun);
          a.d.stun = false;
        }
        await wait(350);
        break;
      }
      case "dotOn":
        if (u) {
          say(u, e.kind === "burn" ? "화상" : "독", e.kind === "burn" ? PAL.O : PAL.L, 11, 6, e.kind === "burn" ? UI_ICONS.burn : UI_ICONS.poison);
          u.d.dots = [...(u.d.dots || []).filter((d) => d.kind !== e.kind), { kind: e.kind, n: 1, turns: 1 }];
        }
        await wait(100);
        break;
      case "dot":
        if (u) {
          u.d.hp = e.hp;
          u.hurt = 0.6;
          say(u, `-${e.n}`, e.kind === "burn" ? PAL.O : PAL.L, 22, -3, e.kind === "burn" ? UI_ICONS.burn : UI_ICONS.poison);
        }
        await wait(160);
        break;
      case "die":
        if (u) {
          u.dead = true;
          if (u.kind !== "p") tween((p) => (u.alpha = 1 - p * 0.85), 500);
          const c = center(u);
          fx.burst(c.x, c.y, u.kind === "p" ? PAL.P : PAL.s, 16, 35, 1);
        }
        await wait(300);
        break;
      case "again":
        if (u) say(u, "한 번 더!", PAL.M, 22, -8);
        await wait(250);
        break;
      case "spirit": {
        if (e.gone) units.delete(e.gone);
        const s = unitFor("s:" + e.unit.id, "s", e.unit);
        s.alpha = 0;
        V.spirits = [...V.spirits.filter((x) => x.id !== e.unit.id && "s:" + x.id !== e.gone), e.unit];
        layout();
        tween((p) => (s.alpha = p), 400);
        fx.rise(s.x, s.y - 5, PAL.C, 12);
        await wait(300);
        break;
      }
      case "summon": {
        const s = unitFor("e:" + e.unit.id, "e", e.unit);
        s.alpha = 0;
        V.enemies = [...V.enemies.filter((x) => x.id !== e.unit.id), e.unit];
        layout();
        fx.burst(s.x, s.y - 5, PAL.s, 18, 30, 2, 0);
        tween((p) => (s.alpha = p), 400);
        await wait(400);
        break;
      }
      case "cleanse":
        for (const x of units.values())
          if (x.kind === "p" && !x.dead) {
            x.d.dots = [];
            fx.rise(x.x, x.y - 8, PAL.y, 8);
          }
        await wait(150);
        break;
      case "ready":
        if (u) u.d.ready = true;
        break;
      case "left":
        if (u) say(u, "나갔어요", PAL.e, 11, -6);
        break;
      case "win":
        cur = null;
        showBanner(e.boss ? "보스를 쓰러뜨렸어요!" : "승리!", PAL.y, 1.6);
        if (e.exp) floats.add(G.W / 2, Math.round(G.H * 0.36) + 52, `경험치 +${e.exp} · 골드 +${e.gold}`, PAL.c, 22, 1.6);
        await wait(1300);
        break;
      case "lose":
        showBanner("모두 쓰러졌어요…", PAL.P, 1.8);
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
    return V && V.phase === "battle" && p && !p.down && !p.ready && !p.stunned && !busyBlock();
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
      $("#mana").replaceChildren(...Array.from({ length: Math.max(m.maxMana, m.mana) }, (_, i) => el("i" + (i < m.mana ? ".on" : ""))), el("span", {}, `${m.mana}/${m.maxMana}`));
      $("#piles").replaceChildren(icon("deck"), ` ${m.draw}`, icon("discard"), ` ${m.disc}`);
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
            icon("skill:" + k),
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
        btn.className = "btn gold";
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
  function statusIcons(d) {
    const s = [];
    if (d.stun || d.stunned) s.push([UI_ICONS.stun]);
    for (const x of d.dots || []) s.push([x.kind === "burn" ? UI_ICONS.burn : UI_ICONS.poison]);
    if (d.taunt) s.push([UI_ICONS.taunt]);
    if (d.dodgeBuff > 0) s.push([UI_ICONS.dodge]);
    if (d.counter > 0) s.push([UI_ICONS.counter]);
    if (d.rage > 0) s.push([UI_ICONS.rage, d.rage]);
    return s;
  }
  const barW = (u) => (u.kind === "e" && u.d.boss ? 40 : u.kind === "s" ? 12 : 22);
  function drawUnit(c, u, t) {
    const d = u.d;
    const x = u.x + u.ox;
    const y = u.y + u.oy;
    const flash = u.hurt > 0.5 ? 1 : u.hurt > 0 ? 0.5 : 0;
    if (u.kind === "p") drawHero(c, d.cls, x, y, { battle: true, t: t + d.uid * 0.37, swing: u.swing, cast: u.cast, flash, down: u.dead, alpha: d.online === false ? 0.55 : 1 });
    else if (u.kind === "e") drawMonster(c, d.k, x, y, { t: t + d.id * 0.53, swing: u.swing, flash, dead: u.dead, alpha: u.alpha });
    else drawSpirit(c, x, y, { t: t + d.id * 0.7, flash, alpha: u.alpha });
    if (u.dead && u.kind !== "p") return;
    hpBar(c, u.x, u.y - top(u) - 7, barW(u), d.hp, d.maxHp, u.kind);
  }
  function overlayUnit(c, u) {
    const d = u.d;
    if (u.dead && u.kind !== "p") return;
    const bx = up(u.x);
    const by = up(u.y - top(u) - 7);
    text(c, `${Math.max(0, d.hp)}/${d.maxHp}`, bx, by + 9, { size: 11 });
    if (d.block > 0) {
      iconAt(c, UI_ICONS.block, bx - up(barW(u) / 2) - 10, by + 9, 2);
      text(c, `${d.block}`, bx - up(barW(u) / 2) - 10, by + 10, { size: 11, color: PAL.W });
    }
    if (u.kind === "s") return;
    const isMe = u.kind === "p" && d.uid === G.me.id;
    // 위로 쌓기: 이름 → 상태 아이콘 → 다음 행동 → (고른 적) 화살표. yy는 지금까지 쌓은 것의 윗변
    let yy = by - 9;
    text(c, d.name + (u.dead ? " (쓰러짐)" : ""), bx, yy, { size: 11, bold: isMe || (u.kind === "e" && d.boss), color: isMe ? PAL.y : u.kind === "e" && d.boss ? PAL.P : PAL.W });
    yy -= 9;
    const icons = statusIcons(d);
    if (icons.length) {
      icons.forEach(([s, n], i) => {
        const ix = bx + (i - (icons.length - 1) / 2) * 26;
        iconAt(c, s, ix, yy - 13, 2);
        if (n) text(c, `${n}`, ix + 10, yy - 6, { size: 11 });
      });
      yy -= 28;
    }
    if (u.kind === "p" && d.ready && !u.dead) plate(c, d.stunned ? "쉬는 중" : "끝", bx + up(barW(u) / 2) + 20, by + 9, { size: 11, bg: "rgba(38,92,66,0.9)", color: PAL.c });
    if (u.kind === "e" && d.intent && V.phase === "battle") {
      const label = `${d.intent.n || ""}${d.intent.all ? " 전체" : ""}`;
      c.font = `700 11px ${FONT}, sans-serif`;
      const tw = label ? Math.ceil(c.measureText(label).width) + 4 : 0;
      const s = moveIcon(d.intent.m);
      const iw = s ? s.w * 2 : 16;
      const w = iw + tw + 8;
      const h = Math.max(22, (s ? s.h * 2 : 16) + 6);
      const cy = yy - 2 - h / 2;
      box(c, bx, cy, w, h, d.stun ? "rgba(58,68,102,0.9)" : "rgba(162,38,51,0.92)", PAL.d);
      iconAt(c, s, bx - w / 2 + 4 + iw / 2, cy, 2);
      if (label) text(c, label, bx - w / 2 + 4 + iw + tw / 2 + 1, cy, { size: 11, bold: true, outline: null });
      yy -= h + 2;
    }
    // 고른 적 위의 노란 화살표 (그림과 같은 굵기의 픽셀로)
    if (u.kind === "e" && d.id === target && V.phase === "battle" && canAct()) {
      const k = G.S;
      const ay = yy - 6 - 5 * k + Math.round(Math.sin(G.t * 6)) * k;
      const ax = Math.round(bx);
      c.fillStyle = PAL.d;
      c.fillRect(ax - 4.5 * k, ay - k, 9 * k, k);
      c.fillStyle = PAL.y;
      for (let i = 0; i < 4; i++) c.fillRect(ax - (3.5 - i) * k, ay + i * k, (7 - i * 2) * k, k);
    }
  }

  return {
    get S() {
      return isBattle() ? 4 : 3;
    },
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
        const bx = x / G.S;
        const by = y / G.S;
        let best = null;
        let bd = 18;
        for (const u of units.values()) {
          if (u.kind !== "e" || u.dead) continue;
          const c = center(u);
          const dd = Math.hypot(c.x - bx, c.y - by);
          if (dd < bd + (u.d.boss ? 8 : 0)) {
            bd = dd;
            best = u;
          }
        }
        if (best) target = best.d.id;
        return;
      }
      if (V.phase === "explore") me.tapTo = { x: (x / G.S - roomOff()) * 3, y: (y / G.S) * 3 };
    },
    update(dt) {
      fx.update(dt);
      floats.update(dt);
      fade = Math.max(0, fade - dt * 3);
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
      me.d = dirOf(ax, ay, me.d);
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
        if (o.walking) o.face = dirOf(dx, dy, o.face);
        else if (o.d != null) o.face = o.d;
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
      if (!V) return;
      const [sx, sy] = fx.offset();
      c.save();
      c.translate(sx, sy);
      if (isBattle()) {
        // 방 가운데 아래쪽을 크게: 방 y 40부터 보인다
        const ox = Math.round(G.BW / 2 - ROOM_W / 2);
        drawRoom(c, V.theme, ox, -40, t, { door: false });
        c.fillStyle = "rgba(24,20,37,0.3)";
        c.fillRect(-4, -4, G.BW + 8, G.BH + 8);
        const list = [...units.values()].sort((a, b) => a.y - b.y);
        for (const u of list) drawUnit(c, u, t);
        drawRoomFront(c, V.theme, ox, -40, t);
        fx.draw(c);
      } else {
        const ox = roomOff();
        drawRoom(c, V.theme, ox, 0, t, { open: V.cleared && V.room + 1 < V.rooms });
        const items = [];
        if (!V.cleared && V.phase === "explore") {
          const foes = STAGES[V.stage].rooms[V.room];
          foes.forEach((k, i) => {
            const fx2 = ROOM.foeX + (i - (foes.length - 1) / 2) * 30 + (i % 2) * 34;
            const fy = ROOM.midY + (i - (foes.length - 1) / 2) * 56;
            items.push({ y: fy, draw: () => drawMonster(c, k, ox + Math.round(fx2 / 3), Math.round(fy / 3), { t: t + i * 0.53 }) });
          });
        }
        for (const o of others.values())
          items.push({ y: o.y, draw: () => drawHero(c, o.cls, ox + Math.round(o.x / 3), Math.round(o.y / 3), { dir: DIRS[o.face == null ? 3 : o.face], t: t + o.uid * 0.37, walking: o.walking, alpha: o.online === false ? 0.5 : 1 }) });
        items.push({ y: me.y, draw: () => drawHero(c, G.me.cls, ox + Math.round(me.x / 3), Math.round(me.y / 3), { dir: DIRS[me.d], t, walking: me.walking }) });
        items.sort((a, b) => a.y - b.y);
        for (const it of items) it.draw();
        drawRoomFront(c, V.theme, ox, 0, t);
      }
      c.restore();
    },
    overlay(c) {
      if (!V) {
        text(c, "던전에 들어가는 중…", G.W / 2, G.H / 2, { size: 22, color: PAL.c });
        return;
      }
      if (isBattle()) for (const u of units.values()) overlayUnit(c, u);
      else {
        const ox = roomOff();
        const sx = (x) => up(ox + x / 3);
        const sy = (y) => up(y / 3);
        if (!V.cleared && V.phase === "explore" && Math.hypot(me.x - ROOM.foeX, me.y - ROOM.midY) < 220) {
          const foes = STAGES[V.stage].rooms[V.room];
          const boss = MONSTERS[foes[0]].boss;
          plate(c, boss ? `${STAGES[V.stage].n}단계 보스 ${MONSTERS[foes[0]].name}` : "전투", sx(ROOM.foeX), sy(ROOM.midY) - up(MONSTER_TOP[foes[0]] || 16) - 22, { size: 11, bold: true, bg: "rgba(162,38,51,0.9)", color: PAL.c });
        }
        for (const o of others.values()) text(c, o.name, sx(o.x), sy(o.y) - up(HERO_TOP) - 9, { size: 11 });
        plate(c, G.me.name, sx(me.x), sy(me.y) - up(HERO_TOP) - 10, { size: 11, color: PAL.y, bg: "rgba(24,20,37,0.6)" });
      }
      floats.draw(c);
      if (banner) {
        const p = (performance.now() / 1000 - banner.t0) / banner.dur;
        if (p >= 1) banner = null;
        else drawBanner(c, banner.text, banner.color, p);
      }
      if (fade > 0) {
        c.fillStyle = `rgba(24,20,37,${fade.toFixed(3)})`;
        c.fillRect(0, 0, G.W, G.H);
      }
    },
  };
}
