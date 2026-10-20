// 화면 위에 올리는 글자·버튼(DOM): 알림, 창, 카드 모양, 위쪽 정보줄, 채팅, 파티, 방향 패드.
import { G } from "./game.js";
import { CLASSES, CARDS, GRADES, cardText, MATS, itemName, itemStats, OPTS } from "../shared/content.js";

export const $ = (s, root = document) => root.querySelector(s);
export function el(tag, attrs = {}, ...kids) {
  const [name, ...cls] = tag.split(".");
  const e = document.createElement(name || "div");
  if (cls.length) e.className = cls.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "class") e.className += " " + v;
    else if (k in e && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

export function toast(text, kind = "") {
  const box = $("#toasts");
  const t = el("div.toast" + (kind ? "." + kind : ""), {}, text);
  box.append(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3200);
}

// 가운데 창. 닫으면 onClose
let openModal = null;
export function modal(title, body, o = {}) {
  closeModal();
  const box = el("div.modal" + (o.wide ? ".wide" : ""), {}, el("div.mhead", {}, el("h2", {}, title), el("button.x", { on: { click: () => closeModal() }, "aria-label": "닫기" }, "✕")), el("div.mbody", {}, body));
  const back = el("div.mback", { on: { pointerdown: (e) => e.target === back && !o.sticky && closeModal() } }, box);
  $("#modal-root").append(back);
  openModal = { back, onClose: o.onClose, box };
  G.keys.clear();
  return openModal;
}
export function closeModal() {
  if (!openModal) return;
  const m = openModal;
  openModal = null;
  m.back.remove();
  m.onClose && m.onClose();
}
export const modalOpen = () => !!openModal;

export function ask(text, yes = "확인", no = "취소") {
  return new Promise((res) => {
    const m = modal("확인", el("div", {}, el("p", {}, text), el("div.row.end", {}, el("button.btn.ghost", { on: { click: () => (closeModal(), res(false)) } }, no), el("button.btn", { on: { click: () => (closeModal(), res(true)) } }, yes))), { onClose: () => res(false) });
    void m;
  });
}

export const clsIcon = (cls) => ({ warrior: "🛡️", mage: "🔮", priest: "✨" })[cls] || "❔";

// 카드 한 장
export function cardTile(key, o = {}) {
  const c = CARDS[key];
  if (!c) return el("div.card");
  const t = el(
    `div.card.g${c.grade}`,
    { title: `${c.name} (${GRADES[c.grade]}) — ${cardText(c)}`, on: o.onClick ? { click: o.onClick } : null },
    el("div.cost", {}, c.cost),
    el("div.icon", {}, c.icon),
    el("div.cname", {}, c.name),
    el("div.ctext", {}, cardText(c)),
    o.badge != null ? el("div.badge", {}, o.badge) : null,
  );
  if (o.disabled) t.classList.add("off");
  if (o.selected) t.classList.add("sel");
  return t;
}

export function optText(opt) {
  return opt && OPTS[opt.k] ? OPTS[opt.k].text(opt.n) : "";
}
export function itemLine(it) {
  const s = itemStats(it);
  const parts = [];
  if (s.atk) parts.push(`공격 +${s.atk}`);
  if (s.hp) parts.push(`체력 +${s.hp}`);
  if (s.def) parts.push(`방어력 +${s.def}`);
  if (s.crit) parts.push(`치명타 +${s.crit}%`);
  if (s.dodge) parts.push(`회피 +${s.dodge}%`);
  return parts.join(" · ");
}
export const itemTitle = (it) => itemName(it, G.me.cls);

// ───────── 위쪽 정보줄 ─────────
export function renderHud() {
  const u = G.me;
  if (!u) return;
  const hud = $("#hud");
  hud.replaceChildren(
    el("div.who", {}, el("span.cls", {}, clsIcon(u.cls)), el("b", {}, u.name), el("span.lv", {}, `Lv ${u.level}`), el("span.sub", {}, CLASSES[u.cls] ? CLASSES[u.cls].name : "")),
    el("div.exp", { title: `경험치 ${u.exp} / ${u.need}` }, el("div", { style: { width: `${Math.min(100, (100 * u.exp) / u.need)}%` } })),
    el("div.money", {}, el("span", { title: "골드" }, `💰 ${u.gold}`), el("span", { title: MATS.stone.name }, `${MATS.stone.icon} ${G.mats.stone}`), el("span", { title: MATS.pack.name }, `${MATS.pack.icon} ${G.mats.pack}`)),
  );
}

// ───────── 채팅 ─────────
export const chat = {
  send: null,
  lines: [],
  add(line) {
    this.lines.push(line);
    this.lines = this.lines.slice(-40);
    this.render();
  },
  set(lines) {
    this.lines = lines.slice(-40);
    this.render();
  },
  render() {
    const log = $("#chatlog");
    log.replaceChildren(...this.lines.slice(-8).map((l) => el("div" + (l.sys ? ".sys" : ""), {}, l.name ? el("b", {}, l.name + " ") : null, l.text)));
    $("#chat").classList.add("lit");
    clearTimeout(this.fade);
    this.fade = setTimeout(() => $("#chat").classList.remove("lit"), 6000);
  },
};
export function setupChat() {
  const input = $("#chatin");
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const text = input.value.trim();
      if (text && chat.send) chat.send(text);
      input.value = "";
      input.blur();
    } else if (e.key === "Escape") input.blur();
  });
  input.addEventListener("focus", () => {
    G.keys.clear();
    $("#chat").classList.add("lit", "typing");
  });
  input.addEventListener("blur", () => $("#chat").classList.remove("typing"));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && document.activeElement !== input && !modalOpen() && chat.send && !$("#chat").hidden) {
      input.focus();
      e.preventDefault();
    }
  });
  // 휴대폰에서는 입력칸이 숨어 있어서 먼저 보이게 한 뒤 누른다
  $("#chatbtn").addEventListener("click", () => {
    $("#chat").classList.add("typing");
    input.focus();
  });
}

// ───────── 방향 패드 (휴대폰) ─────────
export function setupDpad() {
  const pad = $("#dpad");
  for (const b of pad.querySelectorAll("[data-k]")) {
    const k = b.dataset.k;
    const on = (e) => {
      e.preventDefault();
      G.keys.add(k);
      b.classList.add("on");
    };
    const off = (e) => {
      e.preventDefault();
      G.keys.delete(k);
      b.classList.remove("on");
    };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("pointerleave", off);
  }
  if (G.touch) document.body.classList.add("touch");
}

// 상호작용 안내 (E 키 / 누르기)
export function setPrompt(text, fn) {
  const p = $("#prompt");
  if (!text) {
    p.hidden = true;
    p.onclick = null;
    return;
  }
  if (p.dataset.text !== text || p.hidden) {
    p.replaceChildren(el("kbd", {}, G.touch ? "누르기" : "E"), " " + text);
    p.dataset.text = text;
  }
  p.hidden = false;
  p.onclick = fn;
}

export function showLayer(name) {
  for (const id of ["townui", "dungeonui"]) $("#" + id).hidden = id !== name;
}
