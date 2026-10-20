// 마을: WASD(휴대폰은 방향 패드나 누른 곳으로 걷기)로 다니고, 건물에 가서 E로 들어간다.
// 다른 사람이 보이고, 누르거나 가까이 가서 E로 파티 초대. 파티장이 던전 입구에서 단계를 고르면 다 같이 들어간다.
// 좌표는 모두 마을 그림 픽셀 단위(art/town.js). 화면에는 3배로 보인다.
import { G, axis, setScene } from "./game.js";
import { openSocket } from "./net.js";
import { drawHero, HERO_TOP, text, plate } from "./draw.js";
import { TOWN_W, TOWN_H, PLACES, SPAWN, GATE_SPAWN as GATE, blocked, drawGround, objects, drawAbove } from "./art/town.js";
import { $, el, toast, chat, renderHud, setPrompt, showLayer, modalOpen, clsIcon, closeModal, icon } from "./ui.js";
import { openPanel } from "./panels.js";
import { CLASSES, PARTY_MAX } from "../shared/content.js";
import { PAL, oval } from "./pixel.js";

const SPEED = 72;
const DIRS = ["down", "up", "left", "right"];
const dirOf = (ax, ay, d) => (Math.abs(ax) > Math.abs(ay) + 0.01 ? (ax < 0 ? 2 : 3) : ay ? (ay < 0 ? 1 : 0) : d);

