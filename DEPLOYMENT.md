# Google 저장소와 GitHub Pages 연결

## 현재 준비된 것

프런트엔드와 개인 PIN 방식 Apps Script 서버 코드를 준비했습니다. 저장 시트에는 LoveMapData 헤더만 생성하며 테스트 계정·기록은 넣지 않습니다. 서버와 실제 기기 사이의 동작은 Apps Script 배포 후 확인해야 합니다.

## 다음 순서

1. 시트에서 확장 프로그램 → Apps Script를 엽니다.
2. [production 설치 안내](apps-script/production/README.md)에 따라 **production/Code.gs 하나**를 붙여 넣고 SPREADSHEET_ID 속성을 설정합니다.
3. setupLoveMap 함수를 실행하고 소유자 계정으로 권한을 승인합니다.
4. 웹 앱을 실행 사용자 '나', 액세스 권한 '모든 사용자'로 배포합니다. 시트 자체는 비공개로 둡니다.
5. 발급된 /exec 주소를 GitHub 저장소 Settings → Secrets and variables → Actions → Variables의 VITE_APPS_SCRIPT_URL에 저장합니다.
6. Settings → Pages → Source에서 GitHub Actions를 선택합니다.
7. Actions → Deploy to GitHub Pages → Run workflow를 실행합니다.

게시 경로는 /lovemap/입니다. 배포 작업은 자동 실행하지 않고 수동으로 실행합니다. API 주소가 없는 정식 빌드는 실제 계정 생성 대신 연결 준비 안내를 표시하며 미리보기는 사용할 수 있습니다.

## 게시 후 확인

휴대폰에서 첫 가입, 컴퓨터에서 상대방 연결, 서로 다른 기기의 PIN 재입장·답변 공유·질문 순서·메모 작성자·미니게임 차례를 확인합니다. 새 기기는 개인 복구 코드로 연결합니다. 다른 커플과 기록이 분리되는지도 검사합니다.

현재 로컬 테스트는 이 규칙을 Google API 모의 환경에서 검증합니다. 실제 Apps Script 실행·권한·CORS 응답과 실기기 동작을 검증한 상태로 오해하지 마세요.

## 비밀 정보

PIN·복구 코드·세션 원문은 시트나 GitHub에 저장하지 않습니다. 서버 비밀 키는 Apps Script 속성에 둡니다. VITE_APPS_SCRIPT_URL은 공개되는 API 주소이며 비밀번호가 아닙니다. localhost에서 만든 테스트 데이터는 브라우저에만 있고 실제 배포로 옮기지 않습니다.
