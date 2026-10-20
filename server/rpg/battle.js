// 던전 RPG 전투 규칙. 서버(던전 Durable Object)만 결과를 정한다. 화면은 events를 받아 연출만 한다.
// 한 턴: 파티 모두가 카드·기술을 바로바로 쓰고(쓰는 즉시 결과) '턴 끝'을 누르면 → 정령 → 적 → 독·화상 순서.
// 확률 효과는 같은 종류가 실패할 때마다 다음 판정 확률이 올라간다(PITY_STEP).
import { CARDS, SKILLS, CLASSES, MONSTERS, MOVES, STAGES, PITY_STEP, CRIT_MULT, TURN, partyScale, prob, ROOM_REST } from "../../rpg/shared/content.js";

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const ROOM = { w: 960, h: 540, spawnX: 110, foeX: 600, doorX: 905, midY: 290 };

export function newRun(run, stage, heroes) {
  const players = {};
  heroes.forEach((h, i) => {
    players[h.uid] = {
      uid: h.uid, name: h.name, cls: h.cls, level: h.level, ...h.stats, hp: h.stats.maxHp, deck: h.deck,
      x: ROOM.spawnX + (i % 2) * 45, y: ROOM.midY - 90 + i * 60, d: 1, left: false, down: false,
      hand: [], draw: [], disc: [], mana: 0, maxMana: 0, block: 0, dodgeBuff: 0, counter: 0, taunt: false, critBuff: 0,
      stun: false, stunned: false, ready: false, usedSkill: false, cd: {}, dots: [], pity: {},
      earned: { exp: 0, gold: 0, stone: 0 },
    };
  });
  return { run, stage, created: Date.now(), phase: "explore", room: 0, cleared: false, order: heroes.map((h) => h.uid), players, enemies: [], spirits: [], turn: 0, deadline: 0, seq: 1, result: null };
}

const active = (S) => S.order.map((id) => S.players[id]).filter((p) => !p.left);
const alivePlayers = (S) => active(S).filter((p) => !p.down);
const aliveEnemies = (S) => S.enemies.filter((e) => e.hp > 0);
const pid = (p) => "p:" + p.uid;
const eid = (e) => "e:" + e.id;
const sid = (s) => "s:" + s.id;

// 확률 판정 + 연속 실패 보정
function roll(p, kind, chance) {
  if (chance >= 100) return true;
  const fails = p.pity[kind] || 0;
  if (Math.random() * 100 < chance + fails * PITY_STEP) {
    p.pity[kind] = 0;
    return true;
  }
  p.pity[kind] = fails + 1;
  return false;
}

function addDot(u, kind, n, turns) {
  const d = u.dots.find((x) => x.kind === kind);
  if (d) {
    d.n = Math.max(d.n, n);
    d.turns = Math.max(d.turns, turns);
  } else u.dots.push({ kind, n, turns });
}

function draw(p, n, S) {
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= TURN.handMax) return;
    if (!p.draw.length) {
      if (!p.disc.length) return;
      p.draw = shuffle(p.disc);
      p.disc = [];
    }
    p.hand.push({ id: S.seq++, k: p.draw.pop() });
  }
}

// 적이 맞음
function hitEnemy(S, ev, e, n, crit = false) {
  if (e.hp <= 0) return 0;
  n = Math.max(1, n - e.def);
  const blocked = Math.min(e.block, n);
  e.block -= blocked;
  n -= blocked;
  e.hp = Math.max(0, e.hp - n);
  ev.push({ e: "dmg", to: eid(e), n, blocked, crit, hp: e.hp, block: e.block });
  if (e.hp <= 0) ev.push({ e: "die", to: eid(e) });
  return n;
}

// 플레이어가 맞음 (회피 → 방어력 → 방어 → 체력, 되갚기)
function hitPlayer(S, ev, from, p, n) {
  if (p.dodgeBuff > 0) {
    const ok = roll(p, "dodge", p.dodgeBuff);
    p.dodgeBuff = 0;
    if (ok) {
      ev.push({ e: "dodge", to: pid(p) });
      return -1;
    }
    ev.push({ e: "fail", to: pid(p), what: "회피" });
  } else if (p.dodge > 0 && Math.random() * 100 < p.dodge) {
    ev.push({ e: "dodge", to: pid(p) });
    return -1;
  }
  n = Math.max(1, n - p.def);
  const blocked = Math.min(p.block, n);
  p.block -= blocked;
  n -= blocked;
  p.hp = Math.max(0, p.hp - n);
  ev.push({ e: "dmg", to: pid(p), n, blocked, hp: p.hp, block: p.block });
  if (p.hp <= 0) {
    p.down = true;
    ev.push({ e: "die", to: pid(p) });
  }
  if (p.counter > 0 && from && from.hp > 0) {
    ev.push({ e: "act", by: pid(p), anim: "counter", target: eid(from) });
    hitEnemy(S, ev, from, p.counter);
  }
  return n;
}

