// 던전 RPG 마을 (Durable Object 하나, 이름 "town"). 접속한 사람 위치·채팅·파티·알림을 나눈다.
// WebSocket Hibernation: 사람마다 정보는 소켓 attachment에, 파티·초대·채팅 기록은 storage에 둔다.
// 파티장이 던전에 들어가면 던전 Durable Object를 만들고 마을에 있는 파티원에게 'go'를 보낸다.
import { DurableObject } from "cloudflare:workers";
import { PARTY_MAX, STAGE_COUNT } from "../../rpg/shared/content.js";
import { ensure } from "./db.js";

const SPAWN = { x: 800, y: 600 };
const INVITE_MS = 60e3;

export class RpgTown extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/announce" && request.method === "POST") {
      const { text } = await request.json();
      if (typeof text === "string" && text) await this.announce(text.slice(0, 200));
      return new Response("ok");
    }
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
    const h = (k) => decodeURIComponent(request.headers.get(k) || "");
    const me = {
      uid: Number(h("x-uid")), name: h("x-name"), cls: h("x-cls"), lv: Number(h("x-level")) || 1, max: Number(h("x-max")) || 0,
      x: SPAWN.x + Math.round(Math.random() * 80 - 40), y: SPAWN.y + Math.round(Math.random() * 40 - 20), d: 1,
    };
    if (!me.uid) return new Response("bad", { status: 400 });
    // 같은 사람이 다른 창에서 다시 들어오면 앞 창을 닫는다
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.uid === me.uid && !a.kicked) {
        ws.serializeAttachment({ ...a, kicked: true });
        try {
          ws.send(JSON.stringify({ t: "kicked" }));
          ws.close(4000, "other window");
        } catch (e) {}
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);
    const parties = await this.parties();
    const party = this.partyOf(parties, me.uid);
    server.send(
      JSON.stringify({
        t: "init", you: me.uid, players: this.players(), party: this.partyView(party),
        chat: (await this.ctx.storage.get("chat")) || [], ann: (await this.ctx.storage.get("ann")) || [],
      }),
    );
    this.broadcast({ t: "join", p: me }, server);
    if (party) this.sendParty(party);
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment();
      return a && !a.kicked;
    });
  }
  players() {
    const seen = new Map();
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment();
      seen.set(a.uid, { uid: a.uid, name: a.name, cls: a.cls, lv: a.lv, x: a.x, y: a.y, d: a.d });
    }
    return [...seen.values()];
  }
  online(uid) {
    return this.sockets().find((ws) => ws.deserializeAttachment().uid === uid) || null;
  }
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {}
  }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const ws of this.sockets()) if (ws !== except) {
      try {
        ws.send(s);
      } catch (e) {}
    }
  }
  sendTo(uid, msg) {
    const ws = this.online(uid);
    if (ws) this.send(ws, msg);
  }

  async parties() {
    return (await this.ctx.storage.get("parties")) || { seq: 1, list: {} };
  }
  partyOf(parties, uid) {
    return Object.values(parties.list).find((p) => p.members.some((m) => m.uid === uid)) || null;
  }
  partyView(p) {
    if (!p) return null;
    return { id: p.id, leader: p.leader, members: p.members.map((m) => ({ ...m, online: !!this.online(m.uid) })) };
  }
  sendParty(p, extra = []) {
    const v = this.partyView(p);
    for (const m of p.members) this.sendTo(m.uid, { t: "party", party: v });
    for (const uid of extra) this.sendTo(uid, { t: "party", party: null });
  }
  removeFrom(parties, uid) {
    const p = this.partyOf(parties, uid);
    if (!p) return null;
    p.members = p.members.filter((m) => m.uid !== uid);
    if (p.members.length < 2) {
      delete parties.list[p.id];
      for (const m of p.members) this.sendTo(m.uid, { t: "party", party: null });
      return null;
    }
    if (p.leader === uid) p.leader = p.members[0].uid;
    return p;
  }

  async announce(text) {
    const ann = (await this.ctx.storage.get("ann")) || [];
    ann.push({ text, at: Date.now() });
    await this.ctx.storage.put("ann", ann.slice(-5));
    this.broadcast({ t: "ann", text, at: Date.now() });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 2000) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me || me.kicked) return;
    if (m.t === "move") {
      const x = Number(m.x);
      const y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      me.x = Math.max(0, Math.min(1600, Math.round(x)));
      me.y = Math.max(0, Math.min(1000, Math.round(y)));
      me.d = m.d < 0 ? -1 : 1;
      ws.serializeAttachment(me);
      this.broadcast({ t: "mv", uid: me.uid, x: me.x, y: me.y, d: me.d }, ws);
      return;
    }
    if (m.t === "chat") {
      const text = String(m.text || "").trim().slice(0, 120);
      if (!text) return;
      const line = { uid: me.uid, name: me.name, text, at: Date.now() };
      const chat = (await this.ctx.storage.get("chat")) || [];
      chat.push(line);
      await this.ctx.storage.put("chat", chat.slice(-30));
      this.broadcast({ t: "chat", ...line });
      return;
    }
    if (m.t === "refresh") {
      await ensure(this.env.RPG_DB);
      const u = await this.env.RPG_DB.prepare("SELECT level, max_stage FROM users WHERE id = ?").bind(me.uid).first();
      if (!u) return;
      me.lv = u.level;
      me.max = u.max_stage;
      ws.serializeAttachment(me);
      this.broadcast({ t: "p", p: { uid: me.uid, name: me.name, cls: me.cls, lv: me.lv, x: me.x, y: me.y, d: me.d } });
      const parties = await this.parties();
      const p = this.partyOf(parties, me.uid);
      if (p) {
        const mm = p.members.find((x) => x.uid === me.uid);
        mm.lv = me.lv;
        await this.ctx.storage.put("parties", parties);
        this.sendParty(p);
      }
      return;
    }
    const parties = await this.parties();
    const mine = this.partyOf(parties, me.uid);
    const err = (text) => this.send(ws, { t: "err", text });
    if (m.t === "invite") {
      const to = Number(m.to);
      const tws = to !== me.uid && this.online(to);
      if (!tws) return err("그 사람은 지금 마을에 없어요.");
      if (mine && mine.members.length >= PARTY_MAX) return err(`파티는 ${PARTY_MAX}명까지예요.`);
      if (mine && mine.members.some((x) => x.uid === to)) return err("이미 같은 파티예요.");
      await this.ctx.storage.put(`inv:${to}:${me.uid}`, Date.now());
      this.send(tws, { t: "invite", from: me.uid, name: me.name });
      return this.send(ws, { t: "info", text: `${tws.deserializeAttachment().name}님에게 파티 초대를 보냈어요.` });
    }
    if (m.t === "accept" || m.t === "decline") {
      const from = Number(m.from);
      const key = `inv:${me.uid}:${from}`;
      const at = await this.ctx.storage.get(key);
      await this.ctx.storage.delete(key);
      if (m.t === "decline") {
        this.sendTo(from, { t: "info", text: `${me.name}님이 초대를 거절했어요.` });
        return;
      }
      if (!at || Date.now() - at > INVITE_MS) return err("초대 시간이 지났어요.");
      const fws = this.online(from);
      if (!fws) return err("초대한 사람이 마을에 없어요.");
      const fa = fws.deserializeAttachment();
      if (mine) this.removeFrom(parties, me.uid);
      let p = this.partyOf(parties, from);
      if (!p) {
        p = { id: parties.seq++, leader: from, members: [{ uid: from, name: fa.name, cls: fa.cls, lv: fa.lv }] };
        parties.list[p.id] = p;
      }
      if (p.members.length >= PARTY_MAX) return err("파티가 꽉 찼어요.");
      p.members.push({ uid: me.uid, name: me.name, cls: me.cls, lv: me.lv });
      await this.ctx.storage.put("parties", parties);
      this.sendParty(p);
      return;
    }
    if (m.t === "leave") {
      if (!mine) return;
      const p = this.removeFrom(parties, me.uid);
      await this.ctx.storage.put("parties", parties);
      if (p) this.sendParty(p);
      this.send(ws, { t: "party", party: null });
      return;
    }
    if (m.t === "kick") {
      const who = Number(m.uid);
      if (!mine || mine.leader !== me.uid || who === me.uid) return;
      const p = this.removeFrom(parties, who);
      await this.ctx.storage.put("parties", parties);
      if (p) this.sendParty(p);
      this.sendTo(who, { t: "party", party: null });
      this.sendTo(who, { t: "info", text: "파티에서 빠졌어요." });
      return;
    }
    if (m.t === "enter") {
      const stage = Number(m.stage);
      if (!Number.isInteger(stage) || stage < 1 || stage > STAGE_COUNT) return err("없는 단계예요.");
      if (mine && mine.leader !== me.uid) return err("던전에는 파티장이 데리고 들어가요.");
      if (stage > me.max + 1) return err(`${stage - 1}단계 보스를 먼저 잡아야 해요.`);
      if (this.entering) return;
      this.entering = true;
      try {
        const members = mine ? mine.members.map((x) => x.uid).filter((uid) => this.online(uid)) : [me.uid];
        const run = crypto.randomUUID();
        const stub = this.env.RPG_DUNGEON.get(this.env.RPG_DUNGEON.idFromName(run));
        const r = await stub.fetch("https://do/init", { method: "POST", body: JSON.stringify({ run, stage, members }) });
        if (!r.ok) return err((await r.json().catch(() => ({}))).error || "던전을 열지 못했어요.");
        for (const uid of members) this.sendTo(uid, { t: "go", run, stage });
      } finally {
        this.entering = false;
      }
      return;
    }
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
    if (this.online(a.uid)) return;
    this.broadcast({ t: "leave", uid: a.uid });
    const parties = await this.parties();
    const p = this.partyOf(parties, a.uid);
    if (p) this.sendParty(p);
  }
}
