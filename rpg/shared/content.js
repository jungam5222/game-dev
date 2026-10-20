// 던전 RPG 공용 데이터: 직업, 기술, 카드, 장비, 강화, 몬스터, 단계.
// 서버(server/rpg/*)와 화면(rpg/js/*)이 같이 읽는다. 숫자를 바꾸면 양쪽에 같이 반영된다.
// 기획서: 'RPG 기획' 탭 (확률 표·강화 규칙·처음 만들 범위)

export const GRADES = ["일반", "고급", "희귀", "영웅"];
export const GRADE_COLORS = ["#aab3bf", "#5cc46a", "#4f9dff", "#c07bff"];

// 같은 효과도 등급이 높을수록 확률이 높다 (사용자 예: 회피 낮은 20 / 중간 50 / 높은 100)
export const PROB = {
  dodge: [20, 50, 75, 100],
  stun: [15, 30, 50, 80],
  crit: [10, 20, 35, 50],
  again: [10, 25, 40, 60],
  dot: [30, 50, 70, 100],
};
export const PROB_NAMES = { dodge: "회피", stun: "기절", crit: "치명타", again: "한 번 더", dot: "상태 이상" };
export const PITY_STEP = 5; // 같은 종류 확률이 실패할 때마다 다음 판정 +5%p, 성공하면 처음으로
export const BASE_CRIT = 5;
export const CRIT_MULT = 1.5;

export const SELL_PRICE = [5, 20, 60, 200];
export const PACK_SIZE = 5;
export const PACK_ODDS = [50, 42, 8]; // 카드 팩 한 장의 일반/고급/희귀 확률
export const COMBINE_MAX = 2; // 같은 등급 3장 → 위 등급 1장, 희귀까지
export const MAX_COPIES = 3; // 덱에 같은 카드 최대 장수

export const TURN = { startHand: 4, drawPerTurn: 2, handMax: 8, manaStart: 3, manaMax: 7, seconds: 30 };
export const MAX_LEVEL = 50;
export const expNeed = (lv) => 20 + 10 * (lv - 1);
export const DECK_MIN = 10;
export const deckSize = (lv) => (lv >= 30 ? 30 : lv >= 20 ? 25 : lv >= 10 ? 20 : 15);
export const PARTY_MAX = 4;
export const BOSS_DAILY = 3; // 단계마다 하루 보스 보상 횟수 (한국 날짜)
export const START_GOLD = 100;
export const ROOM_REST = 0.25; // 방을 깰 때마다 최대 체력의 25% 회복

export const CLASSES = {
  warrior: { name: "전사", hp: 60, hpPer: 6, color: "#d0503f", desc: "튼튼한 몸과 방패로 앞에서 버팁니다. 도발로 파티를 지켜요.", skills: ["taunt", "endure"] },
  mage: { name: "마법사", hp: 40, hpPer: 4, color: "#4d7fe0", desc: "몸은 약하지만 불·얼음·번개로 적 여럿을 한꺼번에 공격해요.", skills: ["focus", "flash_shield"] },
  priest: { name: "사제", hp: 48, hpPer: 5, color: "#e8c95a", desc: "공격과 회복을 함께 해서 혼자서도 잘 버티고, 수호 정령을 불러요.", skills: ["pray", "spirit_call"] },
};
export const CLASS_KEYS = Object.keys(CLASSES);

// 직업 기술: 마나 없이 쓰고, 한 턴에 하나, 쓰면 재사용 대기(턴)
export const SKILLS = {
  taunt: { name: "도발", lv: 1, cd: 2, icon: "📢", anim: "shout", fx: [{ t: "taunt" }, { t: "block", n: 4 }] },
  endure: { name: "버티기", lv: 10, cd: 3, icon: "🪨", anim: "shield", fx: [{ t: "block", n: 12 }] },
  focus: { name: "마나 집중", lv: 1, cd: 3, icon: "💠", anim: "mana", fx: [{ t: "mana", n: 2 }] },
  flash_shield: { name: "순간 보호막", lv: 10, cd: 3, icon: "🔷", anim: "shield", fx: [{ t: "block", n: 6, to: "party" }] },
  pray: { name: "기도", lv: 1, cd: 2, icon: "🙏", anim: "heal", fx: [{ t: "heal", n: 5, to: "all" }] },
  spirit_call: { name: "정령 부르기", lv: 10, cd: 4, icon: "👻", anim: "spirit", fx: [{ t: "spirit", hp: 12, atk: 3 }] },
};

