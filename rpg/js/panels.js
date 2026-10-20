// 마을 창들: 던전 입구(단계), 대장간(강화), 상점(팔기), 카드 보관소(덱·합성·팩), 가방, 설정, 관리자, 던전 보상.
import { G } from "./game.js";
import { api } from "./net.js";
import { $, el, modal, closeModal, toast, ask, cardTile, renderHud, itemLine, itemTitle, optText, clsIcon, icon } from "./ui.js";
import {
  STAGES, STAGE_COUNT, MONSTERS, BOSS_DAILY, PARTY_MAX, CARDS, GRADES, SELL_PRICE, deckSize, DECK_MIN, MAX_COPIES, CLASSES, SKILLS,
  ENH_MAX, enhCost, enhChance, enhFailText, ENH_PITY, itemSellPrice, MATS, heroStats, skillText, COMBINE_MAX, PACK_ODDS,
} from "../shared/content.js";

// 장비 줄 아이콘: 내 직업의 검·지팡이·홀, 갑옷·로브·법의
const slotIcon = (slot) => (slot === "weapon" ? "wpn_" : "arm_") + G.me.cls;

async function refreshMe() {
  const m = await api("me");
  Object.assign(G, { me: m.user, mats: m.mats, admin: m.admin, bossToday: m.bossToday });
  renderHud();
  return m;
}
const fail = (e) => toast(e.message || String(e), "bad");
const loading = () => el("p.muted", {}, "불러오는 중…");
function tabs(names, cur, on) {
  return el("div.mtabs", {}, ...names.map(([k, label]) => el("button" + (k === cur ? ".on" : ""), { on: { click: () => on(k) } }, label)));
}
const groupBy = (cards) => {
  const g = new Map();
  for (const c of cards) {
    if (!g.has(c.key)) g.set(c.key, []);
    g.get(c.key).push(c);
  }
  return [...g.entries()].sort((a, b) => CARDS[b[0]].grade - CARDS[a[0]].grade || CARDS[a[0]].cost - CARDS[b[0]].cost);
};

export function openPanel(name, ctx) {
  const fn = { stages, smithy, shop, cards, bag, settings, admin }[name];
  if (fn) fn(ctx).catch(fail);
}

// ───── 던전 입구 ─────
async function stages(ctx) {
  const m = modal("던전 입구", loading(), { wide: true });
  await refreshMe();
  const party = ctx.party;
  const lead = !party || party.leader === G.me.id;
  const online = party ? party.members.filter((x) => x.online).length : 1;
  const body = el(
    "div",
    {},
    el("p.muted", {}, party ? (lead ? `파티 ${online}명이 같이 들어가요. 마을에 없는 파티원은 빠져요.` : "파티장이 단계를 골라 들어가요.") : `혼자 들어가요. 혼자 가면 몬스터가 1명에 맞게 약해지고 보상은 같아요. 파티는 ${PARTY_MAX}명까지예요.`),
    el(
      "div.list",
      {},
      ...STAGES.slice(1).map((st) => {
        const locked = st.n > G.me.maxStage + 1;
        const used = G.bossToday[st.n] || 0;
        return el(
          "div.stage" + (locked ? ".lock" : ""),
          {},
          el("div.n", {}, `${st.n}단계`),
          el(
            "div.grow",
            {},
            el("div.t", {}, `${st.name} · 보스 ${MONSTERS[st.boss].name}`),
            el("div.s", {}, `권장 Lv ${st.level} · 방 ${st.rooms.length}개 · 오늘 보스 보상 ${Math.max(0, BOSS_DAILY - used)}/${BOSS_DAILY}번 남음${st.n <= G.me.maxStage ? " · 깸" : ""}`),
            locked ? el("div.s.money", {}, icon("lock"), `${st.n - 1}단계 보스를 먼저 잡아요`) : null,
          ),
          el(
            "button.btn",
            {
              disabled: locked || !lead,
              on: {
                click: (e) => {
                  e.target.disabled = true;
                  e.target.textContent = "들어가는 중…";
                  ctx.send({ t: "enter", stage: st.n });
                  setTimeout(() => {
                    e.target.disabled = false;
                    e.target.textContent = "들어가기";
                  }, 5000);
                },
              },
            },
            "들어가기",
          ),
        );
      }),
    ),
    el("p.muted", { style: { marginTop: "10px" } }, `더 높은 단계는 나중에 열려요. 보스 보상(강화석·카드 팩·장비·주문서)은 단계마다 하루 ${BOSS_DAILY}번, 경험치와 골드는 언제나 받아요.`),
  );
  m.box.querySelector(".mbody").replaceChildren(body);
}

