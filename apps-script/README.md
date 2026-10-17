# 과거 Google 로그인 방식 초안 — 설치하지 않음

**최신 배포 대상은 [production/Code.gs](production/Code.gs) 하나입니다.** 개인 PIN 서버와 설치 안내는 [production/README.md](production/README.md)를 사용하세요. 이 폴더 바로 아래의 `.gs`와 아래 설명은 이전 구현을 검증하기 위한 참고 자료이며, 최신 서버와 함께 설치하지 않습니다.

현재 외부 서비스에는 연결하지 않습니다. 질문하기의 실제 모드는 `love-map-asking-v1`, 미리보기는 별도 `love-map-preview-asking-v1` 브라우저 저장소에서 동작합니다. 미리보기는 여보·자기라는 표시 이름과 1일째를 사용하며 실제 이름·기준일은 실제 모드에서 유지합니다. 새로고침과 미리보기 재접속 뒤에도 기록이 유지됩니다. 같은 브라우저의 탭은 저장소와 추첨 기록을 공유하지만, 다른 기기·브라우저 사이의 공유는 Apps Script 연결 후 가능합니다.

## 구현된 화면

- 첫 화면: 기존 제목 아래 `질문 뽑기`, `질문 만들기` 두 버튼.
- 질문 뽑기: 기본 27문제, 한 주기에 중복 없음. 답변하지 않고 돌아가도 보여진 질문은 사용 처리.
- 질문 만들기: 직접 만든 질문을 먼저 저장하고 두 사람의 답변 작성. 기본 질문 추첨 주기에는 영향 없음.
- 여진·민재 답변은 어느 한 계정으로든 두 칸을 모두 작성. 저장 전 초안은 love box에 표시하지 않음.
- love box: `새롭게 알게 된 점`과 `인생과 내면` 분류. 현재 서울 연도·월이 기본 선택됨. 인생과 내면은 각 이름 아래 날짜, 질문, 본인 답변을 표시.

## 저장 데이터

| 필드 | 의미 |
| --- | --- |
| id | 대화 고유 식별자 |
| requestId | 재시도 때 중복 추첨·생성을 막는 식별자 |
| questionId | 기본 질문 식별자, 직접 만든 질문은 null |
| question | 보여진 당시의 질문 문장 |
| cycle | 공통 추첨 주기 번호, 직접 만든 질문은 null |
| answers | 여진·민재 각각의 답변 |
| createdBy / createdById | 질문을 뽑거나 만든 사람의 이름 / Google 사용자 ID |
| createdAt | 생성 시간 |
| savedBy / savedById | 두 답변을 저장한 사람의 이름 / Google 사용자 ID |
| savedAt | 답변 저장 시간, 저장 전에는 null |
| date | 답변을 저장한 서울 날짜, YYYY-MM-DD |

브라우저의 미연결 모드에는 Google 사용자 ID가 없습니다. 그 외의 데이터 형태는 같은 인터페이스를 사용합니다.

## 연결용 파일

- `Questions.gs`: 기존 데이터의 앞 27문제. 마지막 두 문제는 삭제하지 않고 기존 `supabase/schema.sql`에 그대로 남겨 두었으며, 새로운 질문하기 추첨에서는 제외.
- `Code.gs`: 시트 초기화, 공통 추첨, 사용자 인증 확인, 답변 저장 API.
- `appsscript.json`: 서울 시간대 및 시트·Google 토큰 확인에 필요한 권한.
- `src/services/asking-store.js`: 브라우저 저장소와 Apps Script 저장소 어댑터. 화면은 저장 방식과 무관하게 동일한 메서드를 사용.

## Google Sheets 구성

| 시트 | 열 |
| --- | --- |
| AskingQuestions | id, question |
| AskingConversations | id, request_id, data_json |

두 계정 모두 같은 시트를 사용합니다. Script Lock으로 추첨과 기록 생성을 한 번에 하나씩 처리하며, 질문이 나온 시점에 공통 사용 기록을 남깁니다. 27개가 모두 사용되면 다음 추첨부터 새 주기가 시작됩니다. 질문과 답변은 JSON 셀에 보관하여 수식으로 실행되지 않습니다.

## API 계약

모든 요청은 POST JSON 본문을 `text/plain;charset=utf-8`로 전달합니다. 성공은 `{ok:true,data:...}`, 실패는 `{ok:false,error:...}`로 반환합니다. 요청마다 Google ID 토큰을 확인하고 서버에 등록한 두 이메일만 허용합니다. 클라이언트가 전달한 이름은 인증에 사용하지 않습니다.

| action | 추가 요청 데이터 | 반환 |
| --- | --- | --- |
| asking.list | 없음 | 답변이 저장된 대화 목록 |
| asking.draw | requestId | 추첨 질문 초안 |
| asking.create | requestId, question | 직접 만든 질문 초안 |
| asking.save | entryId, answers | 저장된 두 답변 |

이미 저장된 답변에 대한 재시도는 기존 기록을 반환하며 중복 저장하거나 덮어쓰지 않습니다. 직접 만든 질문도 같은 규칙을 따릅니다.

## 모든 기능 완성 후 진행할 연결 단계

1. Google 로그인 방식을 앱 전체에 적용하고 ID 토큰을 메모리에서 제공하도록 연결.
2. 지정한 시트에 Apps Script 파일 추가. Script Properties에 `SPREADSHEET_ID`, `GOOGLE_CLIENT_ID`, `MEMBERS_JSON` 설정. 이메일은 서버 설정에만 보관하며 `MEMBERS_JSON`은 정확히 두 이메일을 각각 `여진`, `민재`로 매핑.
3. `setupLoveMapAsking`을 한 번 실행하여 두 시트를 생성. 기존 시트가 있으면 덮어쓰지 않음.
4. 웹 앱으로 배포하고 현재 브라우저 저장소 대신 `makeAppsScriptAskingStore({endpoint,getIdToken})` 주입.
5. 배포 환경에서 로그인, POST 응답, 두 계정 동시 추첨, 새로고침 뒤 기록 유지 및 기기 간 love box 조회를 실제로 검증.
6. 브라우저 미리보기 기록을 실제 시트로 가져올지는 연결 시 별도 결정. 자동으로 실제 시트에 올리지 않음.

현재는 배포, 인증 연결, 실제 시트 생성·전송을 수행하지 않았습니다. 저장·추첨 테스트는 브라우저 저장소 구현과 Apps Script 서비스 모형을 대상으로 검증했습니다. 앱의 다른 기존 기능에 남아 있는 Supabase 코드는 이번 기능에 사용하지 않으며, 앱 전체 저장 전환은 향후 연결 단계의 범위입니다.

참고: [Apps Script 웹 앱](https://developers.google.com/apps-script/guides/web), [동시 접근 방지](https://developers.google.com/apps-script/reference/lock/lock-service), [Google ID 토큰 확인](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