// 카드. fx 효과 종류:
//   dmg {min,max,to:one|all,hits,crit}  block {n,to:self|party}  heal {n,to:self|low|all}  drain {min,max}
//   dodge  stun {to}  dot {kind:burn|poison,n,turns,to}  again  counter {n}  taunt  mana {n}
//   spirit {hp,atk}  draw {n}  crit  cleanse
// 확률 효과(dodge, stun, dot, again, crit)는 p가 없으면 등급 표(PROB)를 따른다.
// anim은 화면 연출 이름 (rpg/js/draw.js)
const C = (cls, grade, key, name, cost, icon, anim, fx) => ({ key, cls, grade, name, cost, icon, anim, fx });
export const CARD_LIST = [
  // 전사
  C("warrior", 0, "w_strike", "강타", 2, "🔨", "slash", [{ t: "dmg", min: 6, max: 9 }]),
  C("warrior", 0, "w_shield", "방패 올리기", 1, "🛡️", "shield", [{ t: "block", n: 6 }]),
  C("warrior", 0, "w_sidestep", "옆걸음", 0, "💨", "dodge", [{ t: "dodge" }]),
  C("warrior", 0, "w_charge", "돌진", 1, "🐂", "charge", [{ t: "dmg", min: 3, max: 5 }, { t: "stun" }]),
  C("warrior", 0, "w_riposte", "반격 자세", 2, "↩️", "shield", [{ t: "block", n: 3 }, { t: "counter", n: 5 }]),
  C("warrior", 1, "w_roll", "구르기", 1, "🌀", "dodge", [{ t: "dodge" }, { t: "block", n: 3 }]),
  C("warrior", 1, "w_sweep", "휩쓸기", 2, "🌪️", "sweep", [{ t: "dmg", min: 4, max: 6, to: "all" }]),
  C("warrior", 1, "w_bash", "방패 강타", 2, "🥊", "smash", [{ t: "block", n: 5 }, { t: "dmg", min: 4, max: 6 }, { t: "stun" }]),
  C("warrior", 1, "w_iron", "철벽", 2, "🧱", "shield", [{ t: "block", n: 14 }]),
  C("warrior", 1, "w_shout", "함성", 1, "📣", "shout", [{ t: "taunt" }, { t: "block", n: 5 }, { t: "crit", p: 20 }]),
  C("warrior", 2, "w_earth", "대지 가르기", 3, "⛰️", "quake", [{ t: "dmg", min: 8, max: 12, to: "all" }, { t: "stun", to: "all" }]),
  C("warrior", 2, "w_fury", "분노의 일격", 3, "🔥", "smash", [{ t: "dmg", min: 14, max: 20, crit: true }]),
  C("warrior", 2, "w_unyield", "불굴", 2, "🦁", "shield", [{ t: "block", n: 15 }, { t: "heal", n: 8 }]),
  C("warrior", 2, "w_whirl", "회오리 베기", 3, "🌀", "sweep", [{ t: "dmg", min: 5, max: 7, to: "all" }, { t: "again" }]),
  // 마법사
  C("mage", 0, "m_fireball", "화염구", 2, "🔥", "fire", [{ t: "dmg", min: 6, max: 9 }, { t: "dot", kind: "burn", n: 2, turns: 2 }]),
  C("mage", 0, "m_icebolt", "얼음 화살", 1, "❄️", "ice", [{ t: "dmg", min: 3, max: 5 }, { t: "stun" }]),
  C("mage", 0, "m_arcane", "비전 화살", 1, "✨", "arcane", [{ t: "dmg", min: 4, max: 6 }, { t: "again" }]),
  C("mage", 0, "m_barrier", "마법 방벽", 1, "🔮", "shield", [{ t: "block", n: 6 }]),
  C("mage", 0, "m_bolt", "번개", 2, "⚡", "bolt", [{ t: "dmg", min: 5, max: 10, crit: true }]),
  C("mage", 1, "m_chain", "연쇄 번개", 3, "🌩️", "bolt", [{ t: "dmg", min: 5, max: 8, to: "all" }]),
  C("mage", 1, "m_frostring", "서리 고리", 2, "💠", "ice", [{ t: "dmg", min: 3, max: 5, to: "all" }, { t: "stun", to: "all" }]),
  C("mage", 1, "m_blink", "점멸", 0, "🌟", "dodge", [{ t: "dodge" }, { t: "draw", n: 1 }]),
  C("mage", 1, "m_blast", "불꽃 폭발", 2, "💥", "fire", [{ t: "dmg", min: 7, max: 11 }, { t: "dot", kind: "burn", n: 3, turns: 2 }]),
  C("mage", 1, "m_manashield", "마나 보호막", 1, "🔷", "shield", [{ t: "block", n: 8 }, { t: "mana", n: 1 }]),
  C("mage", 2, "m_meteor", "메테오", 4, "☄️", "meteor", [{ t: "dmg", min: 12, max: 18, to: "all" }, { t: "dot", kind: "burn", n: 3, turns: 2, to: "all" }]),
  C("mage", 2, "m_prison", "얼음 감옥", 3, "🧊", "ice", [{ t: "dmg", min: 5, max: 8, to: "all" }, { t: "stun", to: "all" }]),
  C("mage", 2, "m_storm", "비전 폭풍", 3, "🌌", "arcane", [{ t: "dmg", min: 3, max: 5, hits: 4 }]),
  C("mage", 2, "m_timewarp", "시간 비틀기", 2, "⏳", "mana", [{ t: "mana", n: 3 }, { t: "draw", n: 2 }]),
  // 사제
  C("priest", 0, "p_smite", "신성한 일격", 1, "✝️", "holy", [{ t: "dmg", min: 4, max: 6 }]),
  C("priest", 0, "p_heal", "치유", 1, "💚", "heal", [{ t: "heal", n: 8, to: "low" }]),
  C("priest", 0, "p_prayer", "보호의 기도", 1, "🙏", "shield", [{ t: "block", n: 4, to: "party" }]),
  C("priest", 0, "p_purify", "정화의 빛", 2, "☀️", "holy", [{ t: "dmg", min: 4, max: 6 }, { t: "heal", n: 4, to: "all" }, { t: "cleanse" }]),
  C("priest", 0, "p_spirit", "수호 정령", 2, "👻", "spirit", [{ t: "spirit", hp: 8, atk: 2 }]),
  C("priest", 1, "p_healray", "치유의 빛", 2, "💖", "heal", [{ t: "heal", n: 8, to: "all" }]),
  C("priest", 1, "p_hammer", "빛의 망치", 2, "🔨", "holy", [{ t: "dmg", min: 6, max: 9 }, { t: "stun" }]),
  C("priest", 1, "p_grace", "신의 가호", 2, "🕊️", "shield", [{ t: "block", n: 8, to: "party" }]),
  C("priest", 1, "p_bigspirit", "큰 수호 정령", 3, "👼", "spirit", [{ t: "spirit", hp: 16, atk: 4 }]),
  C("priest", 1, "p_holyfire", "성스러운 불", 2, "🕯️", "fire", [{ t: "dmg", min: 3, max: 5, to: "all" }, { t: "dot", kind: "burn", n: 2, turns: 2, to: "all" }]),
  C("priest", 2, "p_judge", "심판", 3, "⚖️", "holy", [{ t: "drain", min: 12, max: 16 }]),
  C("priest", 2, "p_sanct", "성역", 3, "⛪", "shield", [{ t: "block", n: 10, to: "party" }, { t: "heal", n: 6, to: "all" }]),
  C("priest", 2, "p_wrath", "천벌", 4, "🌩️", "holy", [{ t: "dmg", min: 8, max: 12, to: "all" }, { t: "stun", to: "all" }]),
  C("priest", 2, "p_miracle", "기적", 3, "🌈", "heal", [{ t: "heal", n: 20, to: "all" }, { t: "cleanse" }]),
];
export const CARDS = Object.fromEntries(CARD_LIST.map((c) => [c.key, c]));
export const cardsOf = (cls, grade) => CARD_LIST.filter((c) => c.cls === cls && (grade === undefined || c.grade === grade));
// 처음 받는 덱: 직업 일반 카드 5종 × 3장 = 15장
export const startDeck = (cls) => cardsOf(cls, 0).flatMap((c) => [c.key, c.key, c.key]);