// ───── 대장간 ─────
async function smithy() {
  const m = modal("대장간", loading(), { wide: true });
  let inv = await api("inventory");
  let sel = null;
  let result = null;
  let busy = false;
  const guards = { dropGuard: false, breakGuard: false };
  function draw() {
    const items = [...inv.items].sort((a, b) => b.equipped - a.equipped || b.tier - a.tier || b.enh - a.enh);
    if (!sel || !items.some((x) => x.id === sel)) sel = (items.find((x) => x.equipped && x.slot === "weapon") || items[0] || {}).id;
    const it = items.find((x) => x.id === sel);
    const body = el(
      "div",
      {},
      el("p.muted.money", {}, icon("mat:gold"), `${inv.user.gold}골드`, icon("mat:stone"), `강화석 ${inv.mats.stone}`, icon("mat:guard_drop"), `하락 방지 ${inv.mats.guard_drop}`, icon("mat:guard_break"), `파괴 방지 ${inv.mats.guard_break}`),
      el(
        "div.list",
        {},
        ...items.map((x) =>
          el(
            "div.li" + (x.id === sel ? ".sel" : ""),
            { on: { click: () => ((sel = x.id), (result = null), draw()) } },
            icon(slotIcon(x.slot), 2),
            el("div.grow", {}, el("div.t", {}, itemTitle(x), " ", x.equipped ? el("span.tag", {}, "끼는 중") : null), el("div.s", {}, itemLine(x), x.opt ? ` · 옵션 ${optText(x.opt)}` : "")),
            !x.equipped ? el("button.btn.ghost.small", { on: { click: (e) => (e.stopPropagation(), equip(x.id)) } }, "끼기") : null,
          ),
        ),
      ),
      it ? detail(it) : null,
    );
    m.box.querySelector(".mbody").replaceChildren(body);
  }
  function detail(it) {
    const box = el("div.box");
    if (result) box.append(result);
    if (it.enh >= ENH_MAX) {
      box.append(el("p", {}, `${itemTitle(it)}은 +${ENH_MAX}, 최고 강화예요.`));
      return box;
    }
    const t = it.enh + 1;
    const cost = enhCost(t);
    const chance = enhChance(t, it.fails);
    const next = { ...it, enh: t };
    box.append(
      ...[
      el("div.t", { style: { fontWeight: 800, fontSize: "16px" } }, `+${it.enh} → +${t}`),
      el("div.stats", { style: { marginTop: "8px" } },
        el("div", {}, "지금", el("b", {}, itemLine(it) || "-")),
        el("div", {}, "성공하면", el("b", {}, itemLine(next))),
        el("div", {}, "성공 확률", el("b", {}, `${chance}%`), it.fails ? el("span.muted", {}, `연속 실패 ${it.fails}번 → +${it.fails * ENH_PITY}%`) : null),
        el("div", {}, "드는 것", el("b.money", {}, icon("mat:gold"), cost.gold, icon("mat:stone"), cost.stone)),
      ),
      el("p.muted", {}, enhFailText(t)),
      t >= 6 ? el("label.chk", {}, el("input", { type: "checkbox", checked: guards.dropGuard, disabled: !inv.mats.guard_drop, on: { change: (e) => (guards.dropGuard = e.target.checked) } }), icon("mat:guard_drop"), `하락 방지 주문서 쓰기 (${inv.mats.guard_drop}장)`) : null,
      t >= 14 ? el("label.chk", {}, el("input", { type: "checkbox", checked: guards.breakGuard, disabled: !inv.mats.guard_break, on: { change: (e) => (guards.breakGuard = e.target.checked) } }), icon("mat:guard_break"), `파괴 방지 주문서 쓰기 (${inv.mats.guard_break}장, 부서지면 두 단계 하락으로)`) : null,
      t >= 6 ? el("p.muted", {}, "주문서는 실제로 막아 줄 때만 없어져요.") : null,
      el("div.row.end", {}, el("button.btn", { disabled: busy || inv.user.gold < cost.gold || inv.mats.stone < cost.stone, on: { click: () => go(it) } }, inv.user.gold < cost.gold ? "골드가 모자라요" : inv.mats.stone < cost.stone ? "강화석이 모자라요" : "강화하기")),
      ].filter(Boolean),
    );
    return box;
  }
  async function go(it) {
    if (busy) return;
    if (it.enh + 1 >= 14 && !guards.breakGuard) {
      if (!(await ask(`+${it.enh + 1} 강화는 실패하면 두 단계 내려가고, 드물게 장비가 부서질 수 있어요. 할까요?`, "강화하기"))) return smithy();
    }
    busy = true;
    result = el("div.big.forge", {}, icon("smithy", 4));
    draw();
    try {
      const [r] = await Promise.all([api("enhance", { id: it.id, ...guards }), new Promise((res) => setTimeout(res, 700))]);
      const res = r.result;
      const msg = {
        success: [`성공! +${res.enh}`, "ok"],
        keep: ["실패… 그대로예요", "bad"],
        drop1: [`실패… 한 단계 내려갔어요 (+${res.enh})`, "bad"],
        drop2: [`실패… 두 단계 내려갔어요 (+${res.enh})`, "bad"],
        destroy: ["장비가 부서졌어요…", "bad"],
      }[res.outcome];
      result = el("div", {}, el("div.big." + msg[1], {}, msg[0]), res.usedDrop ? el("p.muted", { style: { textAlign: "center" } }, icon("mat:guard_drop"), "하락 방지 주문서가 막아 줬어요.") : null, res.usedBreak ? el("p.muted", { style: { textAlign: "center" } }, icon("mat:guard_break"), "파괴 방지 주문서 덕분에 부서지지 않았어요.") : null);
      if (res.outcome === "destroy") sel = null;
      inv = await api("inventory");
      await refreshMe();
    } catch (e) {
      result = null;
      fail(e);
    }
    busy = false;
    draw();
  }
  async function equip(id) {
    try {
      await api("equip", { id });
      inv = await api("inventory");
      draw();
      toast("장비를 바꿨어요.");
    } catch (e) {
      fail(e);
    }
  }
  draw();
}

