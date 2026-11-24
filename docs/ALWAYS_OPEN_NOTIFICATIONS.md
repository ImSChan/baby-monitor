# 새 알림 없이 알림 목록 열기

신고된 현상: 새 알림이 있을 때만 목록을 열 수 있음. 확인한 이전 소스의 Link 자체에는 미확인 개수에 따른 차단 조건이 없어 실제 Android 기기에서의 원인은 확정하지 못했다.

상단 진입점을 눈에 보이는 종 아이콘+알림 글자의 명시적 button으로 변경하고 React Router navigate('/notifications')를 항상 실행한다. enabled/loading/error/unreadCount에 따라 버튼을 숨기거나 비활성화하지 않는다. 자식 아이콘·문구·빨간 점은 pointer-events-none으로 두어 버튼 전체가 터치 대상이다. 빨간 점만 미확인 개수에 따라 표시한다. 목록·읽음 API나 데이터는 변경하지 않았다.

검증: 프런트엔드 25개 파일/107개 테스트 통과. 알림 0, 수신 끔, 설정 로딩, 설정 조회 오류, 모두 읽음, 미확인 있음, Provider 준비 전 7가지 상황에서 실제 라우터 이동을 검증했다. 로컬 실제 Edge(390×844, hasTouch) + 임시 SQLite에서 알림 0개인 종 아이콘 부위를 tap해 빈 목록 진입, 수신 비활성 상태 진입, 합성 알림 2개 모두 읽은 뒤 목록 재진입을 확인했다. 가로 넘침 없음. 실제 Android 실기기 현상 재현은 미실행이다.

Vite android build / cap sync 성공. Android v1.14/versionCode15로 갱신한다. 이전 APK의 내장 자산이 실행 중일 수 있으므로 새 APK 설치 또는 Android Studio에서 최신 소스 build/sync 후 실행이 필요하다. 운영 DB/백엔드 변경이나 마이그레이션은 없다.

Gradle assembleDebug 성공. v1.14 debug APK 생성.
