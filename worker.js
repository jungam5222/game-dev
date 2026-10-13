// game.yunmin.dev 순위 서버.
// 게임 파일은 그대로 정적 파일로 나가고, /api/* 만 이 Worker가 받는다.
// 점수는 Durable Object(SQLite) 하나에 모은다: 판(board)마다 플레이어당 첫 기록 하나.
//   board "d:2026-10-16" = 그날의 문제, "s:3" = 추가 플레이 3세트
// 정답은 게임 페이지에 넣지 않고 여기서 채점한다 (/api/judge, /api/list). F12로 정답이 보이지 않게.
//   server/answers.bin(gzip JSON)과 server/matcher.js는 make_game.py --web이 만든다. server/는 공개 파일이 아니다.
import { DurableObject } from "cloudflare:workers";
import ANSWERS_GZ from "./server/answers.bin";
import { norm, makeMatcher, candidates } from "./server/matcher.js";

const BOARD = /^(d:\d{4}-\d{2}-\d{2}|s:[1-9]\d?)$/;
const PLAYER = /^[A-Za-z0-9_-]{8,40}$/;
const DAY = 86400e3;
const PER_IP = 20; // 한 판에 같은 곳(IP)에서 새로 받을 기록 수

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (
      board TEXT NOT NULL, player TEXT NOT NULL, score INTEGER NOT NULL, at INTEGER NOT NULL, ip TEXT,
      PRIMARY KEY (board, player))`);
  }

  // 처음 낸 기록만 남기고, 남은 기록의 순위를 돌려준다
  submit(board, player, score, ip) {
    const had = this.sql.exec("SELECT score FROM scores WHERE board = ? AND player = ?", board, player).toArray()[0];
    if (!had) {
      const n = this.sql.exec("SELECT COUNT(*) AS n FROM scores WHERE board = ? AND ip = ?", board, ip).one().n;
      if (n >= PER_IP) return { error: "too_many" };
      this.sql.exec("INSERT INTO scores (board, player, score, at, ip) VALUES (?, ?, ?, ?, ?)", board, player, score, Date.now(), ip);
    }
    return this.rank(board, had ? had.score : score);
  }

  rank(board, score) {
    const r = this.sql.exec(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN score > ? THEN 1 ELSE 0 END) AS above FROM scores WHERE board = ?",
      score, board).one();
    return { score, total: r.total, rank: (r.above || 0) + 1 };
  }
}

// 문제 id → [정답들, 꼬리말들, 오답들]. 처음 쓸 때 한 번 푼다.
let answersP = null;
function answers() {
  if (!answersP) {
    const stream = new Response(ANSWERS_GZ).body.pipeThrough(new DecompressionStream("gzip"));
    answersP = new Response(stream).json();
    answersP.catch(() => { answersP = null; });
  }
  return answersP;
}
const judges = new Map();
function judgeOf(id, entry) {
  if (!judges.has(id)) {
    const [list, suffixes, rejected] = entry;
    judges.set(id, {
      suffixes,
      match: makeMatcher(list, suffixes, rejected.map((r) => r[0])),
      score: new Map(list.map((a) => [a[0], a[2]])),
      why: new Map(rejected.map(([t, w]) => [norm(t), w])),
    });
  }
  return judges.get(id);
}
// 게임 페이지(template.html)의 judge와 같은 결과
function judge(id, entry, raw) {
  const j = judgeOf(id, entry);
  const [canon, how] = j.match(raw);
  if (canon) return { score: j.score.get(canon), kind: "ok", canon };
  if (how === "rejected") {
    const key = candidates(norm(raw), j.suffixes).find((c) => j.why.has(c));
    return { score: 0, kind: "rejected", why: j.why.get(key) || "" };
  }
  return { score: 0, kind: "unknown" };
}
const ID = /^[a-z0-9_]{1,40}$/;

async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function dailyOk(board) {
  if (!board.startsWith("d:")) return true;
  const t = Date.parse(board.slice(2) + "T00:00:00+09:00");
  const now = Date.now();
  return Number.isFinite(t) && t <= now + DAY && t >= now - 3 * DAY; // 한국 날짜로 사흘 전부터 내일까지
}

async function ipKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("starvest:" + ip));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!["/api/score", "/api/judge", "/api/list"].includes(url.pathname)) return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method" }, 405);
    const body = await readJson(request);
    if (!body) return json({ error: "bad_json" }, 400);
    if (url.pathname !== "/api/score") {
      const { id, raw } = body;
      if (typeof id !== "string" || !ID.test(id)) return json({ error: "bad_id" }, 400);
      const all = await answers();
      const entry = Object.hasOwn(all, id) ? all[id] : null;
      if (!entry) return json({ error: "bad_id" }, 400);
      if (url.pathname === "/api/list") return json({ answers: entry[0] });
      if (typeof raw !== "string" || !raw.trim() || raw.length > 60) return json({ error: "bad_raw" }, 400);
      return json(judge(id, entry, raw));
    }
    const { board, player, score } = body;
    if (typeof board !== "string" || !BOARD.test(board) || !dailyOk(board)) return json({ error: "bad_board" }, 400);
    if (typeof player !== "string" || !PLAYER.test(player)) return json({ error: "bad_player" }, 400);
    if (!Number.isInteger(score) || score < 0 || score > 700 || score % 5) return json({ error: "bad_score" }, 400);
    const stub = env.BOARD.get(env.BOARD.idFromName("main"));
    const out = await stub.submit(board, player, score, await ipKey(request));
    return out.error ? json(out, 429) : json(out);
  },
};