// ───── 상점 ─────
async function shop() {
  const m = modal("상점", loading(), { wide: true });
  let inv = await api("inventory");
  let tab = "cards";
  function draw() {
    const free = inv.cards.filter((c) => !c.in_deck);
    const items = inv.items.filter((x) => !x.equipped);
    let list;
    if (tab === "cards") {
      const groups = groupBy(free);
      list = groups.length
        ? el(
            "div.list",
            {},
            ...groups.map(([key, cs]) => {
              const c = CARDS[key];
              const price = SELL_PRICE[c.grade];
              return el(
                "div.li",
                {},
                icon("card:" + key, 2),
                el("div.grow", {}, el("div.t", {}, `${c.name} `, el("span.s", {}, `${GRADES[c.grade]} · ${cs.length}장`)), el("div.s", {}, `한 장 ${price}골드`)),
                el("button.btn.ghost.small", { on: { click: () => sell([cs[0].id]) } }, `1장 팔기`),
                cs.length > 1 ? el("button.btn.small", { on: { click: () => sell(cs.map((x) => x.id)) } }, `${cs.length}장 ${price * cs.length}골드`) : null,
              );
            }),
          )
        : el("p.muted", {}, "덱에 안 넣은 카드가 없어요. 덱에 든 카드는 팔 수 없어요.");
    } else {
      list = items.length
        ? el(
            "div.list",
            {},
            ...items.map((x) =>
              el(
                "div.li",
                {},
                icon(slotIcon(x.slot), 2),
                el("div.grow", {}, el("div.t", {}, itemTitle(x)), el("div.s", {}, itemLine(x), x.opt ? ` · 옵션 ${optText(x.opt)}` : "")),
                el("button.btn.small", { on: { click: () => sellItem(x) } }, `${itemSellPrice(x)}골드에 팔기`),
              ),
            ),
          )
        : el("p.muted", {}, "끼지 않은 장비가 없어요.");
    }
    m.box.querySelector(".mbody").replaceChildren(
      el("p.muted.money", {}, icon("mat:gold"), `${inv.user.gold}골드 · 카드는 팔기만 할 수 있어요. 골드는 대장간 강화에 써요.`),
      tabs([["cards", "카드 팔기"], ["items", "장비 팔기"]], tab, (k) => ((tab = k), draw())),
      list,
    );
  }
  async function sell(ids) {
    try {
      const r = await api("sell", { ids });
      toast(`${r.sold}장 팔아서 ${r.gold}골드를 받았어요.`, "good");
      inv = await api("inventory");
      await refreshMe();
      draw();
    } catch (e) {
      fail(e);
    }
  }
  async function sellItem(x) {
    if ((x.enh > 0 || x.opt) && !(await ask(`${itemTitle(x)}을 팔까요?`, "팔기"))) return shop();
    try {
      const r = await api("sellitem", { id: x.id });
      toast(`${r.gold}골드를 받았어요.`, "good");
      inv = await api("inventory");
      await refreshMe();
      draw();
    } catch (e) {
      fail(e);
    }
  }
  draw();
}