export const prob = (fx, kind, grade) => (fx.p != null ? fx.p : PROB[kind][Math.min(grade, 3)]);

// 카드·기술 설명 글
export function fxText(fx, grade = 0) {
  const out = [];
  for (const f of fx) {
    const all = f.to === "all";
    if (f.t === "dmg") {
      let s = f.hits ? `무작위 적에게 ${f.min}~${f.max} 피해 ${f.hits}번` : `${all ? "적 전체에게 " : ""}${f.min}~${f.max} 피해`;
      if (f.crit) s += ` (치명타 확률 +${prob({}, "crit", grade)}%)`;
      out.push(s);
    } else if (f.t === "block") out.push(f.to === "party" ? `파티 전체 방어 ${f.n}` : `방어 ${f.n}`);
    else if (f.t === "heal") out.push(f.to === "all" ? `파티 전체 체력 ${f.n} 회복` : f.to === "low" ? `체력이 가장 낮은 아군 ${f.n} 회복` : `체력 ${f.n} 회복`);
    else if (f.t === "drain") out.push(`${f.min}~${f.max} 피해, 준 만큼 체력 회복`);
    else if (f.t === "dodge") out.push(`${prob(f, "dodge", grade)}% 확률로 다음 공격 피하기`);
    else if (f.t === "stun") out.push(`${all ? "맞은 적마다 " : ""}${prob(f, "stun", grade)}% 확률로 기절`);
    else if (f.t === "dot") out.push(`${all ? "맞은 적마다 " : ""}${prob(f, "dot", grade)}% 확률로 ${f.kind === "burn" ? "화상" : "독"}(턴마다 ${f.n}, ${f.turns}턴)`);
    else if (f.t === "again") out.push(`${prob(f, "again", grade)}% 확률로 한 번 더`);
    else if (f.t === "counter") out.push(`이번 턴에 맞으면 ${f.n} 되갚기`);
    else if (f.t === "taunt") out.push("적의 공격을 나에게 끌어오기");
    else if (f.t === "mana") out.push(`마나 +${f.n}`);
    else if (f.t === "spirit") out.push(`수호 정령 부르기 (체력 ${f.hp}, 공격 ${f.atk})`);
    else if (f.t === "draw") out.push(`카드 ${f.n}장 뽑기`);
    else if (f.t === "crit") out.push(`이번 턴 치명타 확률 +${prob(f, "crit", grade)}%`);
    else if (f.t === "cleanse") out.push("파티의 독·화상·기절 없애기");
  }
  return out.join(", ");
}
export const cardText = (c) => fxText(c.fx, c.grade);
export const skillText = (s) => fxText(s.fx, 1);
export const needsTarget = (fx) => fx.some((f) => (f.t === "dmg" && f.to !== "all" && !f.hits) || f.t === "drain" || (f.t === "stun" && f.to !== "all") || (f.t === "dot" && f.to !== "all"));