export function townScene(spawn) {
  const me = { x: (spawn || SPAWN).x + Math.round(Math.random() * 16 - 8), y: (spawn || SPAWN).y + Math.round(Math.random() * 6 - 3), d: spawn ? 0 : 0, walking: false };
  if (blocked(me.x, me.y)) Object.assign(me, spawn || SPAWN);
  const others = new Map();
  let target = null; // 누른 곳으로 걷기 {x, y, then}
  let sock = null;
  let party = null;
  let lastSent = 0;
  let sentPos = "";
  let cam = { x: 0, y: 0 };
  let near = null;
  let pmenu = null;

  const ctx = {
    send: (m) => sock && sock.send(m),
    get party() {
      return party;
    },
  };

  function renderParty() {
    const box = $("#party");
    if (!party) {
      box.replaceChildren();
      return;
    }
    const lead = party.leader === G.me.id;
    box.replaceChildren(
      el(
        "div.pbox",
        {},
        el("h4", {}, `파티 ${party.members.length}/${PARTY_MAX}`, el("button.btn.ghost.small", { on: { click: () => ctx.send({ t: "leave" }) } }, "나가기")),
        ...party.members.map((m) =>
          el(
            "div.m" + (m.online ? "" : ".off"),
            {},
            party.leader === m.uid ? icon("crown") : clsIcon(m.cls),
            el("span", {}, m.name),
            el("span.k", {}, `Lv ${m.lv}${m.online ? "" : " · 자리 비움"}`),
            lead && m.uid !== G.me.id ? el("button", { title: "내보내기", on: { click: () => ctx.send({ t: "kick", uid: m.uid }) } }, "✕") : null,
          ),
        ),
        el("div.muted", { style: { marginTop: "4px" } }, lead || party.members.length < 2 ? "던전 입구에서 같이 들어가요." : "파티장이 던전에 데리고 들어가요."),
      ),
    );
  }

  function showInvite(from, name) {
    const box = $("#invite");
    box.replaceChildren(
      el("p", {}, el("b", {}, name), "님이 파티에 초대했어요."),
      el("div.row", { style: { justifyContent: "center" } },
        el("button.btn.ghost", { on: { click: () => (ctx.send({ t: "decline", from }), (box.hidden = true)) } }, "거절"),
        el("button.btn", { on: { click: () => (ctx.send({ t: "accept", from }), (box.hidden = true)) } }, "수락"),
      ),
    );
    box.hidden = false;
    clearTimeout(showInvite.timer);
    showInvite.timer = setTimeout(() => (box.hidden = true), 55000);
  }

  function announce(text) {
    const box = $("#ann");
    const d = el("div", {}, icon("taunt"), text);
    box.append(d);
    setTimeout(() => d.remove(), 7000);
    chat.add({ sys: true, text });
  }

  function closeMenu() {
    if (pmenu) pmenu.remove();
    pmenu = null;
  }
  function playerMenu(o, sx, sy) {
    closeMenu();
    const inParty = party && party.members.some((m) => m.uid === o.uid);
    pmenu = el(
      "div.pmenu",
      { style: { left: `${sx}px`, top: `${sy}px` } },
      el("p", {}, el("b", {}, o.name), ` · ${CLASSES[o.cls] ? CLASSES[o.cls].name : ""} Lv ${o.lv}`),
      inParty ? el("div.muted", {}, "같은 파티예요") : el("button.btn.small", { on: { click: () => (ctx.send({ t: "invite", to: o.uid }), closeMenu()) } }, "파티 초대"),
    );
    $("#townui").append(pmenu);
    setTimeout(closeMenu, 5000);
  }

  function interact() {
    if (!near) return;
    if (near.b) {
      openPanel(near.b.panel, ctx);
    } else if (near.p) ctx.send({ t: "invite", to: near.p.uid });
  }

  function onMessage(d) {
    if (d.t === "init") {
      others.clear();
      for (const p of d.players) if (p.uid !== G.me.id) others.set(p.uid, { ...p, tx: p.x, ty: p.y });
      party = d.party;
      renderParty();
      chat.set(d.chat.map((c) => ({ name: c.name, text: c.text })));
      sentPos = "";
    } else if (d.t === "join" || d.t === "p") {
      if (d.p.uid === G.me.id) return;
      const o = others.get(d.p.uid);
      if (o) Object.assign(o, { name: d.p.name, cls: d.p.cls, lv: d.p.lv });
      else others.set(d.p.uid, { ...d.p, tx: d.p.x, ty: d.p.y });
    } else if (d.t === "leave") others.delete(d.uid);
    else if (d.t === "mv") {
      const o = others.get(d.uid);
      if (o) Object.assign(o, { tx: d.x, ty: d.y, d: d.d });
    } else if (d.t === "chat") chat.add({ name: d.name, text: d.text });
    else if (d.t === "invite") showInvite(d.from, d.name);
    else if (d.t === "party") {
      const had = party;
      party = d.party;
      renderParty();
      if (party && (!had || had.members.length < party.members.length)) toast("파티가 바뀌었어요.");
    } else if (d.t === "ann") announce(d.text);
    else if (d.t === "err") toast(d.text, "bad");
    else if (d.t === "info") toast(d.text);
    else if (d.t === "go") {
      closeModal();
      goDungeon(d.run);
    }
  }

  let goDungeon = () => {};

  return {
    onGo(fn) {
      goDungeon = fn;
    },
    enter() {
      showLayer("townui");
      $("#chat").hidden = false;
      $("#dpad").hidden = !G.touch;
      document.body.classList.remove("battle");
      $("#adminbtn").hidden = !G.admin;
      renderHud();
      for (const b of document.querySelectorAll("#menu [data-open]")) b.onclick = () => openPanel(b.dataset.open, ctx);
      chat.send = (text) => ctx.send({ t: "chat", text });
      G.debug = { scene: "town", me, others, send: ctx.send };
      sock = openSocket("town/ws", {
        message: onMessage,
        open: () => {
          ctx.send({ t: "move", x: Math.round(me.x), y: Math.round(me.y), d: me.d });
        },
        kicked: () => {
          toast("다른 창에서 접속해서 이 창은 멈췄어요. 새로고침하면 이 창에서 해요.", "bad");
        },
      });
    },
    exit() {
      if (sock) sock.close();
      sock = null;
      setPrompt(null);
      closeMenu();
      $("#invite").hidden = true;
      $("#party").replaceChildren();
    },
    key(e) {
      if (e.code === "KeyE" && !modalOpen()) interact();
      if (e.code === "Escape") closeMenu();
    },
    tap(x, y) {
      closeMenu();
      if (modalOpen()) return;
      const wx = x / G.S + cam.x;
      const wy = y / G.S + cam.y;
      for (const o of others.values()) {
        if (Math.abs(o.x - wx) < 8 && wy < o.y + 3 && wy > o.y - HERO_TOP) {
          const r = $("#cv").getBoundingClientRect();
          playerMenu(o, r.left + (((o.x - cam.x) * G.S) / G.W) * r.width, r.top + (((o.y - HERO_TOP - 6 - cam.y) * G.S) / G.H) * r.height);
          return;
        }
      }
      for (const b of PLACES) {
        const a = b.tap;
        if (wx > a.x && wx < a.x + a.w && wy > a.y && wy < a.y + a.h) {
          target = { x: b.door.x, y: b.door.y, then: b };
          return;
        }
      }
      target = { x: wx, y: wy };
    },
    update(dt) {
      let { x: ax, y: ay } = modalOpen() ? { x: 0, y: 0 } : axis();
      if (ax || ay) target = null;
      else if (target) {
        const dx = target.x - me.x;
        const dy = target.y - me.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          if (target.then) openPanel(target.then.panel, ctx);
          target = null;
        } else {
          ax = dx / dist;
          ay = dy / dist;
        }
      }
      me.walking = !!(ax || ay);
      me.d = dirOf(ax, ay, me.d);
      const nx = me.x + ax * SPEED * dt;
      const ny = me.y + ay * SPEED * dt;
      let moved = false;
      if (!blocked(nx, me.y)) {
        me.x = nx;
        moved = moved || !!ax;
      }
      if (!blocked(me.x, ny)) {
        me.y = ny;
        moved = moved || !!ay;
      }
      if (target && me.walking && !moved) target = null;
      // 위치 보내기: 움직일 때 0.15초마다
      const now = performance.now();
      const pos = `${Math.round(me.x)},${Math.round(me.y)},${me.d}`;
      if (pos !== sentPos && now - lastSent > 150) {
        ctx.send({ t: "move", x: Math.round(me.x), y: Math.round(me.y), d: me.d });
        sentPos = pos;
        lastSent = now;
      }
      for (const o of others.values()) {
        const dx = o.tx - o.x;
        const dy = o.ty - o.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(SPEED * 1.15, dist * 4) * dt;
        if (dist > 130) {
          o.x = o.tx;
          o.y = o.ty;
        } else if (dist > 0.5) {
          o.x += (dx / dist) * Math.min(dist, step);
          o.y += (dy / dist) * Math.min(dist, step);
        }
        o.walking = dist > 0.7;
        if (o.walking) o.face = dirOf(dx, dy, o.face);
        else if (o.d != null) o.face = o.d;
      }
      // 가까운 건물 문 / 사람
      near = null;
      let best = 22;
      for (const b of PLACES) {
        const dd = Math.hypot(b.door.x - me.x, b.door.y - me.y);
        if (dd < best) {
          best = dd;
          near = { b };
        }
      }
      if (!near) {
        let bp = 20;
        for (const o of others.values()) {
          const dd = Math.hypot(o.x - me.x, o.y - me.y);
          if (dd < bp && !(party && party.members.some((m) => m.uid === o.uid))) {
            bp = dd;
            near = { p: o };
          }
        }
      }
      if (modalOpen()) setPrompt(null);
      else if (near && near.b) setPrompt(`${near.b.name} 들어가기`, interact);
      else if (near && near.p) setPrompt(`${near.p.name}님 파티 초대`, interact);
      else setPrompt(null);
      const bw = G.BW;
      const bh = G.BH;
      cam.x = bw >= TOWN_W ? -Math.floor((bw - TOWN_W) / 2) : Math.round(Math.max(0, Math.min(TOWN_W - bw, me.x - bw / 2)));
      cam.y = bh >= TOWN_H ? -Math.floor((bh - TOWN_H) / 2) : Math.round(Math.max(0, Math.min(TOWN_H - bh, me.y - 8 - bh / 2)));
    },
    draw(c) {
      const t = G.t;
      drawGround(c, cam.x, cam.y, t);
      const items = objects(t).map((o) => ({ y: o.y, draw: () => o.draw(c, cam.x, cam.y) }));
      for (const o of others.values()) items.push({ y: o.y, draw: () => drawHero(c, o.cls, Math.round(o.x - cam.x), Math.round(o.y - cam.y), { dir: DIRS[o.face || 0], t: t + o.uid * 0.37, walking: o.walking }) });
      items.push({ y: me.y, draw: () => drawHero(c, G.me.cls, Math.round(me.x - cam.x), Math.round(me.y - cam.y), { dir: DIRS[me.d], t, walking: me.walking }) });
      if (target) {
        const tx = Math.round(target.x - cam.x);
        const ty = Math.round(target.y - cam.y);
        c.save();
        c.globalAlpha = 0.45 + Math.sin(t * 8) * 0.2;
        oval(c, tx, ty, 4, 1, PAL.c);
        c.globalAlpha = 1;
        c.restore();
      }
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();
      drawAbove(c, cam.x, cam.y, t);
    },
    overlay(c) {
      const S = G.S;
      const sx = (x) => (x - cam.x) * S;
      const sy = (y) => (y - cam.y) * S;
      for (const b of PLACES) text(c, b.name, sx(b.sign.x), sy(b.sign.y), { size: 11, bold: true, color: PAL.c });
      const mates = new Set(party ? party.members.map((m) => m.uid) : []);
      for (const o of others.values()) text(c, `${o.name} Lv${o.lv}`, sx(o.x), sy(o.y - HERO_TOP) - 9, { size: 11, color: mates.has(o.uid) ? PAL.g : PAL.W });
      plate(c, `${G.me.name} Lv${G.me.level}`, sx(me.x), sy(me.y - HERO_TOP) - 10, { size: 11, color: PAL.y, bg: "rgba(24,20,37,0.6)" });
    },
  };
}

export const GATE_SPAWN = GATE;
export { setScene };