// ───── 카드 보관소 ─────
async function cards(_ctx, startTab = "deck") {
  const m = modal("카드 보관소", loading(), { wide: true });
  let inv = await api("inventory");
  let tab = startTab;
  let deck = new Set(inv.cards.filter((c) => c.in_deck).map((c) => c.id));
  let dirty = false;
  let slots = [];
  let cgrade = 0;
  let packShow = null;
  const limit = () => deckSize(G.me.level);
  function draw() {
    const body = el("div", {}, tabs([["deck", "덱 만들기"], ["combine", "합성"], ["pack", `카드 팩 (${inv.mats.pack})`]], tab, (k) => {
      if (dirty && k !== "deck") toast("덱을 저장하지 않았어요.", "bad");
      tab = k;
      draw();
    }));
    if (tab === "deck") body.append(deckView());
    else if (tab === "combine") body.append(combineView());
    else body.append(packView());
    m.box.querySelector(".mbody").replaceChildren(body);
  }
  function deckView() {
    const inDeck = inv.cards.filter((c) => deck.has(c.id));
    const out = inv.cards.filter((c) => !deck.has(c.id));
    const count = (key) => inDeck.filter((c) => c.key === key).length;
    const n = inDeck.length;
    return el(
      "div",
      {},
      el("div.row", {}, el("b", {}, `덱 ${n}장`), el("span.muted", {}, `(${DECK_MIN}~${limit()}장, 같은 카드 ${MAX_COPIES}장까지 · 10레벨마다 늘어나요)`), el("div", { style: { flex: 1 } }), el("button.btn", { disabled: !dirty || n < DECK_MIN || n > limit(), on: { click: save } }, dirty ? "덱 저장" : "저장됨")),
      el("h4", {}, "덱에 든 카드 (누르면 빼요)"),
      el("div.grid", {}, ...groupBy(inDeck).map(([key, cs]) => cardTile(key, { badge: `×${cs.length}`, onClick: () => (deck.delete(cs[cs.length - 1].id), (dirty = true), draw()) }))),
      el("h4", {}, "가진 카드 (누르면 넣어요)"),
      out.length
        ? el(
            "div.grid",
            {},
            ...groupBy(out).map(([key, cs]) =>
              cardTile(key, {
                badge: `×${cs.length}`,
                disabled: count(key) >= MAX_COPIES || n >= limit(),
                onClick: () => {
                  if (count(key) >= MAX_COPIES) return toast(`같은 카드는 ${MAX_COPIES}장까지예요.`);
                  if (n >= limit()) return toast(`지금 레벨에서는 ${limit()}장까지예요.`);
                  deck.add(cs[0].id);
                  dirty = true;
                  draw();
                },
              }),
            ),
          )
        : el("p.muted", {}, "덱 밖에 있는 카드가 없어요. 카드 팩을 열어 보세요."),
    );
  }
  async function save() {
    try {
      await api("deck", { ids: [...deck] });
      dirty = false;
      inv = await api("inventory");
      toast("덱을 저장했어요.", "good");
      draw();
    } catch (e) {
      fail(e);
    }
  }
  function combineView() {
    const free = inv.cards.filter((c) => !c.in_deck && CARDS[c.key].grade === cgrade && !slots.includes(c.id));
    return el(
      "div",
      {},
      el("p.muted", {}, `같은 등급 카드 3장을 넣으면 위 등급 카드 1장이 무작위로 나와요 (희귀까지). 덱에 든 카드는 쓸 수 없어요.`),
      tabs([[0, "일반 3장 → 고급"], [1, "고급 3장 → 희귀"]], cgrade, (g) => ((cgrade = g), (slots = []), draw())),
      el(
        "div.row",
        { style: { margin: "8px 0" } },
        ...[0, 1, 2].map((i) => {
          const id = slots[i];
          const c = id && inv.cards.find((x) => x.id === id);
          return c ? cardTile(c.key, { onClick: () => ((slots = slots.filter((x) => x !== id)), draw()) }) : el("div.card", { style: { borderStyle: "dashed", opacity: 0.5 } }, el("div.icon", {}, "＋"));
        }),
        el("button.btn", { disabled: slots.length !== 3, on: { click: combine } }, "합성하기"),
      ),
      free.length ? el("div.grid", {}, ...groupBy(free).map(([key, cs]) => cardTile(key, { badge: `×${cs.length}`, onClick: () => slots.length < 3 && (slots.push(cs[0].id), draw()) }))) : el("p.muted", {}, `덱 밖에 ${GRADES[cgrade]} 카드가 없어요.`),
    );
  }
  async function combine() {
    try {
      const r = await api("combine", { ids: slots });
      slots = [];
      inv = await api("inventory");
      draw();
      modalReveal("합성 결과", [r.card.key], () => cards(null, "combine"));
    } catch (e) {
      fail(e);
    }
  }
  function packView() {
    return el(
      "div",
      {},
      el("p.muted", {}, `카드 팩 하나에 내 직업 카드 5장 (일반 ${PACK_ODDS[0]}% · 고급 ${PACK_ODDS[1]}% · 희귀 ${PACK_ODDS[2]}%). 팩은 보스·매일 첫 접속에 받아요.`),
      el("div.row", {}, el("b.money", {}, icon("mat:pack"), `카드 팩 ${inv.mats.pack}개`), el("button.btn", { disabled: !inv.mats.pack, on: { click: openPack } }, "팩 열기")),
      packShow ? el("div.grid", { style: { marginTop: "12px" } }, ...packShow.map((k, i) => {
        const t = cardTile(k);
        t.classList.add("flip");
        t.style.animationDelay = `${i * 0.15}s`;
        return t;
      })) : null,
    );
  }
  async function openPack() {
    try {
      const r = await api("pack", {});
      packShow = r.cards.map((c) => c.key);
      inv = await api("inventory");
      await refreshMe();
      draw();
    } catch (e) {
      fail(e);
    }
  }
  draw();
}
function modalReveal(title, keys, back) {
  modal(
    title,
    el("div", {}, el("div.row", { style: { justifyContent: "center" } }, ...keys.map((k) => {
      const t = cardTile(k);
      t.classList.add("flip");
      return t;
    })), el("div.row.end", {}, el("button.btn", { on: { click: back } }, "좋아요"))),
    { onClose: null },
  );
}

