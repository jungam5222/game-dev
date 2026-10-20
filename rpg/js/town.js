// 마을: WASD(휴대폰은 방향 패드나 누른 곳으로 걷기)로 다니고, 건물에 가서 E로 들어간다.
// 다른 사람이 보이고, 누르거나 가까이 가서 E로 파티 초대. 파티장이 던전 입구에서 단계를 고르면 다 같이 들어간다.
import { G, axis, setScene } from "./game.js";
import { openSocket } from "./net.js";
import { drawHero, drawBuilding, drawTree, drawGrass, drawPath, drawLabel } from "./draw.js";
import { $, el, toast, chat, renderHud, setPrompt, showLayer, modalOpen, clsIcon, closeModal } from "./ui.js";
import { openPanel } from "./panels.js";
import { CLASSES, PARTY_MAX } from "../shared/content.js";

const WORLD = { w: 1600, h: 1000 };
const SPEED = 210;
const BUILDINGS = [
  { kind: "gate", name: "던전 입구", x: 690, y: 40, w: 220, h: 170, door: { x: 800, y: 228 }, panel: "stages" },
  { kind: "smithy", name: "대장간", x: 190, y: 290, w: 210, h: 160, door: { x: 295, y: 470 }, panel: "smithy" },
  { kind: "shop", name: "상점", x: 1200, y: 290, w: 210, h: 160, door: { x: 1305, y: 470 }, panel: "shop" },
  { kind: "cards", name: "카드 보관소", x: 250, y: 690, w: 200, h: 160, door: { x: 350, y: 870 }, panel: "cards" },
  { kind: "fountain", name: "", x: 740, y: 520, w: 120, h: 70 },
];
const TREES = [
  [60, 120], [140, 60], [520, 90], [600, 160], [1000, 150], [1080, 80], [1460, 110], [1540, 200], [60, 520], [110, 640], [1520, 560],
  [1470, 700], [620, 900], [720, 960], [980, 920], [1120, 980], [1400, 920], [1560, 960], [40, 940], [560, 640], [1060, 660], [1180, 760],
];
const PATHS = [
  [[800, 228], [800, 560], [800, 960]],
  [[295, 470], [520, 560], [800, 560], [1080, 560], [1305, 470]],
  [[350, 870], [560, 760], [800, 640]],
];
const solids = () => [...BUILDINGS.map((b) => ({ x: b.x + 6, y: b.y + (b.kind === "fountain" ? 6 : 30), w: b.w - 12, h: b.h - (b.kind === "fountain" ? 6 : 34) })), ...TREES.map(([x, y]) => ({ x: x - 10, y: y - 8, w: 20, h: 10 }))];

function blocked(x, y, S) {
  if (x < 16 || y < 30 || x > WORLD.w - 16 || y > WORLD.h - 8) return true;
  for (const r of S) if (x + 10 > r.x && x - 10 < r.x + r.w && y > r.y && y - 8 < r.y + r.h) return true;
  return false;
}

