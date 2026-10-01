# 실제 인증은 서버 세션과 영속 인증 전환 경계를 함께 연결한다

Phase 1 데모를 실제 인증으로 전환할 때 JWT나 로그인 endpoint만 연결하는 대신, SQLite 서버 세션과 브라우저 흐름·전환 결과·세대별 세션/복구 쿠키를 하나의 인증 경계로 구현한다. 이는 [#7 확정 결정](https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962)과 이를 명시적으로 보완한 [#23 확정 결정](https://github.com/DomineYH/vibe_coding_archive/issues/23#issuecomment-5806449465)의 계승 기록이며, Web Lock 해제나 응답 취소만으로 늦은 쿠키 반영을 막을 수 없어 추가 왕복·영속 상태·지원 환경 제한을 받아들인 선택이다. 고정 쿠키명으로 되돌리거나 복구 경계를 나중에 붙이는 선택은 인증 격리·이미 저장된 흐름의 호환성을 깨뜨리므로, [실제 인증 계획](../plans/login-real-auth.md)의 슬라이스별 검증을 마친 뒤 기능을 활성화한다.