function hitSpirit(S, ev, s, n) {
  s.hp = Math.max(0, s.hp - n);
  ev.push({ e: "dmg", to: sid(s), n, blocked: 0, hp: s.hp, block: 0 });
  if (s.hp <= 0) {
    ev.push({ e: "die", to: sid(s) });
    S.spirits = S.spirits.filter((x) => x !== s);
  }
  return n;
}

function heal(ev, u, n, id) {
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + n);
  ev.push({ e: "heal", to: id, n: u.hp - before, hp: u.hp });
}

function rollDmg(p, f, grade, single) {
  // 무기 강화가 높을수록 최소 피해가 올라간다
  const lo = f.min + Math.floor((f.max - f.min) * Math.min(1, p.enh / 15) * 0.5);
  let n = Math.max(rnd(f.min, f.max), lo) + (single ? p.atk : Math.floor(p.atk / 2));
  const chance = p.crit + p.critBuff + (f.crit ? prob({}, "crit", grade) : 0);
  const crit = Math.random() * 100 < chance;
  if (crit) n = Math.round(n * CRIT_MULT);
  return { n, crit };
}

function pickTarget(S, target) {
  const alive = aliveEnemies(S);
  return alive.find((e) => e.id === target) || alive[0] || null;
}

// 카드·기술 효과 적용
function applyFx(S, ev, p, fx, grade, target) {
  let hit = [];
  for (const f of fx) {
    if (f.t === "dmg" || f.t === "drain") {
      const list = f.to === "all" ? aliveEnemies(S) : f.hits ? [] : [pickTarget(S, target)].filter(Boolean);
      if (f.hits) for (let i = 0; i < f.hits; i++) {
        const e = pick(aliveEnemies(S));
        if (!e) break;
        const r = rollDmg(p, f, grade, false);
        hitEnemy(S, ev, e, r.n, r.crit);
        hit.push(e);
      }
      for (const e of list) {
        const r = rollDmg(p, f, grade, f.to !== "all");
        const dealt = hitEnemy(S, ev, e, r.n, r.crit);
        if (f.t === "drain" && dealt > 0) heal(ev, p, dealt, pid(p));
      }
      hit = hit.concat(list);
    } else if (f.t === "block") {
      for (const q of f.to === "party" ? alivePlayers(S) : [p]) {
        q.block += f.n;
        ev.push({ e: "block", to: pid(q), n: f.n, block: q.block });
      }
    } else if (f.t === "heal") {
      const n = f.n + Math.floor(p.atk / 3);
      let list = [p];
      if (f.to === "all") list = alivePlayers(S);
      else if (f.to === "low") list = [alivePlayers(S).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]];
      for (const q of list) heal(ev, q, n, pid(q));
    } else if (f.t === "dodge") {
      p.dodgeBuff = Math.max(p.dodgeBuff, prob(f, "dodge", grade));
      ev.push({ e: "buff", to: pid(p), what: "dodge", n: p.dodgeBuff });
    } else if (f.t === "stun" || f.t === "dot") {
      const list = f.to === "all" ? aliveEnemies(S) : hit.length ? hit.filter((e) => e.hp > 0).slice(0, 1) : [pickTarget(S, target)].filter(Boolean);
      for (const e of list) {
        if (e.hp <= 0) continue;
        if (roll(p, f.t, prob(f, f.t, grade))) {
          if (f.t === "stun") {
            e.stun = true;
            ev.push({ e: "stun", to: eid(e) });
          } else {
            addDot(e, f.kind, f.n, f.turns);
            ev.push({ e: "dotOn", to: eid(e), kind: f.kind });
          }
        } else ev.push({ e: "fail", to: eid(e), what: f.t === "stun" ? "기절" : f.kind === "burn" ? "화상" : "독" });
      }
    } else if (f.t === "counter") {
      p.counter += f.n;
      ev.push({ e: "buff", to: pid(p), what: "counter", n: p.counter });
    } else if (f.t === "taunt") {
      p.taunt = true;
      ev.push({ e: "buff", to: pid(p), what: "taunt" });
    } else if (f.t === "mana") {
      p.mana += f.n;
      ev.push({ e: "mana", to: pid(p), n: f.n });
    } else if (f.t === "spirit") {
      const mine = S.spirits.filter((s) => s.owner === p.uid);
      if (mine.length >= 2) S.spirits = S.spirits.filter((s) => s !== mine[0]);
      const s = { id: S.seq++, owner: p.uid, hp: f.hp, maxHp: f.hp, atk: f.atk + Math.floor(p.atk / 3) };
      S.spirits.push(s);
      ev.push({ e: "spirit", unit: { ...s }, gone: mine.length >= 2 ? sid(mine[0]) : null });
    } else if (f.t === "draw") {
      draw(p, f.n, S);
      ev.push({ e: "draw", to: pid(p), n: f.n });
    } else if (f.t === "crit") {
      p.critBuff += prob(f, "crit", grade);
      ev.push({ e: "buff", to: pid(p), what: "crit", n: p.critBuff });
    } else if (f.t === "cleanse") {
      for (const q of alivePlayers(S)) {
        q.dots = [];
        q.stun = false;
      }
      ev.push({ e: "cleanse" });
    }
  }
}

