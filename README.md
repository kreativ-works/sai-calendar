# 사이 — 우리의 시간을 함께

두 사람의 일정과 함께할 약속을 한눈에 보는 한국어 공유 캘린더입니다. 따뜻한 색감의 화면에 월·주·목록 보기, 반복 일정, 기념일, 초대를 담았습니다.

[사이 사용해 보기](https://sai-our-calendar.seonguk.chatgpt.site) · [GitHub](https://github.com/kreativ-works/sai-calendar)

![사이 캘린더 예시 화면](docs/preview.jpg)

접속 화면과 예시 둘러보기는 공개되어 있습니다. 실제 일정은 로그인한 뒤 초대로 연결한 두 계정만 조회할 수 있습니다. **나·짝꿍·함께는 두 사람 모두에게 보이는 일정 구분**입니다.

운영 사이트는 **Firebase Authentication의 이메일·비밀번호 및 Google 로그인**을 사용합니다. 가입·이메일 확인·세션 연결은 로컬 Auth Emulator에서 검증했고, 운영 배포 후 공개 접속과 보호 페이지의 로그인 이동, 익명·잘못된 토큰의 API 차단을 확인했습니다. 실제 메일 수신 및 Google 계정의 최종 로그인 검증 범위는 아래 배포 안내를 확인하세요.

## 주요 기능

- 모바일 하단 메뉴, 바로 쓰는 사람별 필터, 필요할 때 펼치는 검색
- 월간 날짜 칸에 일정 제목을 한 줄로 표시하고 긴 제목은 말줄임
- 월·주·목록 보기, 날짜 선택, 사람별 필터와 검색
- 종일·시간·여러 날 일정, 장소·메모·카테고리
- 매주·매월·매년 반복, 반복 종료일, 기념일과 D-day
- 두 계정의 공유 공간과 만료·취소 가능한 초대 링크
- 서버 저장, 다른 기기의 변경 조회, 동시 수정 충돌 안내
- 조회 범위의 iCalendar 파일 내보내기
- 실제 캘린더와 분리된 예시 둘러보기

처음 사용할 때는 로그인 → 캘린더 만들기 → 설정에서 짝꿍 초대 순서로 진행합니다. 초대 링크는 상대방에게 직접 전달합니다. 코드는 7일 후 만료되고 한 번만 사용할 수 있으며, 두 계정이 연결된 공간에는 세 번째 계정이 참가할 수 없습니다. 서버에는 초대 코드 원문 대신 해시를 저장합니다.

## 화면과 시작 흐름

- `/`: 공개 랜딩 페이지와 사용 안내
- `/start`: 가입 화면을 거쳐 `/app?setup=1`로 이동. 이미 로그인했다면 바로 시작합니다.
- `/signup`, `/login`: 이메일 또는 Google 계정으로 가입·로그인
- `/forgot-password`: 비밀번호 재설정 메일 요청
- `/auth/action`: 이메일 확인·비밀번호 재설정·이메일 변경 복구
- `/logout`: 브라우저의 Firebase 로그인과 서버 세션을 함께 종료
- `/app`: 내 캘린더. 새 사용자는 생성 폼이 자동으로 열립니다.
- `/app?demo=1`: 로그인 없이 사용할 수 있는 예시 캘린더
- `/app?setup=join`: 초대 코드를 입력해 연결

기존 `/?join=...` 초대 링크도 계속 사용할 수 있습니다. 홈 화면에 추가한 웹앱은 `/app`에서 시작합니다. 모바일 월간 화면은 날짜마다 일정 두 개를 우선 보여주고, 더 있는 날은 정확한 추가 개수와 해당 날짜의 전체 일정 보기를 제공합니다. 모든 제목은 한 줄이며 전체 내용은 일정을 눌러 확인합니다.

## 로컬에서 실행하기

Node.js **22.13.0 이상**과 npm이 필요합니다. 저장소 폴더에서 다음 명령을 실행합니다. Windows·macOS·Linux에서 같은 npm 명령을 사용합니다.

```sh
npm run install:ci
npm run build
```

로컬 데이터베이스가 처음 만들어졌다면 두 마이그레이션을 순서대로 **한 번만** 적용합니다. 기존 초기 스키마가 있는 환경에서는 `0001`만 추가합니다. `0001`은 기존 캘린더·일정·멤버를 지우지 않고 인증 연결 테이블을 추가합니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_tan_randall_flagg.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_amazing_jetstream.sql
```

개인 Firebase 프로젝트 없이 테스트하려면 아래의 **로컬 Auth Emulator**를 먼저 설정한 뒤 개발 서버를 시작합니다.

```sh
npm run dev
```

브라우저에서 http://127.0.0.1:5173 에 접속합니다. 인증 설정을 바꿨다면 개발 서버를 다시 시작합니다. 일반 캘린더 로그인은 `/login`을 사용합니다. 기존 Sites 모의 로그인만으로 새 인증 API를 통과할 수 없습니다.

로컬 데이터베이스는 `.wrangler/`에 생성되며 운영 서비스의 데이터베이스와 분리됩니다. `.dev.vars*`, `.env*`, `.wrangler/`, 빌드 결과는 Git에서 제외됩니다. 실제 사용자 데이터, 토큰, 로컬 DB, 서비스 계정 키를 공개 저장소에 올리지 마세요.

### 로컬 Auth Emulator

저장소 루트의 **추적하지 않는** `.dev.vars`에 아래 테스트용 설정을 작성합니다. 모두 가짜 로컬 값입니다.

```dotenv
SAI_FIREBASE_API_KEY="fake-api-key"
SAI_FIREBASE_AUTH_DOMAIN="demo-sai-calendar.firebaseapp.com"
SAI_FIREBASE_PROJECT_ID="demo-sai-calendar"
SAI_FIREBASE_APP_ID="1:000000000000:web:demo-sai-calendar"
SAI_FIREBASE_AUTH_EMULATOR_URL="http://127.0.0.1:9099"
```

Auth 전용 Emulator는 Java가 필요하지 않습니다. 로컬 `firebase.json`에 다음 구성을 두고 별도 터미널에서 실행합니다. `demo-` 프로젝트는 실제 클라우드 프로젝트에 접속하지 않습니다.

```json
{
  "emulators": {
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "ui": { "enabled": false }
  }
}
```

```sh
npx firebase-tools@latest emulators:start --only auth --project demo-sai-calendar
```

이메일 확인·비밀번호 재설정 링크는 실제 메일 대신 Emulator 터미널이나 로컬 OOB API에서 확인합니다. Google 테스트도 모의 제공자입니다. 실제 Google 계정의 동의 화면·메일 배달·모바일 팝업 동작은 운영 프로젝트에서 별도로 검증해야 합니다.

unsigned Emulator 토큰 허용은 개발 빌드이고 앱·Emulator 주소가 모두 loopback일 때만 가능합니다. **운영 환경에 `SAI_FIREBASE_AUTH_EMULATOR_URL`을 설정하지 마세요.** 운영 빌드는 이 경로를 비활성화하고 Google 서명 검증을 요구합니다.

## 검증

```sh
npm test
npm run typecheck
```

단위 테스트는 캘린더 날짜·반복 로직, 서명된 Firebase 토큰·계정 상태, 인증 helper 프록시의 요청 경계와 쿠키 제외를 검증합니다. Auth Emulator → 개발 Worker → D1 통합 검증 **17개**는 이메일 확인, Google 모의 로그인, 두 계정 공유, 초대, 토큰 폐기 후 세션 거부, CSRF, 기존 계정의 명시적 연결과 동시 연결 충돌을 확인합니다. 구현 시 이 검증을 통과했습니다. 운영 Google OAuth와 실제 메일 수신 검증을 대신하지는 않습니다.

통합 검증에는 위의 `.dev.vars`, 두 DB 마이그레이션, Auth Emulator 및 `npm run dev`가 필요합니다. `.wrangler/state` 아래에서 **현재 DB의 `.sqlite` 파일**을 찾습니다. `metadata.sqlite`를 선택하지 마세요.

```sh
rg --files --hidden --no-ignore .wrangler/state | rg '\.sqlite$'
```

경로를 대입해 실행합니다.

```sh
npm run test:integration -- http://127.0.0.1:5173 http://127.0.0.1:9099 --legacy-db .wrangler/state/v3/d1/실제-DB-경로/database.sqlite
```

검증은 loopback의 `demo-sai-calendar` 및 앱 내부 `.wrangler/state` DB만 허용합니다. 합성 계정·일정·이전 계정 fixture를 만들고 정리하므로 테스트용 로컬 DB에서 실행합니다. 운영 사이트나 실제 사용자 DB를 대상으로 실행하지 마세요. `npm start`의 운영 빌드에서는 unsigned Emulator 토큰을 사용할 수 없습니다.

`scripts/smoke-calendar.mjs`는 이전 Sites 인증 방식의 참고 검증입니다. 현재 Firebase 전환 검증은 `scripts/smoke-firebase-auth.mjs`를 사용합니다.

## 인증과 배포

### Firebase 운영 설정

운영 앱은 Firebase Authentication으로 사용자를 확인하고 Cloudflare D1에 일정·공유 관계를 저장하도록 구현했습니다. Firebase의 다음 **웹 앱 설정 네 값**을 호스팅 환경에 설정해야 합니다.

| 환경 변수 | Firebase 웹 앱 설정 |
| --- | --- |
| `SAI_FIREBASE_API_KEY` | `apiKey` |
| `SAI_FIREBASE_AUTH_DOMAIN` | 운영 사이트 호스트. 현재 `sai-our-calendar.seonguk.chatgpt.site` |
| `SAI_FIREBASE_PROJECT_ID` | `projectId` |
| `SAI_FIREBASE_APP_ID` | `appId` |

이 네 값은 브라우저 SDK에도 전달되는 공개 설정이며 서비스 계정 개인 키가 아닙니다. 사용자 비밀번호는 Firebase SDK가 처리하고 앱의 D1에는 저장하지 않습니다. 이 구현에는 Firebase Admin 서비스 계정 키가 필요하지 않습니다.

배포 전 다음 설정을 완료합니다.

1. Firebase Authentication에서 **이메일/비밀번호와 Google**을 활성화합니다. Google 제공자의 지원 이메일과 공개 앱 이름도 설정합니다.
2. Authorized domains에 `sai-our-calendar.seonguk.chatgpt.site`를 추가합니다. 프로토콜·포트·경로는 넣지 않습니다.
3. 비밀번호 정책을 **최소 8자, 적용 모드 Require**로 설정합니다. 프런트엔드 검증만으로 서버 정책을 대신할 수 없습니다.
4. 이메일 템플릿의 custom action URL을 `https://sai-our-calendar.seonguk.chatgpt.site/auth/action`으로 설정하고 실제 확인·재설정 메일을 검증합니다.
5. D1에 `0001` 인증 연결 마이그레이션을 적용하고 네 설정값과 앱을 같은 Firebase 프로젝트로 배포합니다.

운영 Google 로그인은 같은 창에서 인증하고 돌아오는 redirect 방식입니다. `authDomain`을 앱 호스트로 설정하고, 동일 출처의 `/__/auth/*`를 고정된 Firebase 프로젝트로 프록시합니다. Google OAuth 웹 클라이언트에 앱의 JavaScript 원본과 `https://sai-our-calendar.seonguk.chatgpt.site/__/auth/handler`를 허용된 리디렉션 주소로 등록해야 합니다. 프록시는 사이트의 쿠키·Authorization·Sites 신원 헤더·Referer를 전달하지 않으며 응답을 캐시하지 않습니다. 로컬·에뮬레이터 또는 다른 authDomain 설정에서는 팝업을 유지합니다. Google 연결이 늦어지면 사용자가 전체 페이지를 다시 시작하거나 이메일 로그인을 선택할 수 있습니다.

Google 로그인 설정과 실제 계정의 OAuth 완료, 확인·재설정 메일 수신은 서로 다른 검증 단계입니다. 로컬 모의 계정 검증만으로 운영 OAuth나 메일 전달 성공을 보장하지 않습니다.

서버는 ID 토큰의 Google 서명, 프로젝트·사용자·유효 시간·이메일 확인 상태를 검증하고 Firebase 계정 조회로 정지·삭제·토큰 폐기를 확인합니다. 세션 쿠키는 호스트 한정, HttpOnly, SameSite=Lax이며 HTTPS에서 Secure입니다. 쿠키 수명은 ID 토큰의 남은 시간 이내, 최대 1시간이고 클라이언트가 갱신합니다. API마다 D1 membership을 다시 확인합니다.

### 기존 ChatGPT 계정의 일정 보존

`auth_identities`는 Firebase 프로젝트·subject를 기존 앱 사용자 ID에 연결합니다. **이메일 문자열이 같다는 이유로 기존 일정을 자동 연결하지 않습니다.** 새 가입자는 새 ID를 받습니다.

기존 일정 연결은 다음을 모두 확인하는 명시적 `/api/auth/link-legacy` 요청으로만 진행합니다.

- 검증된 Firebase 로그인 및 최근 5분 이내 재인증
- Sites 게이트웨이가 제공한 기존 계정의 신원
- 새 계정에 이미 다른 캘린더가 없고, 기존 계정에 다른 Firebase identity가 연결되지 않았음

사용자가 연결을 선택하면 identity mapping만 변경하여 기존 멤버·짝꿍·일정 ID를 보존합니다. 동시에 새 캘린더를 만들거나 초대에 가입하더라도 원자적 SQL 조건으로 충돌을 거부합니다. 기존 ChatGPT 로그인은 이 이전 과정의 소유 증명에만 사용하며 평소 로그인 수단이 아닙니다.

`app/chatgpt-auth.ts`는 이전 소유 증명을 위해 남아 있습니다. Sites 밖에 배포할 때에는 클라이언트가 보낸 `oai-authenticated-*` 헤더를 신뢰하지 말고 이전 연결 경로를 비활성화하거나 해당 플랫폼의 검증된 소유 증명으로 교체해야 합니다. 토큰·비밀번호·초대 원문·서비스 계정 키를 소스, 로그, 공개 GitHub 저장소에 넣지 마세요.

## 현재 범위

- 시간대는 한국 시간(`Asia/Seoul`)입니다.
- 매월 29~31일 또는 매년 2월 29일 반복은 해당 날짜가 없는 달·해를 건너뜁니다.
- 반복 일정 수정·삭제는 전체 시리즈에 적용됩니다.
- Google·Apple 캘린더 자동 동기화와 오프라인 편집은 지원하지 않습니다.
- 알림함과 기기별 Web Push를 제공합니다. 앱 우측 상단 종 모양에서 읽음 처리와 개인 알림 설정을 관리합니다.
- 예시 일정은 둘러보기 화면에서만 사용하며 실제 캘린더에 자동 저장하지 않습니다.

## 알림 운영

짝꿍이 일정을 등록·수정·삭제하면 상대의 알림함에 기록합니다. 본인의 변경은 본인에게 보내지 않습니다. 기본 미리 알림은 내 일정과 함께하는 일정의 시작 30분 전이며, 종일 일정은 서울 시간 오전 9시입니다. 반복 일정도 회차별로 처리합니다. 알림 설정은 각 계정에 저장하고, 기기 알림은 각 브라우저에서 직접 켭니다.

- 수신 권한은 사용자가 버튼을 눌렀을 때 요청합니다. iPhone/iPad는 iOS/iPadOS 16.4 이상에서 홈 화면에 추가한 웹 앱으로 열어야 합니다.
- 잠금 화면 미리보기는 기본으로 꺼져 있습니다. 조용한 시간에는 푸시를 생략하고 알림함에 기록합니다.
- 로그아웃 시 현재 브라우저의 구독을 해제합니다. 만료된 구독 정리, 중복 방지, 전송 실패 재시도는 서버에서 처리합니다.
- 앱의 서비스 워커는 푸시만 처리하며 일정·인증 정보와 로그인 페이지를 캐시하지 않습니다.

Sites 런타임에 다음 키를 설정합니다. `SAI_WEB_PUSH_PRIVATE_JWK`는 반드시 비밀 값으로 저장하고 공개 소스에 넣지 않습니다. 공개키·개인키는 동일한 P-256 키 쌍이어야 합니다. Firebase FCM 서비스 계정은 필요하지 않습니다.

| 환경 변수 | 용도 |
| --- | --- |
| `SAI_WEB_PUSH_PUBLIC_KEY` | Base64url 비압축 P-256 공개키 |
| `SAI_WEB_PUSH_PRIVATE_JWK` | P-256 개인키 JWK JSON, 서버 비밀 값 |
| `SAI_WEB_PUSH_SUBJECT` | 운영 연락처 `mailto:` URI |
| `SAI_NOTIFICATION_CRON_REPOSITORY_ID` | 허용할 GitHub 저장소의 숫자 ID |
| `SAI_NOTIFICATION_CRON_OWNER_ID` | 허용할 GitHub 조직의 숫자 ID |

`.github/workflows/notifications.yml`은 공개 저장소의 기본 브랜치에서 5분 간격으로 실행합니다. 매번 GitHub OIDC 단기 토큰을 받아 인증된 발송 API를 호출하므로 배포 토큰이나 API 비밀을 GitHub에 저장하지 않습니다. 서버는 서명·발급자·대상·저장소/조직 ID·워크플로 파일·브랜치·실행 이벤트를 검증합니다. 다른 저장소에서 포크해 실행해도 발송 권한을 얻지 못합니다. 자체 호스팅으로 옮길 때는 이 신뢰 조건과 발송 URL을 함께 변경해야 합니다.

GitHub 예약 실행은 지연되거나 누락될 수 있으므로 정각 알람을 보장하지 않습니다. 공개 저장소가 60일 동안 활동이 없으면 예약 워크플로가 자동 중지될 수 있으니 Actions 상태를 확인해야 합니다. 사용자가 많아지면 전용 예약 작업과 큐로 이전해야 합니다. 설계·보존 기간·검증 범위는 [알림 설계](docs/notifications-design.md)에 기록합니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `components/calendar/` | 캘린더 화면, 일정 폼, 초대와 설정 |
| `components/auth/` | 가입·로그인·이메일 작업 화면과 세션 갱신 |
| `lib/client/` | 날짜 표시, 예시 데이터, API 클라이언트 |
| `lib/domain/calendar.ts` | 입력 검증과 반복 일정 전개 |
| `lib/server/firebase-token.ts`, `app-auth.ts` | Firebase 토큰·계정 검증, 세션, 명시적 기존 계정 연결 |
| `lib/server/calendar-service.ts` | 인증·권한 확인과 D1 요청 |
| `app/api/` | API 경로 |
| `db/schema.ts`, `drizzle/` | 스키마와 마이그레이션 |
| `tests/`, `scripts/smoke-firebase-auth.mjs` | 도메인·서명 토큰·로컬 Auth 통합 검증 |

화면은 React·TypeScript로 작성했으며 Vinext·Vite·Cloudflare Workers를 사용합니다.

## 라이선스

저장소 전체에 대한 별도 라이선스는 아직 지정하지 않았습니다. 포함된 외부 코드의 라이선스 고지는 각 파일과 함께 유지합니다.

- [Sites Vite 플러그인 MIT 고지](scripts/vite/sites-vite-plugin.LICENSE)
- [shadcn 스타일 MIT 고지](vendor/shadcn-tailwind-4.13.0.LICENSE.md)