// 장비: 무기·방어구 두 칸. 단계 보스를 잡으면 그 단계 장비가 나온다.
export const ITEM_TIERS = [
  { name: "낡은", atk: 2, hp: 8, def: 0 },
  { name: "고블린 대장의", atk: 3, hp: 14, def: 1 },
  { name: "골렘의", atk: 4, hp: 20, def: 1 },
  { name: "늑대 왕의", atk: 5, hp: 26, def: 2 },
];
export const SLOT_NAMES = {
  weapon: { warrior: "검", mage: "지팡이", priest: "홀" },
  armor: { warrior: "갑옷", mage: "로브", priest: "법의" },
};
// 무작위 옵션 (보스 장비에 하나)
export const OPTS = {
  crit: { min: 2, max: 4, text: (n) => `치명타 +${n}%` },
  dodge: { min: 1, max: 3, text: (n) => `회피 +${n}%` },
  hp: { min: 3, max: 6, text: (n) => `체력 +${n}` },
  atk: { min: 1, max: 1, text: (n) => `공격 +${n}` },
};
export const itemName = (it, cls) => `${ITEM_TIERS[it.tier].name} ${SLOT_NAMES[it.slot][cls] || (it.slot === "weapon" ? "무기" : "방어구")}${it.enh ? ` +${it.enh}` : ""}`;
export function itemStats(it, enh = it.enh) {
  const b = ITEM_TIERS[it.tier];
  const s = { atk: 0, hp: 0, def: 0, crit: 0, dodge: 0 };
  if (it.slot === "weapon") s.atk = Math.round(b.atk * (1 + 0.12 * enh)) + enh;
  else {
    s.hp = Math.round(b.hp * (1 + 0.1 * enh)) + 2 * enh;
    s.def = b.def + Math.floor(enh / 3);
  }
  const o = it.opt && (typeof it.opt === "string" ? JSON.parse(it.opt) : it.opt);
  if (o && OPTS[o.k]) s[o.k] += o.n;
  return s;
}
export const itemSellPrice = (it) => 10 * (it.tier + 1) + 5 * it.enh;

