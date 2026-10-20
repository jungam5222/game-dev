// 던전 RPG 던전 한 번 (Durable Object, 이름 = 던전 run id). 마을(town.js)이 /init으로 만든다.
// 방 3개: 걸어 다니다 몬스터 무리에 닿으면 전투, 다 잡으면 문이 열리고, 마지막 방이 단계 보스.
// 전투 규칙은 battle.js. 턴 30초는 alarm으로 센다. 아무도 접속해 있지 않으면 시간을 멈춘다.
// 끝나면 보상을 D1에 쓰고 10분 뒤 지운다. 한 시간 동안 아무도 없으면 실패로 끝낸다.
import { DurableObject } from "cloudflare:workers";
import { STAGES, MONSTERS, TURN } from "../../rpg/shared/content.js";
import { ensure, loadHero, grantRun } from "./db.js";
import { newRun, startBattle, playCard, useSkill, endTurn, forceEnd, nextRoom, leave, view } from "./battle.js";

const DONE_KEEP = 10 * 60e3;
const IDLE_END = 60 * 60e3;
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
// 받침에 따라 을/를, 이/가
const josa = (w, a, b) => {
  const c = w.charCodeAt(w.length - 1);
  return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b);
};

export class RpgDungeon extends DurableObject {
  async load() {
    if (this.S === undefined) this.S = (await this.ctx.storage.get("S")) || null;
    return this.S;
  }
  async save() {
    await this.ctx.storage.put("S", this.S);
  }
  sockets() {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment();
      return a && !a.kicked;
    });
  }
  onlineSet() {
    return new Set(this.sockets().map((ws) => ws.deserializeAttachment().uid));
  }
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {}
  }
  // 사람마다 손패가 달라서 화면 상태는 각자 따로 만든다
  emit(type, ev = []) {
    const on = this.onlineSet();
    for (const ws of this.sockets()) {
      const uid = ws.deserializeAttachment().uid;
      this.send(ws, { t: type, ev, v: view(this.S, uid, on) });
    }
  }
  async schedule() {
    const S = this.S;
    if (!S) return;
    let t;
    if (S.phase === "done") t = (S.doneAt || Date.now()) + DONE_KEEP;
    else {
      t = (S.active || Date.now()) + IDLE_END;
      if (S.phase === "battle" && !S.paused) t = Math.min(t, S.deadline + 300);
    }
    await this.ctx.storage.setAlarm(t);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const db = this.env.RPG_DB;
    if (url.pathname === "/init" && request.method === "POST") {
      const { run, stage, members } = await request.json();
      if (await this.load()) return json({ error: "이미 있는 던전이에요." }, 409);
      if (!STAGES[stage] || !Array.isArray(members) || !members.length) return json({ error: "잘못된 던전이에요." }, 400);
      await ensure(db);
      const heroes = (await Promise.all(members.map((uid) => loadHero(db, uid)))).filter(Boolean);
      if (!heroes.length) return json({ error: "들어갈 사람이 없어요." }, 400);
      this.S = newRun(run, stage, heroes);
      this.S.active = Date.now();
      await this.save();
      await db.batch(heroes.map((h) => db.prepare("UPDATE users SET run = ? WHERE id = ?").bind(run, h.uid)));
      await this.schedule();
      return json({ ok: true });
    }
    const S = await this.load();
    if (url.pathname === "/leave" && request.method === "POST") {
      const { uid } = await request.json();
      if (S) await this.doLeave(Number(uid));
      return json({ ok: true });
    }
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
    const uid = Number(decodeURIComponent(request.headers.get("x-uid") || ""));
    if (!S || !S.players[uid] || S.players[uid].left) return json({ error: "gone" }, 410);
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a.uid === uid) {
        ws.serializeAttachment({ ...a, kicked: true });
        this.send(ws, { t: "kicked" });
        try {
          ws.close(4000, "other window");
        } catch (e) {}
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid });
    S.active = Date.now();
    if (S.phase === "battle" && S.paused) {
      S.paused = false;
      S.deadline = Date.now() + TURN.seconds * 1000;
    }
    await this.save();
    await this.schedule();
    this.emit("state");
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 2000) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const a = ws.deserializeAttachment();
    const S = await this.load();
    if (!a || a.kicked || !S) return;
    const p = S.players[a.uid];
    if (!p || p.left) return;
    const err = (text) => this.send(ws, { t: "err", text });
    if (m.t === "move") {
      if (S.phase !== "explore") return;
      const x = Number(m.x);
      const y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      p.x = Math.max(0, Math.min(960, Math.round(x)));
      p.y = Math.max(0, Math.min(540, Math.round(y)));
      p.d = [0, 1, 2, 3].includes(m.d) ? m.d : 3;
      const s = JSON.stringify({ t: "mv", uid: p.uid, x: p.x, y: p.y, d: p.d });
      for (const o of this.sockets()) if (o !== ws) {
        try {
          o.send(s);
        } catch (e) {}
      }
      return;
    }
    if (m.t === "chat") {
      const text = String(m.text || "").trim().slice(0, 120);
      if (!text) return;
      const s = JSON.stringify({ t: "chat", uid: p.uid, name: p.name, text, at: Date.now() });
      for (const o of this.sockets()) {
        try {
          o.send(s);
        } catch (e) {}
      }
      return;
    }
    S.active = Date.now();
    if (m.t === "leave") {
      await this.doLeave(a.uid);
      return;
    }
    if (m.t === "touch") {
      const ev = startBattle(S);
      if (!ev) return;
      await this.save();
      await this.schedule();
      this.emit("ev", ev);
      return;
    }
    if (m.t === "door") {
      if (!nextRoom(S)) return;
      await this.save();
      this.emit("state");
      return;
    }
    let r;
    if (m.t === "play") r = playCard(S, a.uid, Number(m.id), Number(m.target));
    else if (m.t === "skill") r = useSkill(S, a.uid, String(m.key || ""), Number(m.target));
    else if (m.t === "end") {
      r = endTurn(S, a.uid);
      // 연결이 끊긴 파티원은 기다리지 않는다
      const on = this.onlineSet();
      const off = S.order.filter((uid) => !on.has(uid));
      if (off.length && S.phase === "battle") r.ev.push(...forceEnd(S, off));
    } else return;
    if (r.error) return err(r.error);
    await this.afterEvents(r.ev);
  }

  async afterEvents(ev) {
    const S = this.S;
    await this.save();
    this.emit("ev", ev);
    if (S.phase === "done") await this.finish();
    else await this.schedule();
  }

  async doLeave(uid) {
    const S = this.S;
    const p = S && S.players[uid];
    if (!p || p.left) return;
    const ev = leave(S, uid);
    const db = this.env.RPG_DB;
    await ensure(db);
    // 나간 사람은 그때까지 얻은 경험치·골드·강화석만 받는다
    try {
      S.result = S.result || {};
      S.result[uid] = await grantRun(db, uid, { stage: S.stage, won: false, ...p.earned });
    } catch (e) {}
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      if (a.uid === uid) {
        ws.serializeAttachment({ ...a, kicked: true });
        this.send(ws, { t: "left", result: S.result[uid] || null });
        try {
          ws.close(1000, "left");
        } catch (e) {}
      }
    }
    await this.afterEvents(ev);
  }

  async finish() {
    const S = this.S;
    if (S.finished) return;
    S.finished = true;
    S.doneAt = Date.now();
    S.result = S.result || {};
    const db = this.env.RPG_DB;
    await ensure(db);
    const stay = S.order.map((id) => S.players[id]).filter((p) => !p.left);
    for (const p of stay) {
      try {
        S.result[p.uid] = await grantRun(db, p.uid, { stage: S.stage, won: !!S.won, ...p.earned });
      } catch (e) {
        S.result[p.uid] = { error: String(e).slice(0, 200) };
      }
    }
    await this.save();
    await this.schedule();
    this.emit("end");
    if (S.won && stay.length) {
      const st = STAGES[S.stage];
      const who = stay.length > 1 ? `${stay.map((p) => p.name).join(", ")} 파티가` : josa(`${stay[0].name}님`, "이", "가");
      const text = `${who} ${S.stage}단계 보스 ${josa(MONSTERS[st.boss].name, "을", "를")} 쓰러뜨렸어요!`;
      try {
        await this.env.RPG_TOWN.get(this.env.RPG_TOWN.idFromName("town")).fetch("https://town/announce", { method: "POST", body: JSON.stringify({ text }) });
      } catch (e) {}
    }
  }

  async alarm() {
    const S = await this.load();
    if (!S) return;
    const now = Date.now();
    if (S.phase === "done") {
      if (!S.finished) await this.finish();
      else if (now >= S.doneAt + DONE_KEEP) {
        for (const ws of this.ctx.getWebSockets()) {
          try {
            ws.close(1000, "closed");
          } catch (e) {}
        }
        await this.ctx.storage.deleteAll();
        this.S = null;
        return;
      }
      await this.schedule();
      return;
    }
    const on = this.onlineSet();
    if (on.size) S.active = now;
    if (now - (S.active || now) >= IDLE_END) {
      S.phase = "done";
      S.won = false;
      await this.save();
      await this.finish();
      return;
    }
    if (S.phase === "battle" && !S.paused && now >= S.deadline) {
      if (!on.size) {
        S.paused = true;
        await this.save();
      } else {
        await this.afterEvents(forceEnd(S));
        return;
      }
    }
    await this.schedule();
  }

  async webSocketClose(ws) {
    await this.gone(ws);
  }
  async webSocketError(ws) {
    await this.gone(ws);
  }
  async gone(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.kicked) return;
    ws.serializeAttachment({ ...a, kicked: true });
    const S = await this.load();
    if (!S || S.phase === "done") return;
    const on = this.onlineSet();
    // 남은 사람이 모두 턴을 끝냈으면 나간 사람을 기다리지 않는다
    if (S.phase === "battle" && on.size && [...on].every((uid) => S.players[uid].ready || S.players[uid].down)) {
      await this.afterEvents(forceEnd(S));
      return;
    }
    this.emit("state");
  }
}
