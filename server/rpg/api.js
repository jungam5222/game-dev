// 던전 RPG 계정·가방·강화 API (/api/rpg/*). worker.js가 여기로 넘긴다.
// 가입 = 이름(실명)·아이디·비밀번호, 로그인 = 아이디·비밀번호, 게임 안에서는 이름으로 보인다 (2026-10-20 사용자).
// 비밀번호 찾기 메일은 없다. 관리자(env.RPG_ADMIN 아이디)가 관리자 화면에서 임시 비밀번호로 바꿔 준다.
// 카드는 골드로 살 수 없고 상점에 팔기만 한다. 골드는 강화에 쓴다.
import {
  CARDS, CLASSES, startDeck, expNeed, deckSize, DECK_MIN, MAX_COPIES, SELL_PRICE, COMBINE_MAX, START_GOLD,
  ENH_MAX, enhCost, enhRoll, itemName, itemSellPrice, STAGE_COUNT,
} from "../../rpg/shared/content.js";
import { ensure, kstDay, getUser, getMats, addMat, addCard, addItem, takeMat, takeGold, randomCard, packCards } from "./db.js";

const COOKIE = "rpg_s";
const SESSION_DAYS = 30;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(enc.encode(a), enc.encode(b));
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (msg, status = 400) => json({ error: msg }, status);

function cookieOf(request) {
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)rpg_s=([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
const setCookie = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

async function newSession(db, uid) {
  const token = randHex(32);
  await db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)").bind(await sha(token), uid, Date.now() + SESSION_DAYS * 86400e3).run();
  return token;
}

export async function sessionUser(request, env) {
  const token = cookieOf(request);
  if (!token) return null;
  const db = env.RPG_DB;
  const row = await db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?")
    .bind(await sha(token), Date.now())
    .first();
  if (row && (!row.last_seen || Date.now() - row.last_seen > 5 * 60e3)) {
    await db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(Date.now(), row.id).run();
  }
  return row;
}

const isAdmin = (u, env) => !!u && !!env.RPG_ADMIN && u.login === String(env.RPG_ADMIN).toLowerCase();

export const publicUser = (u) => ({
  id: u.id, name: u.name, login: u.login, cls: u.cls, level: u.level, exp: u.exp, need: expNeed(u.level),
  gold: u.gold, maxStage: u.max_stage, run: u.run,
});

const NAME = /^[가-힣a-zA-Z]+( [가-힣a-zA-Z]+)*$/;
const LOGIN = /^[a-z0-9_]{4,16}$/;
const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ");
const pwOk = (s) => typeof s === "string" && s.length >= 6 && s.length <= 64;

async function ipKey(request) {
  return (await sha("rpg:" + (request.headers.get("cf-connecting-ip") || ""))).slice(0, 16);
}

// 여러 번 실패하면 잠깐 막는다 (로그인은 아이디마다 10번 → 10분, 가입은 같은 곳(IP)에서 하루 8번)
async function lockedOut(db, key) {
  const r = await db.prepare("SELECT n, until FROM login_fail WHERE login = ?").bind(key).first();
  return r && r.until > Date.now();
}
async function countFail(db, key, limit, ms) {
  const r = await db.prepare("SELECT n, until FROM login_fail WHERE login = ?").bind(key).first();
  const now = Date.now();
  let n = r && r.until > now - ms ? r.n + 1 : 1;
  let until = now;
  if (n >= limit) {
    until = now + ms;
    n = 0;
  }
  await db.prepare("INSERT INTO login_fail (login, n, until) VALUES (?, ?, ?) ON CONFLICT(login) DO UPDATE SET n = excluded.n, until = excluded.until").bind(key, n, until).run();
}

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? b : {};
  } catch (e) {
    return {};
  }
}
const ids = (v, max = 40) => (Array.isArray(v) && v.length <= max && v.every((x) => Number.isInteger(x) && x > 0) ? [...new Set(v)] : null);
const qs = (n) => Array(n).fill("?").join(",");

