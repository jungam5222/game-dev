// 서버와 이야기하기: 보통 요청은 api(), 마을·던전 실시간 연결은 openSocket().

export class ApiError extends Error {
  constructor(msg, status) {
    super(msg);
    this.status = status;
  }
}

export const net = { onLogin: null };

export async function api(path, body) {
  let r;
  try {
    r = await fetch("/api/rpg/" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch (e) {
    throw new ApiError("인터넷 연결을 확인해 주세요.", 0);
  }
  let data = {};
  try {
    data = await r.json();
  } catch (e) {}
  if (r.status === 401 && path !== "me") {
    if (net.onLogin) net.onLogin();
    throw new ApiError("다시 로그인해 주세요.", 401);
  }
  if (!r.ok || data.error) throw new ApiError(data.error || `문제가 생겼어요 (${r.status})`, r.status);
  return data;
}

// 끊기면 다시 잇는다. 서버가 'kicked'를 보내거나 close()를 부르면 멈춘다.
export function openSocket(path, h) {
  let ws = null;
  let closed = false;
  let tries = 0;
  let timer = null;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  function connect() {
    ws = new WebSocket(`${proto}//${location.host}/api/rpg/${path}`);
    ws.onopen = () => {
      tries = 0;
      h.open && h.open();
    };
    ws.onmessage = (m) => {
      let d;
      try {
        d = JSON.parse(m.data);
      } catch (e) {
        return;
      }
      if (d.t === "kicked") {
        closed = true;
        h.kicked && h.kicked();
        return;
      }
      h.message(d);
    };
    ws.onclose = (e) => {
      if (closed) return;
      h.down && h.down(tries);
      // 410 같은 거절은 열리기 전에 닫힌다: 몇 번 실패하면 알려 준다
      tries++;
      if (h.fail && tries >= 4) {
        closed = true;
        h.fail();
        return;
      }
      timer = setTimeout(connect, Math.min(8000, 500 * 2 ** tries));
    };
  }
  connect();
  return {
    send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (e) {}
    },
    get open() {
      return ws && ws.readyState === 1;
    },
  };
}
