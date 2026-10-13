# krillion_kor
krillion.io can only be played in English. This is an app for playing in Korean.

## 구성

- `starvest/index.html`: 하늘의 별따기 게임 (game.yunmin.dev/starvest/). 문제는 들어 있지만 정답은 없다 (F12로 보이지 않게).
  프로젝트 폴더 `korean-word-game/beta/`에서 `python3 -I game/make_game.py --web <이 파일>`로 만든다.
  같은 명령이 `server/answers.bin`(정답·점수·오답, gzip JSON)과 `server/matcher.js`(채점 규칙)도 만든다.
  `server/`는 `.assetsignore`로 공개 파일에서 빠지고 Worker 안에서만 쓴다.
- `index.html`, `_redirects`: 지금은 게임이 하나라 game.yunmin.dev로 들어오면 `/starvest/`로 보낸다 (302).
  게임이 늘면 두 파일을 게임 목록으로 바꾼다.
- `worker.js`: 채점·순위 서버. `/api/judge`(답 하나 채점), `/api/list`(다 푼 뒤 정답 목록), `/api/score`(순위)를 받고 나머지는 정적 파일로 나간다.
  목록에 없는 답은 Claude Sonnet(처음엔 Haiku, 2026-10-13 사용자가 넉넉히 써도 된다고 해서 바꿈)에게 맞는 답인지와 한국에서 얼마나 흔한 말인지 물어 점수를 준다 (`@anthropic-ai/sdk`, package.json).
  키는 Cloudflare 대시보드 Worker 설정의 비밀값 `ANTHROPIC_API_KEY` (저장소에 넣지 않는다). 키가 없으면 묻지 않고 '목록에 없는 답'으로 둔다.
  같은 문제·같은 답은 처음 판정을 저장해 모두에게 같은 점수를 준다. 응답의 토큰 수로 쓴 돈을 세어 한 달 50달러·하루 2.5달러를 넘으면 묻지 않는다. 같은 IP 하루 60번까지 (worker.js 맨 위 숫자).
  `GET /api/found`: Claude가 인정한 새 답 목록, 날짜별 호출 수, 달별 쓴 돈 (정답 목록에 넣을 후보).
  순위: 점수는 Durable Object(SQLite) `Board`에 판(그날의 문제 `d:날짜`, 추가 플레이 `s:세트번호`)마다 플레이어당 첫 기록만 모아 'N명 중 M등'을 돌려준다.
