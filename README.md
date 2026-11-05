# 사이 — 우리의 시간을 함께

두 사람의 일정과 함께할 약속을 한눈에 보는 한국어 공유 캘린더입니다. 따뜻한 색감의 화면에 월·주·목록 보기, 반복 일정, 기념일, 초대를 담았습니다.

[사이 사용해 보기](https://sai-our-calendar.seonguk.chatgpt.site)

![사이 캘린더 예시 화면](docs/preview.jpg)

접속 화면과 예시 둘러보기는 공개되어 있습니다. 실제 일정은 로그인한 뒤 초대로 연결한 두 계정만 조회할 수 있습니다. **나·짝꿍·함께는 두 사람 모두에게 보이는 일정 구분**입니다.

## 주요 기능

- 월·주·목록 보기, 날짜 선택, 사람별 필터와 검색
- 종일·시간·여러 날 일정, 장소·메모·카테고리
- 매주·매월·매년 반복, 반복 종료일, 기념일과 D-day
- 두 계정의 공유 공간과 만료·취소 가능한 초대 링크
- 서버 저장, 다른 기기의 변경 조회, 동시 수정 충돌 안내
- 조회 범위의 iCalendar 파일 내보내기
- 실제 캘린더와 분리된 예시 둘러보기

처음 사용할 때는 로그인 → 캘린더 만들기 → 설정에서 짝꿍 초대 순서로 진행합니다. 초대 링크는 상대방에게 직접 전달합니다. 코드는 7일 후 만료되고 한 번만 사용할 수 있으며, 두 계정이 연결된 공간에는 세 번째 계정이 참가할 수 없습니다. 서버에는 초대 코드 원문 대신 해시를 저장합니다.

## 로컬에서 실행하기

Node.js **22.13.0 이상**과 npm이 필요합니다. 저장소 폴더에서 다음 명령을 실행합니다. Windows·macOS·Linux에서 같은 npm 명령을 사용합니다.

```sh
npm run install:ci
npm run build
```

로컬 데이터베이스가 처음 만들어졌다면 초기 스키마를 **한 번만** 적용합니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_tan_randall_flagg.sql
```

개발 서버를 시작합니다.

```sh
npm run dev
```

브라우저에서 http://127.0.0.1:5173 에 접속합니다. 개발 환경에서는 `/signin-with-chatgpt?return_to=/` 경로로 모의 로그인할 수 있습니다. 모의 로그인은 개발 전용이며 운영 인증으로 사용할 수 없습니다.

로컬 데이터베이스는 `.wrangler/`에 생성되며 운영 서비스의 데이터베이스와 분리됩니다. 이 저장소에는 실제 사용자의 일정, 계정 데이터, 초대 코드, 로컬 DB, 인증 토큰이 포함되어 있지 않습니다. `.openai/hosting.json`에는 로컬 실행에 필요한 바인딩 설정만 있고 운영 프로젝트 ID는 없습니다.

## 검증

```sh
npm test
npm run typecheck
```

도메인 테스트 12개는 날짜·시간 검증, 반복 일정, 조회 범위, 겹치는 시간을 확인합니다. API 통합 검증 16개는 인증, 초대와 두 계정의 공유, 중복 요청, 수정 충돌, 삭제, 다른 공간의 접근 차단을 확인합니다. 구현 시 두 검증을 모두 통과했습니다.

통합 검증에는 위의 빌드와 초기 스키마 적용을 마친 로컬 Worker가 필요합니다. 별도 터미널에서 실행합니다.

```sh
npm start -- --port 5174
```

다른 터미널에서 검증을 실행합니다.

```sh
npm run test:integration
```

기본 대상은 http://127.0.0.1:5174 입니다. 검증은 합성 사용자 세 명과 테스트 일정을 로컬 DB에 만듭니다. loopback 주소에서만 실행할 수 있습니다. 개발 서버의 모의 로그인은 임의 인증 헤더를 차단하므로, 이 검증에는 5173 개발 서버 대신 위의 로컬 Worker를 사용합니다.

## 인증과 배포

운영 앱은 Sites의 ChatGPT 로그인과 Cloudflare D1 저장소를 사용합니다. `app/chatgpt-auth.ts`는 **Sites의 신뢰된 게이트웨이가 검증 후 주입한 인증 헤더**를 읽도록 설계되어 있습니다.

**다른 서버에 공개 배포하려면 인증을 해당 환경에 맞게 교체해야 합니다.** 원본 Worker를 직접 공개해 클라이언트가 보낸 인증 헤더를 그대로 신뢰하면 사용자 위조가 가능합니다. 로컬 통합 검증에서 합성 인증 헤더를 보내는 방식도 로컬 테스트에만 사용해야 합니다.

## 현재 범위

- 시간대는 한국 시간(`Asia/Seoul`)입니다.
- 매월 29~31일 또는 매년 2월 29일 반복은 해당 날짜가 없는 달·해를 건너뜁니다.
- 반복 일정 수정·삭제는 전체 시리즈에 적용됩니다.
- Google·Apple 캘린더 자동 동기화, 휴대폰 푸시·잠금 화면 알림, 오프라인 편집은 지원하지 않습니다.
- 예시 일정은 둘러보기 화면에서만 사용하며 실제 캘린더에 자동 저장하지 않습니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `components/calendar/` | 캘린더 화면, 일정 폼, 초대와 설정 |
| `lib/client/` | 날짜 표시, 예시 데이터, API 클라이언트 |
| `lib/domain/calendar.ts` | 입력 검증과 반복 일정 전개 |
| `lib/server/calendar-service.ts` | 인증·권한 확인과 D1 요청 |
| `app/api/` | API 경로 |
| `db/schema.ts`, `drizzle/` | 스키마와 마이그레이션 |
| `tests/`, `scripts/smoke-calendar.mjs` | 도메인·API 통합 검증 |

화면은 React·TypeScript로 작성했으며 Vinext·Vite·Cloudflare Workers를 사용합니다.

## 라이선스

저장소 전체에 대한 별도 라이선스는 아직 지정하지 않았습니다. 포함된 외부 코드의 라이선스 고지는 각 파일과 함께 유지합니다.

- [Sites Vite 플러그인 MIT 고지](scripts/vite/sites-vite-plugin.LICENSE)
- [shadcn 스타일 MIT 고지](vendor/shadcn-tailwind-4.13.0.LICENSE.md)