// 영웅 능력치 = 직업 + 레벨 + 장착 장비
export function heroStats(cls, level, items) {
  const c = CLASSES[cls];
  const s = { maxHp: c.hp + c.hpPer * (level - 1), atk: 0, def: 0, crit: BASE_CRIT, dodge: 0, enh: 0 };
  for (const it of items) {
    const x = itemStats(it);
    s.maxHp += x.hp;
    s.atk += x.atk;
    s.def += x.def;
    s.crit += x.crit;
    s.dodge += x.dodge;
    if (it.slot === "weapon") s.enh = it.enh;
  }
  return s;
}

// 강화 +0~+15. 실패하면: +1~5 재료만 잃음, +6~10 한 단계 하락, +11~13 한 단계(30%는 두 단계) 하락,
// +14~15 두 단계 하락 + 실패 중 3%는 파괴. 하락 방지 주문서는 하락을 막고, 파괴 방지 주문서는 파괴를 두 단계 하락으로 바꾼다.
export const ENH_MAX = 15;
export const ENH_RATE = [null, 100, 95, 90, 85, 80, 70, 65, 60, 50, 45, 40, 35, 30, 25, 15];
export const ENH_PITY = 2; // 연속 실패마다 +2%p
export const ENH_DROP2 = 30;
export const ENH_BREAK = 3;
export const enhCost = (t) => ({ gold: 10 * t + 3 * t * t, stone: 1 + Math.floor(t / 3) });
export const enhChance = (t, fails) => Math.min(100, ENH_RATE[t] + fails * ENH_PITY);
export function enhFailText(t) {
  if (t <= 5) return "실패해도 재료만 잃어요.";
  if (t <= 10) return "실패하면 한 단계 내려가요.";
  if (t <= 13) return `실패하면 한 단계 내려가고, 실패의 ${ENH_DROP2}%는 두 단계 내려가요.`;
  return `실패하면 두 단계 내려가고, 실패의 ${ENH_BREAK}%는 장비가 부서져요.`;
}
// rand(): 0 이상 100 미만
export function enhRoll(enh, fails, guards, rand) {
  const t = enh + 1;
  const res = { ok: false, outcome: "keep", enh, usedDrop: false, usedBreak: false };
  if (rand() < enhChance(t, fails)) return { ...res, ok: true, outcome: "success", enh: t };
  let drop = 0;
  if (t >= 14) {
    drop = 2;
    if (rand() < ENH_BREAK) {
      if (!guards.breakGuard) return { ...res, outcome: "destroy", enh: -1 };
      res.usedBreak = true;
    }
  } else if (t >= 11) drop = rand() < ENH_DROP2 ? 2 : 1;
  else if (t >= 6) drop = 1;
  if (drop && guards.dropGuard) {
    res.usedDrop = true;
    drop = 0;
  }
  return { ...res, outcome: drop ? `drop${drop}` : "keep", enh: enh - drop };
}

