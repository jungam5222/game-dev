// game.yunmin.dev 순위 서버.
// 게임 파일은 그대로 정적 파일로 나가고, /api/* 만 이 Worker가 받는다.
// 점수는 Durable Object(SQLite) 하나에 모은다: 판(board)마다 플레이어당 첫 기록 하나.
//   board "d:2026-10-16" = 그날의 문제, "s:3" = 추가 플레이 3세트
import { DurableObject } from "cloudflare:workers";

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
    if (url.pathname !== "/api/score") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method" }, 405);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad_json" }, 400); }
    const { board, player, score } = body || {};
    if (typeof board !== "string" || !BOARD.test(board) || !dailyOk(board)) return json({ error: "bad_board" }, 400);
    if (typeof player !== "string" || !PLAYER.test(player)) return json({ error: "bad_player" }, 400);
    if (!Number.isInteger(score) || score < 0 || score > 700 || score % 5) return json({ error: "bad_score" }, 400);
    const stub = env.BOARD.get(env.BOARD.idFromName("main"));
    const out = await stub.submit(board, player, score, await ipKey(request));
    return out.error ? json(out, 429) : json(out);
  },
};
