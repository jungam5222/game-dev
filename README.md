# krillion_kor
krillion.io can only be played in English. This is an app for playing in Korean.

## 구성

- `krillion_kr/index.html`: 하늘의 별따기 게임 (game.yunmin.dev/krillion_kr/). 파일 하나에 문제·정답·점수가 다 들어 있다.
  프로젝트 폴더 `korean-word-game/beta/`에서 `python3 -I game/make_game.py --web <이 파일>`로 만든다.
- `index.html`, `_redirects`: 지금은 게임이 하나라 game.yunmin.dev로 들어오면 `/krillion_kr/`로 보낸다 (302).
  게임이 늘면 두 파일을 게임 목록으로 바꾼다.