// 몬스터. moves = [행동, 가중치]
export const MONSTERS = {
  slime: { name: "슬라임", hp: 14, atk: [2, 4], def: 0, moves: [["attack", 3], ["block", 1]] },
  goblin: { name: "고블린", hp: 16, atk: [3, 6], def: 0, moves: [["attack", 3], ["heavy", 1]] },
  goblin_chief: { name: "고블린 대장", boss: true, hp: 60, atk: [5, 8], def: 0, moves: [["attack", 3], ["heavy", 2], ["enrage", 1], ["block", 1]] },
  bat: { name: "박쥐", hp: 10, atk: [2, 4], def: 0, moves: [["attack", 2], ["drain", 1]] },
  skeleton: { name: "해골 병사", hp: 22, atk: [4, 6], def: 1, moves: [["attack", 3], ["block", 1]] },
  golem: { name: "광산의 골렘", boss: true, hp: 105, atk: [7, 10], def: 1, moves: [["attack", 3], ["heavy", 2], ["quake", 1], ["block", 1]] },
  wolf: { name: "늑대", hp: 22, atk: [4, 7], def: 0, moves: [["attack", 3], ["poison", 1]] },
  spider: { name: "거미", hp: 18, atk: [3, 5], def: 0, moves: [["attack", 2], ["web", 1], ["poison", 1]] },
  wolf_king: { name: "늑대 왕", boss: true, hp: 150, atk: [8, 12], def: 1, moves: [["attack", 3], ["heavy", 2], ["howl", 1], ["summon", 1], ["enrage", 1]] },
};
export const MOVES = {
  attack: { name: "공격", icon: "🗡️" },
  heavy: { name: "강한 공격", icon: "💥", x: 1.6 },
  howl: { name: "울부짖기", icon: "🌀", x: 0.6, all: true },
  quake: { name: "지진", icon: "🪨", x: 0.7, all: true, stun: 20 },
  block: { name: "방어", icon: "🛡️" },
  enrage: { name: "분노", icon: "😡", n: 2 },
  drain: { name: "흡혈", icon: "🩸" },
  poison: { name: "독 물기", icon: "🧪", x: 0.6, dot: { kind: "poison", n: 2, turns: 3 } },
  web: { name: "거미줄", icon: "🕸️", x: 0.4, stun: 35 },
  summon: { name: "부르기", icon: "📯" },
};

export const STAGES = [
  null,
  { n: 1, name: "고블린 굴", theme: "cave", level: 5, boss: "goblin_chief", rooms: [["slime", "slime"], ["goblin", "slime"], ["goblin_chief"]], exp: [6, 30], gold: [3, 40] },
  { n: 2, name: "버려진 광산", theme: "mine", level: 10, boss: "golem", rooms: [["bat", "bat", "bat"], ["skeleton", "bat"], ["golem"]], exp: [12, 60], gold: [6, 80] },
  { n: 3, name: "늑대 소굴", theme: "forest", level: 15, boss: "wolf_king", rooms: [["wolf", "wolf"], ["spider", "wolf"], ["wolf_king", "wolf"]], exp: [18, 90], gold: [9, 120] },
];
export const STAGE_COUNT = STAGES.length - 1;
export const partyScale = (n) => ({ hp: 1 + 0.7 * (n - 1), atk: 1 + 0.1 * (n - 1) });
// 보스 보상 (하루 3번): 강화석 단계×2+0~2, 카드 팩 1, 장비 40%, 하락 방지 12%, 파괴 방지 5%
export const BOSS_LOOT = { stone: 2, stoneExtra: 2, pack: 1, gear: 40, guardDrop: 12, guardBreak: 5 };
export const MATS = {
  stone: { name: "강화석", icon: "💎" },
  pack: { name: "카드 팩", icon: "🎴" },
  guard_drop: { name: "하락 방지 주문서", icon: "📜" },
  guard_break: { name: "파괴 방지 주문서", icon: "🧿" },
};