function canAct(S, p) {
  if (S.phase !== "battle") return "지금은 전투 중이 아니에요.";
  if (!p || p.left) return "이 던전에 없어요.";
  if (p.down) return "쓰러져서 움직일 수 없어요.";
  if (p.stunned) return "기절해서 이번 턴은 쉬어요.";
  if (p.ready) return "이미 턴을 끝냈어요.";
  return null;
}

export function playCard(S, uid, cardId, target) {
  const p = S.players[uid];
  const why = canAct(S, p);
  if (why) return { error: why };
  const i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return { error: "손에 없는 카드예요." };
  const card = CARDS[p.hand[i].k];
  if (p.mana < card.cost) return { error: "마나가 모자라요." };
  p.mana -= card.cost;
  p.disc.push(p.hand[i].k);
  p.hand.splice(i, 1);
  const t = pickTarget(S, target);
  const ev = [{ e: "act", by: pid(p), card: card.key, anim: card.anim, target: t ? eid(t) : null }];
  applyFx(S, ev, p, card.fx, card.grade, target);
  const ag = card.fx.find((f) => f.t === "again");
  if (ag && aliveEnemies(S).length) {
    if (roll(p, "again", prob(ag, "again", card.grade))) {
      ev.push({ e: "again", to: pid(p) });
      ev.push({ e: "act", by: pid(p), card: card.key, anim: card.anim, target: t && t.hp > 0 ? eid(t) : null });
      applyFx(S, ev, p, card.fx.filter((f) => f.t !== "again"), card.grade, target);
    } else ev.push({ e: "fail", to: pid(p), what: "한 번 더" });
  }
  afterAction(S, ev);
  return { ev };
}

export function useSkill(S, uid, key, target) {
  const p = S.players[uid];
  const why = canAct(S, p);
  if (why) return { error: why };
  const sk = SKILLS[key];
  if (!sk || !CLASSES[p.cls].skills.includes(key) || p.level < sk.lv) return { error: "쓸 수 없는 기술이에요." };
  if (p.usedSkill) return { error: "기술은 한 턴에 하나만 쓸 수 있어요." };
  if (p.cd[key] > 0) return { error: `${p.cd[key]}턴 뒤에 쓸 수 있어요.` };
  p.usedSkill = true;
  p.cd[key] = sk.cd + 1; // 다음 턴 시작에 하나 줄어든다
  const t = pickTarget(S, target);
  const ev = [{ e: "act", by: pid(p), skill: key, anim: sk.anim, target: t ? eid(t) : null }];
  applyFx(S, ev, p, sk.fx, 1, target);
  afterAction(S, ev);
  return { ev };
}

export function endTurn(S, uid) {
  const p = S.players[uid];
  if (S.phase !== "battle" || !p || p.ready) return { ev: [] };
  p.ready = true;
  const ev = [{ e: "ready", to: pid(p) }];
  if (active(S).every((q) => q.ready || q.down)) ev.push(...enemyPhase(S));
  return { ev };
}