// ───── 가방 ─────
async function bag() {
  const m = modal("가방", loading(), { wide: true });
  const inv = await api("inventory");
  const eq = inv.items.filter((x) => x.equipped);
  const s = heroStats(G.me.cls, G.me.level, eq);
  const c = CLASSES[G.me.cls];
  m.box.querySelector(".mbody").replaceChildren(
    el("div.row", {}, clsIcon(G.me.cls, 3), el("b", {}, `${G.me.name} · ${c.name} Lv ${G.me.level}`), el("span.muted", {}, `경험치 ${G.me.exp}/${G.me.need}`)),
    el("div.stats", { style: { marginTop: "8px" } },
      el("div", {}, "체력", el("b", {}, s.maxHp)),
      el("div", {}, "공격 (카드 피해에 더함)", el("b", {}, `+${s.atk}`)),
      el("div", {}, "방어력 (맞을 때마다 뺌)", el("b", {}, s.def)),
      el("div", {}, "치명타", el("b", {}, `${s.crit}%`)),
      el("div", {}, "회피", el("b", {}, `${s.dodge}%`)),
      el("div", {}, "골드", el("b.money", {}, icon("mat:gold"), inv.user.gold)),
    ),
    el("h4", {}, "재료"),
    el("div.stats", {}, ...Object.entries(MATS).map(([k, x]) => el("div", {}, el("span.money", {}, icon("mat:" + k), x.name), el("b", {}, inv.mats[k] || 0)))),
    el("h4", {}, "장비"),
    el(
      "div.list",
      {},
      ...[...inv.items].sort((a, b) => b.equipped - a.equipped || b.tier - a.tier).map((x) =>
        el(
          "div.li",
          {},
          icon(slotIcon(x.slot), 2),
          el("div.grow", {}, el("div.t", {}, itemTitle(x), " ", x.equipped ? el("span.tag", {}, "끼는 중") : null), el("div.s", {}, itemLine(x), x.opt ? ` · 옵션 ${optText(x.opt)}` : "")),
          !x.equipped
            ? el("button.btn.ghost.small", {
                on: {
                  click: async () => {
                    try {
                      await api("equip", { id: x.id });
                      toast("장비를 바꿨어요.");
                      bag();
                    } catch (e) {
                      fail(e);
                    }
                  },
                },
              }, "끼기")
            : null,
        ),
      ),
    ),
    el("h4", {}, "직업 기술 (마나 없이 한 턴에 하나)"),
    el("div.list", {}, ...c.skills.map((k) => {
      const sk = SKILLS[k];
      return el("div.li", { style: { cursor: "default", opacity: G.me.level >= sk.lv ? 1 : 0.5 } }, icon("skill:" + k, 2), el("div.grow", {}, el("div.t", {}, sk.name, G.me.level < sk.lv ? ` (Lv ${sk.lv}부터)` : ""), el("div.s", {}, `${skillText(sk)} · 다시 쓰려면 ${sk.cd}턴`)));
    })),
  );
}

