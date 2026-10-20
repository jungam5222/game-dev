// 던전 RPG 계정 데이터 (Cloudflare D1 "rpg"). 표는 처음 쓸 때 만든다.
// Worker(api.js)와 던전 Durable Object(dungeon.js)가 같이 쓴다.
import { CARDS, cardsOf, expNeed, MAX_LEVEL, heroStats, OPTS, PACK_ODDS, PACK_SIZE, BOSS_LOOT, BOSS_DAILY } from "../../rpg/shared/content.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    pw TEXT NOT NULL, salt TEXT NOT NULL, cls TEXT, level INTEGER NOT NULL DEFAULT 1, exp INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0, max_stage INTEGER NOT NULL DEFAULT 0, daily TEXT, run TEXT,
    created INTEGER NOT NULL, last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, in_deck INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS cards_user ON cards(user_id)`,
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, slot TEXT NOT NULL, tier INTEGER NOT NULL,
    enh INTEGER NOT NULL DEFAULT 0, opt TEXT, equipped INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS items_user ON items(user_id)`,
  `CREATE TABLE IF NOT EXISTS mats (user_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS login_fail (login TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS boss_daily (user_id INTEGER NOT NULL, stage INTEGER NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, stage, day))`,
];

let ready = null;
export function ensure(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => ((ready = null), Promise.reject(e)));
  return ready;
}

export const kstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
export const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const getUser = (db, id) => db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();

export async function getMats(db, uid) {
  const { results } = await db.prepare("SELECT key, n FROM mats WHERE user_id = ?").bind(uid).all();
  const m = { stone: 0, pack: 0, guard_drop: 0, guard_break: 0 };
  for (const r of results) m[r.key] = r.n;
  return m;
}

export const addMat = (db, uid, key, n) =>
  db.prepare("INSERT INTO mats (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = n + excluded.n").bind(uid, key, n);
export const addCard = (db, uid, key, inDeck = 0) => db.prepare("INSERT INTO cards (user_id, key, in_deck) VALUES (?, ?, ?)").bind(uid, key, inDeck);
export const addItem = (db, uid, slot, tier, enh = 0, opt = null, equipped = 0) =>
  db.prepare("INSERT INTO items (user_id, slot, tier, enh, opt, equipped) VALUES (?, ?, ?, ?, ?, ?)").bind(uid, slot, tier, enh, opt ? JSON.stringify(opt) : null, equipped);

// 모자라면 false. 동시에 두 번 눌러도 두 번 빠지지 않게 조건부로 뺀다.
export async function takeMat(db, uid, key, n) {
  if (n <= 0) return true;
  const r = await db.prepare("UPDATE mats SET n = n - ? WHERE user_id = ? AND key = ? AND n >= ?").bind(n, uid, key, n).run();
  return r.meta.changes === 1;
}
export async function takeGold(db, uid, n) {
  if (n <= 0) return true;
  const r = await db.prepare("UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?").bind(n, uid, n).run();
  return r.meta.changes === 1;
}

export function gainExp(level, exp, gain) {
  let ups = 0;
  exp += gain;
  while (level < MAX_LEVEL && exp >= expNeed(level)) {
    exp -= expNeed(level);
    level++;
    ups++;
  }
  // 만렙 뒤 경험치는 나중에 특성 포인트로 바꿀 수 있게 그대로 쌓아 둔다
  return { level, exp, ups };
}

export const randomCard = (cls, grade) => pick(cardsOf(cls, grade)).key;
export function packCards(cls) {
  const out = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const r = Math.random() * 100;
    const g = r < PACK_ODDS[0] ? 0 : r < PACK_ODDS[0] + PACK_ODDS[1] ? 1 : 2;
    out.push(randomCard(cls, g));
  }
  return out;
}
export function rollOpt() {
  const k = pick(Object.keys(OPTS));
  return { k, n: randInt(OPTS[k].min, OPTS[k].max) };
}

// 전투에 들고 갈 영웅: 장착 장비 능력치 + 덱
export async function loadHero(db, uid) {
  const user = await getUser(db, uid);
  if (!user || !user.cls) return null;
  const [items, deck] = await Promise.all([
    db.prepare("SELECT slot, tier, enh, opt FROM items WHERE user_id = ? AND equipped = 1").bind(uid).all(),
    db.prepare("SELECT key FROM cards WHERE user_id = ? AND in_deck = 1").bind(uid).all(),
  ]);
  return {
    uid: user.id,
    name: user.name,
    cls: user.cls,
    level: user.level,
    stats: heroStats(user.cls, user.level, items.results),
    deck: deck.results.map((r) => r.key).filter((k) => CARDS[k]),
  };
}

// 던전이 끝났을 때 보상 쓰기. 경험치·골드·강화석은 늘 주고, 보스 보상은 단계마다 하루 3번.
export async function grantRun(db, uid, { stage, won, exp, gold, stone }) {
  const user = await getUser(db, uid);
  if (!user) return null;
  const out = { exp, gold, stone, ups: 0, level: user.level, cards: [], pack: 0, gear: null, guardDrop: 0, guardBreak: 0, bossLeft: null };
  const lv = gainExp(user.level, user.exp, exp);
  out.ups = lv.ups;
  out.level = lv.level;
  const st = [];
  for (let i = 0; i < lv.ups; i++) {
    const k = randomCard(user.cls, 0);
    out.cards.push(k);
    st.push(addCard(db, uid, k));
  }
  if (won) {
    const day = kstDay();
    const row = await db.prepare("SELECT n FROM boss_daily WHERE user_id = ? AND stage = ? AND day = ?").bind(uid, stage, day).first();
    const used = row ? row.n : 0;
    if (used < BOSS_DAILY) {
      st.push(db.prepare("INSERT INTO boss_daily (user_id, stage, day, n) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, stage, day) DO UPDATE SET n = n + 1").bind(uid, stage, day));
      out.stone += BOSS_LOOT.stone * stage + randInt(0, BOSS_LOOT.stoneExtra);
      out.pack = BOSS_LOOT.pack;
      if (Math.random() * 100 < BOSS_LOOT.gear) {
        out.gear = { slot: Math.random() < 0.5 ? "weapon" : "armor", tier: Math.min(stage, 3), enh: 0, opt: rollOpt() };
        st.push(addItem(db, uid, out.gear.slot, out.gear.tier, 0, out.gear.opt));
      }
      if (Math.random() * 100 < BOSS_LOOT.guardDrop) out.guardDrop = 1;
      if (Math.random() * 100 < BOSS_LOOT.guardBreak) out.guardBreak = 1;
      out.bossLeft = BOSS_DAILY - used - 1;
    } else out.bossLeft = -1;
  }
  st.push(
    db
      .prepare("UPDATE users SET level = ?, exp = ?, gold = gold + ?, max_stage = MAX(max_stage, ?), run = NULL WHERE id = ?")
      .bind(lv.level, lv.exp, gold, won ? stage : 0, uid),
  );
  if (out.stone) st.push(addMat(db, uid, "stone", out.stone));
  if (out.pack) st.push(addMat(db, uid, "pack", out.pack));
  if (out.guardDrop) st.push(addMat(db, uid, "guard_drop", 1));
  if (out.guardBreak) st.push(addMat(db, uid, "guard_break", 1));
  await db.batch(st);
  return out;
}