// 연결이 끊긴 사람·시간이 다 된 사람은 턴을 끝낸 것으로 친다
export function forceEnd(S, uids) {
  if (S.phase !== "battle") return [];
  const ev = [];
  for (const p of active(S)) if (!p.ready && (!uids || uids.includes(p.uid))) {
    p.ready = true;
    ev.push({ e: "ready", to: pid(p) });
  }
  if (active(S).every((q) => q.ready || q.down)) ev.push(...enemyPhase(S));
  return ev;
}

function afterAction(S, ev) {
  if (!aliveEnemies(S).length) winBattle(S, ev);
}

function spawn(S, k, sc, summoned = false) {
  const m = MONSTERS[k];
  const hp = Math.round(m.hp * sc.hp);
  return {
    id: S.seq++, k, name: m.name, boss: !!m.boss, hp, maxHp: hp,
    atk: [Math.round(m.atk[0] * sc.atk), Math.round(m.atk[1] * sc.atk)], def: m.def,
    block: 0, stun: false, dots: [], rage: 0, intent: null, last: null, summoned,
  };
}

function nameEnemies(S) {
  const by = {};
  for (const e of S.enemies) (by[e.k] = by[e.k] || []).push(e);
  for (const list of Object.values(by)) {
    if (list.length < 2) {
      list[0].name = MONSTERS[list[0].k].name;
      continue;
    }
    list.forEach((e, i) => (e.name = `${MONSTERS[e.k].name} ${"ABCDEFG"[i]}`));
  }
}

function rollIntent(S, e) {
  const m = MONSTERS[e.k];
  let opts = m.moves.filter(([mv]) => !(mv === "summon" && aliveEnemies(S).length >= 4) && !(mv === e.last && (mv === "block" || mv === "enrage")));
  if (!opts.length) opts = [["attack", 1]];
  let r = Math.random() * opts.reduce((s, [, w]) => s + w, 0);
  let mv = opts[0][0];
  for (const [k, w] of opts) if ((r -= w) < 0) {
    mv = k;
    break;
  }
  const M = MOVES[mv];
  const avg = (e.atk[0] + e.atk[1]) / 2 + e.rage;
  const intent = { m: mv };
  if (["attack", "heavy", "howl", "quake", "drain", "poison", "web"].includes(mv)) intent.n = Math.max(1, Math.round(avg * (M.x || 1)));
  if (M.all) intent.all = true;
  e.intent = intent;
  e.last = mv;
}

function enemyTarget(S) {
  const ps = alivePlayers(S);
  const taunt = ps.filter((p) => p.taunt);
  if (taunt.length) return { p: pick(taunt) };
  const pool = ps.map((p) => ({ p, w: 1 })).concat(S.spirits.map((s) => ({ s, w: 0.5 })));
  let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
  for (const x of pool) if ((r -= x.w) < 0) return x;
  return pool[0] || null;
}

function enemyMove(S, ev, e) {
  const mv = e.intent ? e.intent.m : "attack";
  const M = MOVES[mv];
  const base = () => Math.max(1, Math.round((rnd(e.atk[0], e.atk[1]) + e.rage) * (M.x || 1)));
  const sc = partyScale(active(S).length);
  ev.push({ e: "act", by: eid(e), move: mv, anim: mv });
  if (mv === "block") {
    const n = Math.round((e.boss ? 10 : 5) * sc.atk);
    e.block += n;
    ev.push({ e: "block", to: eid(e), n, block: e.block });
  } else if (mv === "enrage") {
    e.rage += M.n;
    ev.push({ e: "buff", to: eid(e), what: "rage", n: e.rage });
  } else if (mv === "summon") {
    if (aliveEnemies(S).length < 4) {
      const w = spawn(S, "wolf", sc, true);
      S.enemies.push(w);
      nameEnemies(S);
      rollIntent(S, w);
      ev.push({ e: "summon", unit: enemyView(w) });
    }
  } else if (M.all) {
    for (const p of alivePlayers(S)) {
      const dealt = hitPlayer(S, ev, e, p, base());
      if (dealt >= 0 && M.stun && !p.down && Math.random() * 100 < M.stun) {
        p.stun = true;
        ev.push({ e: "stun", to: pid(p) });
      }
    }
    for (const s of [...S.spirits]) hitSpirit(S, ev, s, base());
  } else {
    const t = enemyTarget(S);
    if (!t) return;
    if (t.s) {
      ev[ev.length - 1].target = sid(t.s);
      hitSpirit(S, ev, t.s, base());
      return;
    }
    const p = t.p;
    ev[ev.length - 1].target = pid(p);
    const dealt = hitPlayer(S, ev, e, p, base());
    if (dealt < 0 || p.down) return;
    if (mv === "drain" && dealt > 0) heal(ev, e, dealt, eid(e));
    if (M.dot) {
      addDot(p, M.dot.kind, M.dot.n, M.dot.turns);
      ev.push({ e: "dotOn", to: pid(p), kind: M.dot.kind });
    }
    if (M.stun) {
      if (Math.random() * 100 < M.stun) {
        p.stun = true;
        ev.push({ e: "stun", to: pid(p) });
      } else ev.push({ e: "fail", to: pid(p), what: "기절" });
    }
  }
}