export function townScene(spawn) {
  const S = solids();
  const me = { x: spawn ? spawn.x : 800 + Math.random() * 60 - 30, y: spawn ? spawn.y : 640, d: 1, walking: false };
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
            party.leader === m.uid ? "👑" : clsIcon(m.cls),
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
    const d = el("div", {}, "📣 " + text);
    box.append(d);
    setTimeout(() => d.remove(), 7000);
    chat.add({ sys: true, text: "📣 " + text });
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
      const wx = x + cam.x;
      const wy = y + cam.y;
      for (const o of others.values()) {
        if (Math.abs(o.x - wx) < 22 && wy < o.y + 8 && wy > o.y - 70) {
          const r = $("#cv").getBoundingClientRect();
          playerMenu(o, r.left + ((o.x - cam.x) / G.W) * r.width, r.top + ((o.y - 78 - cam.y) / G.H) * r.height);
          return;
        }
      }
      for (const b of BUILDINGS) {
        if (b.panel && wx > b.x && wx < b.x + b.w && wy > b.y && wy < b.y + b.h + 20) {
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
        if (dist < 6) {
          if (target.then) openPanel(target.then.panel, ctx);
          target = null;
        } else {
          ax = dx / dist;
          ay = dy / dist;
        }
      }
      me.walking = !!(ax || ay);
      if (ax) me.d = ax < 0 ? -1 : 1;
      const nx = me.x + ax * SPEED * dt;
      const ny = me.y + ay * SPEED * dt;
      let moved = false;
      if (!blocked(nx, me.y, S)) {
        me.x = nx;
        moved = moved || !!ax;
      }
      if (!blocked(me.x, ny, S)) {
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
        if (dist > 400) {
          o.x = o.tx;
          o.y = o.ty;
        } else if (dist > 0.5) {
          o.x += (dx / dist) * Math.min(dist, step);
          o.y += (dy / dist) * Math.min(dist, step);
        }
        o.walking = dist > 2;
      }
      // 가까운 건물 문 / 사람
      near = null;
      let best = 85;
      for (const b of BUILDINGS) {
        if (!b.panel) continue;
        const dd = Math.hypot(b.door.x - me.x, b.door.y - me.y);
        if (dd < best) {
          best = dd;
          near = { b };
        }
      }
      if (!near) {
        let bp = 60;
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
      cam.x = Math.max(0, Math.min(WORLD.w - G.W, me.x - G.W / 2));
      cam.y = Math.max(0, Math.min(WORLD.h - G.H, me.y - G.H / 2 - 30));
    },
    draw(c) {
      const t = G.t;
      drawGrass(c, cam, G.W, G.H);
      for (const p of PATHS) drawPath(c, p, cam);
      c.save();
      c.translate(-cam.x, -cam.y);
      // 울타리
      c.fillStyle = "#3f7a3a";
      c.fillRect(0, 0, WORLD.w, 20);
      const items = [];
      for (const b of BUILDINGS) items.push({ y: b.y + b.h, draw: () => drawBuilding(c, b, t) });
      for (const [x, y] of TREES) items.push({ y, draw: () => drawTree(c, x, y, 1, t) });
      const mates = new Set(party ? party.members.map((m) => m.uid) : []);
      for (const o of others.values())
        items.push({
          y: o.y,
          draw: () => {
            drawHero(c, o.cls, o.x, o.y, { dir: o.d, t: t + o.uid, walking: o.walking });
            drawLabel(c, `${o.name} Lv${o.lv}`, o.x, o.y - 92, { size: 11, bg: mates.has(o.uid) ? "rgba(160,110,10,0.85)" : undefined });
          },
        });
      items.push({
        y: me.y,
        draw: () => {
          drawHero(c, G.me.cls, me.x, me.y, { dir: me.d, t, walking: me.walking });
          drawLabel(c, `${G.me.name} Lv${G.me.level}`, me.x, me.y - 92, { size: 11, bg: "rgba(40,90,170,0.85)" });
        },
      });
      items.sort((a, b) => a.y - b.y);
      for (const it of items) it.draw();
      for (const b of BUILDINGS) if (b.name) drawLabel(c, b.name, b.x + b.w / 2, b.y - 6, { size: 13, bold: true, bg: "rgba(20,20,30,0.75)", color: "#ffe9a8" });
      if (target) {
        c.globalAlpha = 0.5 + Math.sin(t * 8) * 0.2;
        c.beginPath();
        c.ellipse(target.x, target.y, 10, 4, 0, 0, Math.PI * 2);
        c.strokeStyle = "#fff";
        c.lineWidth = 2;
        c.stroke();
        c.globalAlpha = 1;
      }
      c.restore();
    },
  };
}

export const GATE_SPAWN = { x: 800, y: 270 };
export { setScene };
