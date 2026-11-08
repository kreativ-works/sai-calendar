# 일정 도우미와 기기 연동

2026-11-08 KST 기준 구현 및 검증 범위.

## 현재 제공하는 흐름

사용자 선택 텍스트/기기 받아쓰기 → 실제 모델 추출 → 서버의 일정 후보 검증 → 사용자의 후보 검토·편집·선택 → 기존 캘린더 API로 등록·수정·삭제.

모델 연결이 없으면 명시적으로 미연결 상태와 503 오류를 반환한다. 정규식 결과나 샘플을 AI 결과로 표시하지 않는다. 모델을 연결해도 자동으로 모든 대화·통화 내용을 수집하지 않으며, 이번 버전은 모든 변경에 확인을 받는다. 부분 성공은 항목별로 표시하고 실패만 같은 UUID로 재시도한다. 기존 일정 수정·삭제는 현재 서버 revision 검사를 유지한다.

## 데이터 경계

- 서버가 검증한 가구 일정만 모델의 기존 일정 후보 ID로 허용한다. 타 가구 ID·모델이 지어낸 ID는 거절한다. 기존 메모는 모델에 보내지 않고, 모델의 수정 결과로도 변경하지 않는다. 신규 후보 메모는 서버에서 비운다.
- 원문·모델 응답은 지시가 아닌 데이터로 취급한다. 모델에는 외부 URL을 호출하거나 일정을 직접 저장하는 도구가 없다. 모델 출력만으로 실제 일정이 변경되지 않는다.
- 원문은 분석 요청의 메모리에서만 처리하고 분석 로그·일정 메모에 자동 저장하지 않는다. 별도로 공유받은 내용은 본인에게 귀속된 5분 유효 AES-GCM 암호화 handoff로 전달한다. ID·계정에 암호문을 결합하고 1회 원자 소비한다. 만료된 행은 다음 공유 요청 때 정리되므로 5분 만료는 열람 유효 기간을 뜻한다.
- API 키는 운영자만 저장·삭제할 수 있고, master secret은 Sites 비밀 환경 변수에 둔다. 키를 소스·클라이언트·응답·로그에 넣지 않는다. Gemini/OpenAI 고정 HTTPS 호스트만 사용하고 리디렉션을 따르지 않는다. OpenAI 응답 저장은 비활성화한다. 제공자의 자체 데이터 정책·요금은 별도이다.
- 텍스트6,000 UTF-16자, 후보8개, 모델 컨텍스트 최대100개. 사용자 분당3회·최근24시간20회와 서비스 전체 최근24시간200회 한도를 원자적으로 예약한다. 원문은 한도 테이블에 저장하지 않는다.

## iPhone

Siri는 사용자가 추가한 단축어를 이름으로 실행할 수 있다. `입력 요청`/받아쓰기 → URL 인코딩 → `https://sai.day/assistant#text=...` URL 열기 단축어로 도우미를 연다. 공유 시트에서 받은 텍스트도 같은 방식으로 처리할 수 있다. fragment는 서버 검색어로 전송하지 않고 읽은 직후 지운다. 유효한 Firebase 계정이 남아 있을 때 세션 복구는 fragment를 유지하지만, 새로운 로그인이 필요하면 원문을 로그인 URL에 넣지 않고 단축어 재실행을 안내한다.

PWA manifest만으로 Siri 전용 App Intents가 등록되지는 않는다. 네이티브 앱/확장의 Swift App Intents 구현과 배포가 별도 작업이다. iOS 메시지·메일 개인 자동화는 존재하지만 모든 메신저 대화 DB를 읽는 권한을 뜻하지 않는다. 통화 전사문 공유는 원본 앱과 기기·지역의 지원 범위에 따른다.

- [Siri로 단축어 실행](https://support.apple.com/guide/shortcuts/apd07c25bb38/ios)
- [입력 요청](https://support.apple.com/guide/shortcuts/apd68b5c9161/ios)
- [단축어 URL 열기](https://support.apple.com/guide/shortcuts/apdaf74d75a5/ios)
- [공유 입력 종류](https://support.apple.com/guide/shortcuts/apd7644168e1/ios)
- [App Intents 구조](https://developer.apple.com/videos/play/wwdc2022/10032/)
- [메시지·메일 트리거](https://support.apple.com/guide/shortcuts/apdd711f9dff/ios)
- [iPhone 통화 녹음·전사](https://support.apple.com/guide/iphone/iph57c6590e9/ios)

## Android

Chrome에 설치한 PWA의 Web Share Target을 사용한다. 원본 앱이 내보낸 텍스트만 받아 검토 화면으로 보내며, 로그인·설치 상태와 브라우저의 manifest 반영 시점은 실기기에서 확인해야 한다. 현재 키보드 받아쓰기·공유 입력을 제공하며 Gemini 전용 계정 연결이 완료된 상태는 아니다.

Gemini Connected Apps는 remote MCP+OAuth 경로와 Android AppFunctions 경로를 제공한다. 전자는 기존 서버에 추가할 수 있지만 OAuth 서비스·플랫폼 등록·preview 접근 및 심사가 별도이다. 기존 Firebase Google 로그인 설정만으로 Gemini 연결이 완료되지 않는다. 네이티브 NotificationListenerService는 알림에 노출된 텍스트에 대한 별도 권한이며 전체 채팅 기록이 아니다. SMS/통화기록 권한과 통화 양방향 음원은 플랫폼·Play 정책의 제한을 받는다.

- [Chrome Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
- [WebKit Share Target 이슈](https://bugs.webkit.org/show_bug.cgi?id=194593)
- [Google Connected Apps](https://developers.google.com/connected-apps)
- [계정 연결 OAuth](https://developers.google.com/connected-apps/mcp/oauth)
- [AppFunctions](https://developer.android.com/ai/appfunctions)
- [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [통화 음원 권한](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource)

## 남은 연결과 검증

현재 Sites 정적 자산 계층은 `_headers`의 장기 캐시 선언을 반영하지 않아 서버 응답은 `max-age=0,must-revalidate`로 관찰되었다. 재접속 코드는 서비스 워커에서 동일 출처·공개 해시 JS/CSS만 따로 캐시한다. 정적 코드 요청에는 인증 쿠키를 보내지 않으며, 200/MIME/최종 URL/인증 관련 Vary/개인 캐시 지시 등을 확인한다. 최초 로드가 끝난 뒤 제한된 현재 코드만 예열하고 캐시 실패는 일반 네트워크로 처리한다. 이 캐시는 오프라인 일정 저장·개인 일정 보관을 제공하지 않는다.

- 운영자가 `/admin/ai`에서 실제 API 제공자·모델·키를 연결해야 분석이 활성화된다. 현재 실키·실모델 호출 성공은 검증하지 않았다.
- 실제 아이폰 Siri/단축어·키보드, Android 설치 PWA 공유 메뉴와 OS 버전별 검증은 남아 있다. 브라우저 자동화는 Codex 종료 이력으로 생략한다.
- 모든 통화·메신저의 상시 자동 수집, 확인 없는 자동 일정 변경, 네이티브 App Intents/AppFunctions, Gemini MCP/OAuth 서비스는 이번 버전에 포함하지 않는다. 별도 권한·소스 연결·사용자 정책 확정이 필요하다.