function tickDots(S, ev) {
  for (const e of aliveEnemies(S)) {
    for (const d of e.dots) {
      if (e.hp <= 0) break;
      e.hp = Math.max(0, e.hp - d.n);
      ev.push({ e: "dot", to: eid(e), kind: d.kind, n: d.n, hp: e.hp });
      if (e.hp <= 0) ev.push({ e: "die", to: eid(e) });
      d.turns--;
    }
    e.dots = e.dots.filter((d) => d.turns > 0);
  }
  for (const p of alivePlayers(S)) {
    for (const d of p.dots) {
      if (p.down) break;
      p.hp = Math.max(0, p.hp - d.n);
      ev.push({ e: "dot", to: pid(p), kind: d.kind, n: d.n, hp: p.hp });
      if (p.hp <= 0) {
        p.down = true;
        ev.push({ e: "die", to: pid(p) });
      }
      d.turns--;
    }
    p.dots = p.dots.filter((d) => d.turns > 0);
  }
}

function enemyPhase(S) {
  const ev = [{ e: "phase", who: "enemy" }];
  for (const s of [...S.spirits]) {
    const e = pick(aliveEnemies(S));
    if (!e) break;
    ev.push({ e: "act", by: sid(s), anim: "spiritHit", target: eid(e) });
    hitEnemy(S, ev, e, s.atk);
  }
  if (!aliveEnemies(S).length) {
    winBattle(S, ev);
    return ev;
  }
  for (const e of S.enemies) e.block = 0;
  for (const e of [...S.enemies]) {
    if (e.hp <= 0) continue;
    if (!alivePlayers(S).length) break;
    if (e.stun) {
      e.stun = false;
      ev.push({ e: "stunSkip", by: eid(e) });
      continue;
    }
    enemyMove(S, ev, e);
  }
  tickDots(S, ev);
  if (!alivePlayers(S).length) {
    loseBattle(S, ev);
    return ev;
  }
  if (!aliveEnemies(S).length) {
    winBattle(S, ev);
    return ev;
  }
  newTurn(S, ev);
  return ev;
}

function newTurn(S, ev) {
  S.turn++;
  S.enemies = S.enemies.filter((e) => e.hp > 0 || !e.summoned);
  for (const p of active(S)) {
    p.block = 0;
    p.taunt = false;
    p.counter = 0;
    p.dodgeBuff = 0;
    p.critBuff = 0;
    p.usedSkill = false;
    p.maxMana = Math.min(TURN.manaMax, TURN.manaStart + S.turn - 1);
    p.mana = p.maxMana;
    for (const k of Object.keys(p.cd)) p.cd[k] = Math.max(0, p.cd[k] - 1);
    if (S.turn > 1 && !p.down) draw(p, TURN.drawPerTurn, S);
    p.stunned = !p.down && p.stun;
    p.stun = false;
    p.ready = p.down || p.stunned;
  }
  for (const e of aliveEnemies(S)) rollIntent(S, e);
  S.deadline = Date.now() + TURN.seconds * 1000;
  ev.push({ e: "turn", turn: S.turn });
}

export function startBattle(S) {
  if (S.phase !== "explore" || S.cleared) return null;
  const st = STAGES[S.stage];
  const sc = partyScale(active(S).length);
  S.enemies = st.rooms[S.room].map((k) => spawn(S, k, sc));
  nameEnemies(S);
  S.spirits = [];
  S.turn = 0;
  S.phase = "battle";
  for (const p of active(S)) {
    p.draw = shuffle([...p.deck]);
    p.hand = [];
    p.disc = [];
    p.cd = {};
    p.dots = [];
    p.stun = false;
    p.pity = {};
    if (!p.down) draw(p, TURN.startHand, S);
  }
  const ev = [{ e: "battle" }];
  newTurn(S, ev);
  return ev;
}