// ───── 설정 ─────
async function settings() {
  const err = el("div.err");
  const old = el("input", { type: "password", placeholder: "지금 비밀번호", autocomplete: "current-password" });
  const pw = el("input", { type: "password", placeholder: "새 비밀번호 (6자 이상)", autocomplete: "new-password" });
  modal(
    "설정",
    el(
      "div",
      {},
      el("p", {}, el("b", {}, G.me.name), ` · 아이디 ${G.me.login}`),
      el("h4", {}, "비밀번호 바꾸기"),
      el("div.list", {}, old, pw, err, el("button.btn", {
        on: {
          click: async () => {
            try {
              await api("password", { old: old.value, password: pw.value });
              toast("비밀번호를 바꿨어요.", "good");
              closeModal();
            } catch (e) {
              err.textContent = e.message;
            }
          },
        },
      }, "바꾸기")),
      el("p.muted", {}, "비밀번호를 잊으면 관리자에게 임시 비밀번호를 받아요."),
      el("h4", {}, "하는 법"),
      el("p.muted", { html: "마을: WASD·방향키(휴대폰은 방향 패드나 누른 곳)로 걷고, 건물 앞에서 <b>E</b>. 다른 사람을 누르면 파티 초대.<br>전투: 카드를 누르면 바로 써요. 마나는 턴마다 1씩 늘어요(최대 7). 적을 누르면 그 적을 노려요(Tab도 돼요). 숫자키 1~8로 카드, 스페이스로 턴 끝.<br>적 머리 위 표시는 다음에 할 행동이에요. 확률 효과는 실패할수록 다음 확률이 조금씩 올라가요." }),
      el("div.row.end", {}, el("button.btn.red", {
        on: {
          click: async () => {
            try {
              await api("logout", {});
            } catch (e) {}
            location.reload();
          },
        },
      }, "로그아웃")),
    ),
  );
}

