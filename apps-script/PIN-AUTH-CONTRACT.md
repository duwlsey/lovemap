# 개인 PIN 인증 계약

최신 서버는 production/Code.gs입니다. 개인 PIN 규칙은 로컬 시제품과 공유하며 인증·커플 권한은 서버가 검증합니다. 상위 Code.gs의 Google 로그인 방식은 과거 초안이므로 설치하지 않습니다. 실제 웹 앱 배포와 두 기기 검증은 배포 URL이 발급된 뒤 진행합니다.

## 데이터

- Couples: id, startedOn, inviteHash, inviteExpiresAt, 과거 공유 코드 해시.
- Members: id, pairId, slot, displayName, PIN 검증값, recoveryHash.
- Sessions: tokenHash, memberId, pairId, expiresAt, revokedAt.
- AuthAttempts: 회원별 PIN 실패 횟수·대기 시간, 연결·복구 시도 실패 횟수.

화면의 이름과 내부 역할 ID를 분리합니다. 기존 데이터의 두 역할 키는 내부적으로 여진·민재이지만 화면에는 등록한 이름을 보여줍니다. 이름과 가입 순서에 관계없이 본인 기록이 왼쪽·실선에 옵니다.

| 메서드 | 입력 | 결과 |
| --- | --- | --- |
| create | name, pin, inviteCode, startedOn | 개인 세션, 개인 복구 코드, 연결 코드 |
| join | name, pin, inviteCode | 별도 개인 세션, 별도 개인 복구 코드 |
| unlock | 기억한 memberId, pin | 해당 개인 세션 |
| changePin | sessionToken, currentPin, newPin | 갱신한 본인 세션 |
| recover | recoveryCode, newPin | 해당 회원의 새 세션·새 복구 코드 |
| renewRecovery | sessionToken, currentPin | 새 개인 복구 코드 |
| renewInvite | sessionToken, currentPin, inviteCode | 연결 전 커플의 새 연결 코드 |
| getSession | sessionToken | 확인된 memberId, pairId, slot, displayName, names, startedOn, linked |
| logout | sessionToken | 해당 세션 폐기 |

연결 코드는 커플 연결에만 사용합니다. 입장, 개인 PIN 변경, 계정 복구에는 사용할 수 없습니다. 개인 PIN은 상대 PIN·공유 코드와 다르게 정합니다. 같은 공간은 두 회원만 포함하며 연결 완료 후 연결 코드를 만료시킵니다.

## 서버 구현 조건

1. PIN 검증, 해시 처리, 시도 제한, 코드 만료를 서버에서 처리합니다. 브라우저의 로컬 해시·입력 제한을 서버 인증으로 간주하지 않습니다.
2. 이름·slot·pairId를 클라이언트가 보냈다는 이유로 신뢰하지 않고 개인 세션에서 확인합니다.
3. 질문·게임·점검·답변·기록을 세션의 pairId 안으로 제한합니다.
4. PIN 변경·복구는 해당 회원의 세션만 만료시킵니다. 복구 코드는 한 번 사용하면 다시 발급합니다.
5. 시트 자체를 공개하지 않습니다. PIN·연결 코드·복구 코드 원문을 시트나 로그에 저장하지 않습니다.
6. 연결·추첨·게임 수를 잠금 아래에서 처리합니다. 연결 코드로 세 번째 사람을 추가할 수 없어야 합니다.
7. 새 기기에서는 개인 복구 코드로 본인 계정을 확인합니다. 커플 연결 코드만으로 상대 계정에 들어갈 수 없어야 합니다.

현재 테스트는 로컬 규칙과 배포용 서버를 Google API 모의 환경에서 검증합니다. 실제 Apps Script 실행·배포 권한·기기 간 연결은 별도 검증이 필요합니다. 실제 저장 시트에는 테스트 계정·답변을 넣지 않습니다.