function winBattle(S, ev) {
  if (S.phase !== "battle") return;
  const st = STAGES[S.stage];
  const bossRoom = S.room === st.rooms.length - 1;
  let exp = 0;
  let gold = 0;
  for (const e of S.enemies) {
    if (e.summoned) continue;
    exp += e.boss ? st.exp[1] : st.exp[0];
    gold += e.boss ? st.gold[1] : st.gold[0];
  }
  for (const p of active(S)) {
    p.earned.exp += exp;
    p.earned.gold += gold;
    if (!bossRoom) p.earned.stone += 1;
    if (p.down) {
      p.down = false;
      p.hp = Math.ceil(p.maxHp * 0.3);
    } else p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * ROOM_REST));
    p.block = 0;
    p.dots = [];
    p.stun = p.stunned = false;
    p.ready = false;
    p.hand = [];
  }
  S.enemies = [];
  S.spirits = [];
  S.cleared = true;
  S.phase = bossRoom ? "done" : "explore";
  if (bossRoom) S.won = true;
  ev.push({ e: "win", boss: bossRoom, exp, gold });
}

function loseBattle(S, ev) {
  S.phase = "done";
  S.won = false;
  ev.push({ e: "lose" });
}

// 탐험: 다음 방으로
export function nextRoom(S) {
  if (S.phase !== "explore" || !S.cleared) return false;
  if (S.room >= STAGES[S.stage].rooms.length - 1) return false;
  S.room++;
  S.cleared = false;
  active(S).forEach((p, i) => {
    p.x = ROOM.spawnX + (i % 2) * 45;
    p.y = ROOM.midY - 90 + i * 60;
  });
  return true;
}

// 한 사람이 나감: 쓰러진 것처럼 빠지고, 전투 중이면 남은 사람끼리 이어 간다
export function leave(S, uid) {
  const p = S.players[uid];
  if (!p || p.left) return [];
  p.left = true;
  p.ready = true;
  const ev = [{ e: "left", to: pid(p) }];
  if (!active(S).length) {
    S.phase = "done";
    S.won = false;
    return ev;
  }
  if (S.phase === "battle") {
    if (!alivePlayers(S).length) loseBattle(S, ev);
    else if (active(S).every((q) => q.ready || q.down)) ev.push(...enemyPhase(S));
  }
  return ev;
}

const enemyView = (e) => ({ id: e.id, k: e.k, name: e.name, hp: e.hp, maxHp: e.maxHp, block: e.block, stun: e.stun, dots: e.dots, intent: e.intent, boss: e.boss, rage: e.rage, def: e.def });

export function view(S, uid, online) {
  const me = S.players[uid];
  const st = STAGES[S.stage];
  return {
    run: S.run,
    stage: S.stage,
    stageName: st.name,
    theme: st.theme,
    phase: S.phase,
    room: S.room,
    rooms: st.rooms.length,
    cleared: S.cleared,
    turn: S.turn,
    left: S.phase === "battle" ? Math.max(0, S.deadline - Date.now()) : 0,
    players: S.order.map((id) => S.players[id]).map((p) => ({
      uid: p.uid, name: p.name, cls: p.cls, level: p.level, hp: p.hp, maxHp: p.maxHp, block: p.block, down: p.down, left: p.left,
      ready: p.ready, stunned: p.stunned, stun: p.stun, taunt: p.taunt, counter: p.counter, dodgeBuff: p.dodgeBuff, dots: p.dots,
      x: p.x, y: p.y, d: p.d, hand: p.hand.length, online: online ? online.has(p.uid) : true,
    })),
    enemies: S.enemies.map(enemyView),
    spirits: S.spirits.map((s) => ({ ...s })),
    me: me
      ? {
          uid: me.uid, hand: me.hand, mana: me.mana, maxMana: me.maxMana, draw: me.draw.length, disc: me.disc.length, cd: me.cd,
          usedSkill: me.usedSkill, skills: CLASSES[me.cls].skills.filter((k) => SKILLS[k].lv <= me.level), earned: me.earned,
          atk: me.atk, def: me.def, crit: me.crit, critBuff: me.critBuff, enh: me.enh,
        }
      : null,
    result: S.result ? S.result[uid] || null : null,
    won: S.won,
  };
}