async function bossToday(db, uid) {
  const { results } = await db.prepare("SELECT stage, n FROM boss_daily WHERE user_id = ? AND day = ?").bind(uid, kstDay()).all();
  const out = {};
  for (let s = 1; s <= STAGE_COUNT; s++) out[s] = 0;
  for (const r of results) out[r.stage] = r.n;
  return out;
}

async function announce(env, text) {
  try {
    await env.RPG_TOWN.get(env.RPG_TOWN.idFromName("town")).fetch("https://town/announce", { method: "POST", body: JSON.stringify({ text }) });
  } catch (e) {}
}

function forwardWs(request, stub, path, extra) {
  const h = new Headers(request.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, encodeURIComponent(String(v)));
  return stub.fetch("https://do" + path, { headers: h });
}

export async function rpgApi(request, env, url) {
  if (!env.RPG_DB) return fail("no_db", 500);
  const db = env.RPG_DB;
  await ensure(db);
  const path = url.pathname.slice("/api/rpg/".length);
  const method = request.method;

  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return fail("origin", 403);
  }

  // 로그인 없이 되는 것
  if (path === "signup" && method === "POST") {
    const b = await readBody(request);
    const name = cleanName(b.name);
    const login = String(b.login || "").trim().toLowerCase();
    if (name.length < 2 || name.length > 12 || !NAME.test(name)) return fail("이름은 한글이나 영문 2~12자로 적어 주세요.");
    if (!LOGIN.test(login)) return fail("아이디는 영문 소문자·숫자·_ 4~16자로 적어 주세요.");
    if (!pwOk(b.password)) return fail("비밀번호는 6~64자로 적어 주세요.");
    const ipk = "signup:" + (await ipKey(request));
    if (await lockedOut(db, ipk)) return fail("같은 곳에서 가입을 너무 많이 했어요. 내일 다시 해 주세요.", 429);
    if (await db.prepare("SELECT 1 FROM users WHERE login = ?").bind(login).first()) return fail("이미 있는 아이디예요.");
    const salt = randHex(16);
    const pw = await hashPw(b.password, salt);
    let r;
    try {
      r = await db
        .prepare("INSERT INTO users (login, name, pw, salt, gold, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(login, name, pw, salt, START_GOLD, Date.now(), Date.now())
        .first();
    } catch (e) {
      return fail("이미 있는 아이디예요.");
    }
    await countFail(db, ipk, 8, 86400e3);
    const token = await newSession(db, r.id);
    return json({ ok: true }, 200, { "set-cookie": setCookie(token) });
  }
  if (path === "login" && method === "POST") {
    const b = await readBody(request);
    const login = String(b.login || "").trim().toLowerCase();
    if (!LOGIN.test(login) || typeof b.password !== "string") return fail("아이디나 비밀번호가 맞지 않아요.");
    const key = "login:" + login;
    if (await lockedOut(db, key)) return fail("비밀번호를 여러 번 틀려서 10분 동안 막혔어요.", 429);
    const u = await db.prepare("SELECT * FROM users WHERE login = ?").bind(login).first();
    if (!u || !sameHex(await hashPw(b.password, u.salt), u.pw)) {
      await countFail(db, key, 10, 10 * 60e3);
      return fail("아이디나 비밀번호가 맞지 않아요.");
    }
    await db.prepare("DELETE FROM login_fail WHERE login = ?").bind(key).run();
    await db.prepare("DELETE FROM sessions WHERE expires < ?").bind(Date.now()).run();
    const token = await newSession(db, u.id);
    return json({ ok: true }, 200, { "set-cookie": setCookie(token) });
  }

  const u = await sessionUser(request, env);
  if (!u) return fail("login", 401);
  const uid = u.id;

  if (path === "logout" && method === "POST") {
    const token = cookieOf(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }
  if (path === "me" && method === "GET") {
    let daily = false;
    const today = kstDay();
    if (u.cls && u.daily !== today) {
      const r = await db.prepare("UPDATE users SET daily = ? WHERE id = ? AND (daily IS NULL OR daily != ?)").bind(today, uid, today).run();
      if (r.meta.changes === 1) {
        await addMat(db, uid, "pack", 1).run();
        daily = true;
      }
    }
    return json({ user: publicUser(u), admin: isAdmin(u, env), mats: await getMats(db, uid), bossToday: await bossToday(db, uid), daily });
  }
  if (path === "class" && method === "POST") {
    const b = await readBody(request);
    if (!CLASSES[b.cls]) return fail("직업을 골라 주세요.");
    const r = await db.prepare("UPDATE users SET cls = ?, daily = ? WHERE id = ? AND cls IS NULL").bind(b.cls, kstDay(), uid).run();
    if (r.meta.changes !== 1) return fail("이미 직업을 골랐어요.");
    await db.batch([
      ...startDeck(b.cls).map((k) => addCard(db, uid, k, 1)),
      addItem(db, uid, "weapon", 0, 0, null, 1),
      addItem(db, uid, "armor", 0, 0, null, 1),
      addMat(db, uid, "pack", 1),
      addMat(db, uid, "stone", 3),
    ]);
    return json({ ok: true });
  }
  if (path === "password" && method === "POST") {
    const b = await readBody(request);
    if (typeof b.old !== "string" || !sameHex(await hashPw(b.old, u.salt), u.pw)) return fail("지금 비밀번호가 맞지 않아요.");
    if (!pwOk(b.password)) return fail("새 비밀번호는 6~64자로 적어 주세요.");
    const salt = randHex(16);
    await db.prepare("UPDATE users SET pw = ?, salt = ? WHERE id = ?").bind(await hashPw(b.password, salt), salt, uid).run();
    return json({ ok: true });
  }

  if (path.startsWith("admin/")) {
    if (!isAdmin(u, env)) return fail("관리자만 쓸 수 있어요.", 403);
    const what = path.slice(6);
    if (what === "users" && method === "GET") {
      const { results } = await db.prepare("SELECT id, login, name, cls, level, gold, max_stage, created, last_seen FROM users ORDER BY id").all();
      return json({ users: results });
    }
    if (method !== "POST") return fail("not_found", 404);
    const b = await readBody(request);
    const target = Number.isInteger(b.id) ? await getUser(db, b.id) : null;
    if (!target) return fail("없는 사람이에요.");
    if (what === "reset") {
      const temp = randHex(4);
      const salt = randHex(16);
      await db.batch([
        db.prepare("UPDATE users SET pw = ?, salt = ? WHERE id = ?").bind(await hashPw(temp, salt), salt, target.id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
        db.prepare("DELETE FROM login_fail WHERE login = ?").bind("login:" + target.login),
      ]);
      return json({ ok: true, temp });
    }
    if (what === "delete") {
      if (target.id === uid) return fail("내 계정은 지울 수 없어요.");
      await db.batch(
        ["users WHERE id", "sessions WHERE user_id", "cards WHERE user_id", "items WHERE user_id", "mats WHERE user_id", "boss_daily WHERE user_id"].map((t) =>
          db.prepare(`DELETE FROM ${t} = ?`).bind(target.id),
        ),
      );
      return json({ ok: true });
    }
    if (what === "grant") {
      const st = [];
      const n = (v) => (Number.isInteger(v) && v > 0 && v <= 100000 ? v : 0);
      if (n(b.gold)) st.push(db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").bind(n(b.gold), target.id));
      for (const k of ["stone", "pack", "guard_drop", "guard_break"]) if (n(b[k])) st.push(addMat(db, target.id, k, n(b[k])));
      if (!st.length) return fail("줄 것을 적어 주세요.");
      await db.batch(st);
      return json({ ok: true });
    }
    return fail("not_found", 404);
  }

  // 여기부터는 직업을 고른 뒤에만
  if (!u.cls) return fail("직업을 먼저 골라 주세요.");

  if (path === "town/ws") {
    if (request.headers.get("upgrade") !== "websocket") return fail("websocket", 426);
    return forwardWs(request, env.RPG_TOWN.get(env.RPG_TOWN.idFromName("town")), "/ws", { "x-uid": uid, "x-name": u.name, "x-cls": u.cls, "x-level": u.level, "x-max": u.max_stage });
  }
  if (path === "dungeon/ws") {
    if (request.headers.get("upgrade") !== "websocket") return fail("websocket", 426);
    const run = url.searchParams.get("run") || "";
    if (!u.run || u.run !== run) return fail("gone", 410);
    return forwardWs(request, env.RPG_DUNGEON.get(env.RPG_DUNGEON.idFromName(run)), "/ws", { "x-uid": uid });
  }
  if (path === "run/leave" && method === "POST") {
    if (u.run) {
      try {
        await env.RPG_DUNGEON.get(env.RPG_DUNGEON.idFromName(u.run)).fetch("https://do/leave", { method: "POST", body: JSON.stringify({ uid }) });
      } catch (e) {}
      await db.prepare("UPDATE users SET run = NULL WHERE id = ?").bind(uid).run();
    }
    return json({ ok: true });
  }

  if (path === "inventory" && method === "GET") {
    const [cards, items] = await Promise.all([
      db.prepare("SELECT id, key, in_deck FROM cards WHERE user_id = ? ORDER BY id").bind(uid).all(),
      db.prepare("SELECT id, slot, tier, enh, opt, equipped, fails FROM items WHERE user_id = ? ORDER BY id").bind(uid).all(),
    ]);
    return json({
      user: publicUser(u),
      cards: cards.results.filter((c) => CARDS[c.key]),
      items: items.results.map((it) => ({ ...it, opt: it.opt ? JSON.parse(it.opt) : null })),
      mats: await getMats(db, uid),
    });
  }
  if (method !== "POST") return fail("not_found", 404);
  const b = await readBody(request);

  if (path === "deck") {
    const list = ids(b.ids, 40);
    if (!list) return fail("카드를 다시 골라 주세요.");
    const max = deckSize(u.level);
    if (list.length < DECK_MIN || list.length > max) return fail(`덱은 ${DECK_MIN}~${max}장이어야 해요.`);
    const { results } = await db.prepare(`SELECT id, key FROM cards WHERE user_id = ? AND id IN (${qs(list.length)})`).bind(uid, ...list).all();
    if (results.length !== list.length) return fail("가지고 있지 않은 카드가 있어요.");
    const count = {};
    for (const c of results) if ((count[c.key] = (count[c.key] || 0) + 1) > MAX_COPIES) return fail(`같은 카드는 ${MAX_COPIES}장까지 넣을 수 있어요.`);
    await db.batch([
      db.prepare("UPDATE cards SET in_deck = 0 WHERE user_id = ?").bind(uid),
      db.prepare(`UPDATE cards SET in_deck = 1 WHERE user_id = ? AND id IN (${qs(list.length)})`).bind(uid, ...list),
    ]);
    return json({ ok: true });
  }
  if (path === "combine") {
    const list = ids(b.ids, 3);
    if (!list || list.length !== 3) return fail("같은 등급 카드 3장을 골라 주세요.");
    const { results } = await db.prepare(`SELECT id, key FROM cards WHERE user_id = ? AND in_deck = 0 AND id IN (${qs(3)})`).bind(uid, ...list).all();
    if (results.length !== 3) return fail("덱에 없는 내 카드 3장을 골라 주세요.");
    const g = CARDS[results[0].key].grade;
    if (!results.every((c) => CARDS[c.key].grade === g)) return fail("같은 등급 카드 3장이어야 해요.");
    if (g >= COMBINE_MAX) return fail("희귀 카드는 더 합성할 수 없어요.");
    const del = await db.prepare(`DELETE FROM cards WHERE user_id = ? AND in_deck = 0 AND id IN (${qs(3)}) RETURNING key`).bind(uid, ...list).all();
    if (del.results.length !== 3) {
      if (del.results.length) await db.batch(del.results.map((c) => addCard(db, uid, c.key)));
      return fail("다시 해 주세요.");
    }
    const key = randomCard(u.cls, g + 1);
    const r = await addCard(db, uid, key).run();
    return json({ ok: true, card: { id: r.meta.last_row_id, key, in_deck: 0 } });
  }
  if (path === "sell") {
    const list = ids(b.ids, 100);
    if (!list || !list.length) return fail("팔 카드를 골라 주세요.");
    const del = await db.prepare(`DELETE FROM cards WHERE user_id = ? AND in_deck = 0 AND id IN (${qs(list.length)}) RETURNING key`).bind(uid, ...list).all();
    const gold = del.results.reduce((s, c) => s + (CARDS[c.key] ? SELL_PRICE[CARDS[c.key].grade] : 0), 0);
    if (gold) await db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").bind(gold, uid).run();
    return json({ ok: true, sold: del.results.length, gold });
  }
  if (path === "pack") {
    if (!(await takeMat(db, uid, "pack", 1))) return fail("카드 팩이 없어요.");
    const keys = packCards(u.cls);
    const rows = await db.batch(keys.map((k) => addCard(db, uid, k)));
    return json({ ok: true, cards: keys.map((key, i) => ({ id: rows[i].meta.last_row_id, key, in_deck: 0 })) });
  }

  const item = Number.isInteger(b.id) ? await db.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").bind(b.id, uid).first() : null;
  if (["equip", "enhance", "sellitem"].includes(path) && !item) return fail("없는 장비예요.");
  if (path === "equip") {
    await db.batch([
      db.prepare("UPDATE items SET equipped = 0 WHERE user_id = ? AND slot = ?").bind(uid, item.slot),
      db.prepare("UPDATE items SET equipped = 1 WHERE id = ? AND user_id = ?").bind(item.id, uid),
    ]);
    return json({ ok: true });
  }
  if (path === "sellitem") {
    if (item.equipped) return fail("끼고 있는 장비는 팔 수 없어요.");
    const del = await db.prepare("DELETE FROM items WHERE id = ? AND user_id = ? AND equipped = 0 RETURNING id").bind(item.id, uid).all();
    if (!del.results.length) return fail("다시 해 주세요.");
    const gold = itemSellPrice(item);
    await db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").bind(gold, uid).run();
    return json({ ok: true, gold });
  }
  if (path === "enhance") {
    if (item.enh >= ENH_MAX) return fail(`+${ENH_MAX}이 끝이에요.`);
    const cost = enhCost(item.enh + 1);
    const mats = await getMats(db, uid);
    if (u.gold < cost.gold) return fail("골드가 모자라요.");
    if (mats.stone < cost.stone) return fail("강화석이 모자라요.");
    if (!(await takeGold(db, uid, cost.gold))) return fail("골드가 모자라요.");
    if (!(await takeMat(db, uid, "stone", cost.stone))) {
      await db.prepare("UPDATE users SET gold = gold + ? WHERE id = ?").bind(cost.gold, uid).run();
      return fail("강화석이 모자라요.");
    }
    const guards = { dropGuard: !!b.dropGuard && mats.guard_drop > 0, breakGuard: !!b.breakGuard && mats.guard_break > 0 };
    const res = enhRoll(item.enh, item.fails, guards, () => Math.random() * 100);
    if (res.usedDrop && !(await takeMat(db, uid, "guard_drop", 1))) return fail("하락 방지 주문서가 없어요.");
    if (res.usedBreak && !(await takeMat(db, uid, "guard_break", 1))) return fail("파괴 방지 주문서가 없어요.");
    const name = itemName(item, u.cls);
    if (res.outcome === "destroy") {
      await db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").bind(item.id, uid).run();
      if (item.equipped) {
        const other = await db.prepare("SELECT id FROM items WHERE user_id = ? AND slot = ? ORDER BY tier DESC, enh DESC LIMIT 1").bind(uid, item.slot).first();
        if (other) await db.prepare("UPDATE items SET equipped = 1 WHERE id = ?").bind(other.id).run();
        else await addItem(db, uid, item.slot, 0, 0, null, 1).run();
      }
      return json({ ok: true, result: res, name, cost });
    }
    const fails = res.ok ? 0 : item.fails + 1;
    await db.prepare("UPDATE items SET enh = ?, fails = ? WHERE id = ? AND user_id = ?").bind(res.enh, fails, item.id, uid).run();
    if (res.ok && res.enh >= 12) await announce(env, `${u.name}님이 ${itemName({ ...item, enh: res.enh }, u.cls)} 강화에 성공했어요!`);
    return json({ ok: true, result: res, name, cost, item: { ...item, enh: res.enh, fails, opt: item.opt ? JSON.parse(item.opt) : null } });
  }
  return fail("not_found", 404);
}
