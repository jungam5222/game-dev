// make_game.py가 pipeline/matcher.js에서 만든 파일. 고치지 말 것.
// 입력한 답을 정답 목록과 맞춰 보는 규칙. pipeline/matcher.py와 똑같이 동작해야 한다.
// 바꾸면 test_matcher.py로 두 구현의 결과가 같은지 확인한다. 게임 페이지에 이 코드를 그대로 넣어 쓴다.

const POLITE = ["입니다", "이요", "요"];

function norm(s) {
  return (s || "").normalize("NFKC").trim().toLowerCase()
    .replace(/\+/g, "플러스").replace(/#/g, "샵") // C++·C#이 C와 같아지지 않게
    .replace(/[^0-9a-z가-힣]/g, "");
}

function hangulCount(s) {
  let n = 0;
  for (const ch of s) if (ch >= "가" && ch <= "힣") n++;
  return n;
}

function units(s) {
  const out = [];
  for (const ch of s) {
    const code = ch.codePointAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out.push("C" + Math.floor(code / 588), "V" + Math.floor((code % 588) / 28));
      if (code % 28) out.push("T" + (code % 28));
    } else {
      out.push(ch);
    }
  }
  return out;
}

function distance(a, b) {
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

function fuzzyOk(s) {
  const h = hangulCount(s);
  return h ? h >= 3 : s.length >= 5;
}

// 존댓말 꼬리는 맞는 것을 모두 떼 본다. '지렁이요'는 '지렁'(이요)과 '지렁이'(요)를 둘 다 본다.
function candidates(s, suffixes) {
  const out = [s];
  const bases = [s];
  for (const p of POLITE) {
    if (s.endsWith(p) && s.length > p.length) {
      bases.push(s.slice(0, -p.length));
    }
  }
  for (const b of bases) {
    if (!out.includes(b)) out.push(b);
    for (const suf of suffixes || []) {
      if (b.endsWith(suf) && b.length > suf.length) {
        const t = b.slice(0, -suf.length);
        if (!out.includes(t)) out.push(t);
      }
    }
  }
  return out;
}

// answers: [[대표표기, [허용표기...], ...], ...] (estimate_v2.json의 prompts[i].answers), suffixes: prompts[i].suffixes,
// rejected: 오답 목록의 입력들. 오답 목록에 있는 말은 오타 허용으로 다른 정답이 되지 않는다.
function makeMatcher(answers, suffixes, rejected) {
  const index = new Map();
  for (const [text, aliases] of answers) {
    for (const form of [text, ...aliases]) {
      const key = norm(form);
      if (key && !index.has(key)) index.set(key, text);
    }
  }
  const fuzzyKeys = [...index.keys()].filter(fuzzyOk).map((k) => [k, units(k)]);
  const rejectedKeys = new Set((rejected || []).map(norm).filter(Boolean));
  return function match(raw) {
    const s = norm(raw);
    if (!s) return [null, "empty"];
    const cands = candidates(s, suffixes);
    for (let i = 0; i < cands.length; i++) {
      if (index.has(cands[i])) return [index.get(cands[i]), i === 0 ? "exact" : "strip"];
    }
    if (cands.some((c) => rejectedKeys.has(c))) return [null, "rejected"];
    if (fuzzyOk(s)) {
      const u = units(s);
      const hits = new Set();
      for (const [k, ku] of fuzzyKeys) {
        if (Math.abs(ku.length - u.length) <= 1 && distance(u, ku) <= 1) hits.add(index.get(k));
      }
      if (hits.size === 1) return [[...hits][0], "fuzzy"];
    }
    return [null, "none"];
  };
}

export { norm, makeMatcher, candidates };