// ───── 관리자 ─────
async function admin() {
  const m = modal("관리자", loading(), { wide: true });
  const r = await api("admin/users");
  const ago = (t) => {
    if (!t) return "-";
    const d = (Date.now() - t) / 60000;
    return d < 1 ? "방금" : d < 60 ? `${Math.floor(d)}분 전` : d < 1440 ? `${Math.floor(d / 60)}시간 전` : `${Math.floor(d / 1440)}일 전`;
  };
  async function act(path, body, okText) {
    try {
      const x = await api("admin/" + path, body);
      if (x.temp) {
        await ask(`임시 비밀번호: ${x.temp}\n이 비밀번호를 알려 주고, 로그인한 뒤 설정에서 바꾸라고 해 주세요.`, "확인", "닫기");
      } else toast(okText, "good");
      admin();
    } catch (e) {
      fail(e);
    }
  }
  function grant(u) {
    const f = {};
    const inputs = [["gold", "골드"], ["stone", "강화석"], ["pack", "카드 팩"], ["guard_drop", "하락 방지"], ["guard_break", "파괴 방지"]].map(([k, label]) => {
      const i = el("input", { type: "number", min: 0, placeholder: label, style: { width: "100px" } });
      f[k] = i;
      return el("label.muted", {}, label, i);
    });
    modal(`${u.name}님에게 주기`, el("div", {}, el("div.row", {}, ...inputs), el("div.row.end", {}, el("button.btn", {
      on: {
        click: () => {
          const body = { id: u.id };
          for (const [k, i] of Object.entries(f)) if (i.value) body[k] = Math.floor(Number(i.value));
          act("grant", body, "줬어요.");
        },
      },
    }, "주기"))));
  }
  m.box.querySelector(".mbody").replaceChildren(
    el("p.muted", {}, `가입한 사람 ${r.users.length}명. 비밀번호를 잊은 사람은 임시 비밀번호를 만들어 알려 주세요.`),
    el(
      "table",
      {},
      el("tr", {}, ...["이름", "아이디", "직업", "Lv", "최고 단계", "최근 접속", ""].map((h) => el("th", {}, h))),
      ...r.users.map((u) =>
        el(
          "tr",
          {},
          el("td", {}, u.name),
          el("td", {}, u.login),
          el("td", {}, u.cls ? CLASSES[u.cls].name : "-"),
          el("td", {}, u.level),
          el("td", {}, u.max_stage),
          el("td", {}, ago(u.last_seen)),
          el(
            "td",
            {},
            el("div.row", {},
              el("button.btn.ghost.small", { on: { click: async () => (await ask(`${u.name}님의 비밀번호를 임시 비밀번호로 바꿀까요?`, "바꾸기")) ? act("reset", { id: u.id }) : admin() } }, "임시 비번"),
              el("button.btn.ghost.small", { on: { click: () => grant(u) } }, "주기"),
              u.id !== G.me.id ? el("button.btn.red.small", { on: { click: async () => (await ask(`${u.name}(${u.login}) 계정을 지울까요? 되돌릴 수 없어요.`, "지우기")) ? act("delete", { id: u.id }, "지웠어요.") : admin() } }, "삭제") : null,
            ),
          ),
        ),
      ),
    ),
  );
}

// ───── 던전 보상 ─────
export function showRewards(r, won, done, left = false) {
  const rows = [];
  if (r && !r.error) {
    rows.push(el("div.money", {}, icon("mat:exp"), `경험치 +${r.exp}`, r.ups ? el("b", { style: { color: "var(--gold)" } }, `  레벨 업! Lv ${r.level}`) : null));
    rows.push(el("div.money", {}, icon("mat:gold"), `골드 +${r.gold}`));
    if (r.stone) rows.push(el("div.money", {}, icon("mat:stone"), `강화석 +${r.stone}`));
    if (r.pack) rows.push(el("div.money", {}, icon("mat:pack"), `카드 팩 +${r.pack}`));
    if (r.gear) rows.push(el("div.wide.money", {}, icon(r.gear.slot), `${itemTitle(r.gear)} (${itemLine(r.gear)}${r.gear.opt ? " · 옵션 " + optText(r.gear.opt) : ""})`));
    if (r.guardDrop) rows.push(el("div.money", {}, icon("mat:guard_drop"), "하락 방지 주문서 +1"));
    if (r.guardBreak) rows.push(el("div.money", {}, icon("mat:guard_break"), "파괴 방지 주문서 +1"));
    if (r.cards && r.cards.length) rows.push(el("div.wide", {}, "레벨 업 카드", el("div.row", { style: { marginTop: "6px" } }, ...r.cards.map((k) => cardTile(k)))));
    if (r.bossLeft === -1) rows.push(el("div.muted.wide", {}, `오늘 이 단계 보스 보상은 다 받았어요 (하루 ${BOSS_DAILY}번). 경험치·골드는 받아요.`));
    else if (r.bossLeft != null) rows.push(el("div.muted.wide", {}, `오늘 이 단계 보스 보상을 ${r.bossLeft}번 더 받을 수 있어요.`));
  } else if (r && r.error) rows.push(el("div", {}, "보상을 저장하다 문제가 생겼어요. 관리자에게 알려 주세요."));
  modal(
    left ? "던전에서 나왔어요" : won ? "던전 클리어!" : "던전 실패",
    el("div", {}, !won && !left ? el("p.muted", {}, "모두 쓰러졌어요. 그때까지 얻은 경험치·골드·강화석은 받아요.") : null, el("div.reward", {}, ...rows), el("div.row.end", {}, el("button.btn", { on: { click: done } }, "마을로"))),
    { sticky: true, onClose: null },
  );
}
