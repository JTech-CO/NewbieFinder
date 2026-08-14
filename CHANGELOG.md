# 변경 이력 (Changelog)

이 파일의 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 번호는 [유의적 버전(SemVer)](https://semver.org/lang/ko/)을 따릅니다.

버전 증가 기준은 다음과 같습니다.

- **Major**: 데이터 소스, 권한, 제품 동작의 비호환 변경
- **Minor**: 필터·정렬·화면 기능 추가
- **Patch**: 버그 수정, 응답 어댑터 수정, 디자인 보정

비공식 API 경로가 바뀌는 것만으로도 기존 버전이 동작하지 않을 수 있으므로, 어댑터 수정은 긴급 Patch로 배포할 수 있습니다.

---

## [Unreleased]

### 변경됨 (Changed)

실기기 확인 후의 디자인 기준선 수정입니다. 백서 14장의 시각 명세를 다음과 같이 대체합니다.

- **팔레트를 세 색으로 축소했습니다.** 검정 `#000000`, 흰색 `#FFFFFF`, 형광 초록 `#00FFA3` 만 사용합니다.
  중간 회색은 검정과 흰색 사이의 단계로만 둡니다. 백서 14.2 의 민트 계열 뉴트럴과
  Semantic 색(`#FF4D67` LIVE, `#F6C85F` 경고, `#FF6B6B` 오류, `#72B7FF` 안내)은 더 이상 쓰지 않습니다.
- **상태를 색이 아니라 형태로 구분합니다.** 색을 세 가지로 줄인 결과 경고와 오류를 색으로 나눌 수 없게 되어,
  오류는 두꺼운 실선 경계, 부분 결과·이전 데이터는 파선 경계, 안내는 얇은 실선으로 구분합니다.
  아이콘과 문구는 그대로 함께 제공합니다. 색만으로 상태를 전달하지 않는다는 원칙(백서 5.3 / 18.1)에는
  오히려 더 잘 맞습니다.
- **모서리 반경을 낮췄습니다.** 배지·버튼·입력이 알약 모양으로 보이던 문제를 고쳤습니다.
  배지·컨트롤 6px, 패널 12px, 카드 10px 입니다. `--radius-pill` 은 두께 4px 안팎의
  얇은 바(진행률, 스켈레톤 줄)에만 남겼습니다. 스위치 손잡이와 슬라이더 손잡이, 채널 이미지도
  원형에서 모서리를 다듬은 사각형으로 바꿨습니다.
- **결과 카드 크기를 통일했습니다.** 카테고리 이름이 길면 메타가 두 줄로 넘어가 그 카드만 키가 커지던
  문제를 고쳤습니다. 메타는 한 줄로 고정하고, 그리드는 `align-items: start` 대신 `stretch` 와
  `grid-auto-rows: 1fr` 을 씁니다.
- **대비를 재검증했습니다.** 새 회색 단계가 WCAG 2.2 AA 에 미달해 보조 텍스트를 `#8A8A8A`(약 5.7:1),
  컨트롤 경계를 `#666666`(약 3.45:1)으로 올렸습니다. (NFR-006 / WCAG 1.4.11)

---

## [1.0.0] - 2026-08-11

최초 릴리스입니다. Chrome 웹 스토어에는 2026-08-13 에 게시했습니다.

- 스토어: <https://chromewebstore.google.com/detail/lnlmioalekmppmpcmaehbpfmglaaakdh>

### 추가됨 (Added)

- 치지직 도메인(`https://chzzk.naver.com`)에서만 툴바 아이콘을 활성화하는 `declarativeContent` 규칙 (FR-001)
- 아이콘 클릭 시 확장 내부 Finder 페이지를 새 탭으로 여는 동작. 팝업을 사용하지 않습니다. (FR-002)
- 현재 라이브 목록 탐색과 점진적 결과 표시 (FR-003)
- 시청자 수 상한 필터 `1~30명` (FR-004)
- 팔로워 수 상한 필터 `1~100명` (FR-005)
- 두 조건을 동시에 켰을 때의 AND 결합 (FR-006)
- 시청자 또는 팔로워 조건이 켜져 있을 때만 사용할 수 있는 최근 시작 순 정렬 (FR-007)
- `chrome.storage.sync` 기반 설정 저장과 복원 (FR-008)
- 탐색 진행률, 탐색 범위, 부분 결과 사유 표시 (FR-009)
- 수동 새로고침과 20초 쿨다운 (FR-010)
- 결과 카드에서 `https://chzzk.naver.com/{channelId}` 를 새 탭으로 여는 동작. 외부 링크에 `noopener`, `noreferrer`를 적용합니다. (FR-011)
- 네트워크 실패 시 유효 캐시 폴백과 진단 가능한 오류 상태 (FR-012)
- 성인 방송(`adult === true`) 제외 (FR-013)
- `liveId` 1차 키, `channelId` 2차 키 기준 중복 제거 (FR-014)
- 탐색 예산(라이브 페이지 20, 채널 조회 300, 동시성 4)과 `계속 탐색` 이어받기
- 라이브 캐시(신선 45초 / 오래됨 5분), 채널 캐시(신선 15분 / 오래됨 24시간)
- 다크 테마와 반응형 라이브 카드 그리드
- 문서: `README.md`, `docs/reference/` 아래의 `PRIVACY.md`, `PERMISSIONS.md`, `QA_CHECKLIST.md`, `ARCHITECTURE.md`, `CONTRACT_RISK.md`

### 보안 (Security)

- 요청 권한을 `declarativeContent`, `storage`, `https://api.chzzk.naver.com/*` 세 가지로 제한했습니다. (FR-015)
- 모든 API 요청에 `credentials: "omit"`, `redirect: "error"`, `referrerPolicy: "no-referrer"` 를 명시합니다. 브라우저 기본 동작에 의존하지 않습니다.
- Content Script, `cookies`, `scripting`, `activeTab`, `tabs`, `webRequest`, `identity` 권한을 사용하지 않습니다.
- 확장 페이지 CSP를 `script-src 'self'` 로 고정하고 `unsafe-eval`, `unsafe-inline` 을 넣지 않았습니다. 원격 코드, CDN 스크립트, 원격 폰트를 로드하지 않습니다.
- `innerHTML`, `dangerouslySetInnerHTML` 을 사용하지 않고 React 텍스트 노드로만 렌더링합니다.
- 썸네일은 `*.pstatic.net`, `*.akamaized.net` 허용 목록을 통과한 HTTPS URL만 렌더링하고 나머지는 로컬 대체 이미지로 처리합니다.
- 채널 ID는 `^[0-9a-f]{32}$` 패턴 검증을 통과한 경우에만 링크로 만듭니다.
- 분석·광고·오류 수집 SDK를 포함하지 않으며, 디버그 로그에 원시 응답이나 요청 헤더를 남기지 않습니다.

### 알려진 제약 (Known Limitations)

- 공식 Open API가 아닌 치지직 웹 클라이언트용 응답에 의존하므로, 사전 공지 없는 변경으로 기능이 멈출 수 있습니다.
- 팔로워 조건만 켠 경우 `latest` 전략을 사용하며, 이때 결과는 항상 부분 결과입니다.
- 팔로워 수 조회에 실패한 채널은 조건을 충족한 것으로 추정하지 않고 `확인 실패` 로 분리합니다.
- OR 결합 필터, 카테고리 필터, 결과 내보내기(CSV/JSON)는 v1 범위에 포함되지 않습니다.

---

## 확인된 데이터 계약

M0 계약 검증에서 **2026-08-11 실측**으로 확인한 사실입니다. 이 값들은 공식 계약이 아니며 사전 공지 없이 바뀔 수 있습니다.
각 항목이 깨졌을 때의 증상·감지 방법·대응은 [`CONTRACT_RISK.md`](./docs/reference/CONTRACT_RISK.md)에 정리했습니다.

### 라이브 목록: `GET /service/v1/lives`

| 항목 | 실측 결과 |
|---|---|
| 응답 | `200`, JSON. 로그인 쿠키 없이(`credentials: "omit"`) 공개 데이터를 반환합니다. |
| `size` 상한 | **50**. 50을 넘겨 요청하면 데이터가 늘어나는 대신 **빈 배열**이 돌아옵니다. 따라서 페이지 크기를 50 이상으로 올리지 않습니다. |
| 기본 정렬 | `sortType` 을 지정하지 않으면 **시청자 수 내림차순**입니다. |
| 페이지네이션 | `content.page.next` = `{ concurrentUserCount, liveId }` 형태의 **keyset 커서**입니다. 기본 정렬에서 커서는 `(concurrentUserCount, liveId)` 내림차순 키셋으로 동작합니다. |
| 시드 커서 | 커서를 `{ concurrentUserCount: 시청자상한 + 1, liveId: 0 }` 로 시드하면 조건을 만족하는 구간의 첫 항목부터 바로 받을 수 있음을 확인했습니다. 이 성질이 `viewer-tail` 탐색 전략의 근거입니다. |
| `sortType=LATEST` | 시작 시각 내림차순으로 동작합니다. 시청자 수로 구간을 좁힐 수 없으므로 결과는 항상 부분 결과입니다. |
| `openDate` | 오프셋 없는 `YYYY-MM-DD HH:mm:ss` 형식이며, 한국 표준시(UTC+09:00) 벽시계 값임을 확인했습니다. 어댑터 한 곳에서만 오프셋을 붙입니다. |

### 존재하지 않는 경로: `GET /service/v2/lives`

- **`404`.** `v2` 라이브 목록 엔드포인트는 존재하지 않습니다.
- 확인되지 않은 버전 경로를 자동으로 순회 시도하지 않습니다. 경로 후보를 무차별 대입하는 동작은 넣지 않습니다.

### 채널 정보: `GET /service/v1/channels/{channelId}`

| 항목 | 실측 결과 |
|---|---|
| 응답 | `200`, JSON. `content.followerCount` 가 포함됩니다. |
| 존재하지 않는 채널 | **`404`가 아니라 `200` 과 함께 `followerCount: 0` 자리표시자 응답을 반환합니다.** 이때 `content.channelId` 가 `null` 이거나 요청한 ID와 다릅니다. |
| 자리표시자 대응 | 응답의 `channelId` 를 요청한 ID와 대조해 다르면 `unknown-channel` 로 분류합니다. **이 경우의 `0` 을 "팔로워 0명"으로 해석하지 않습니다.** 잘못 해석하면 존재하지 않는 채널이 모든 팔로워 조건을 통과하게 됩니다. |
| `followerCount` 누락·음수 | 기본값으로 채워 숨기지 않고 `CHANNEL_SCHEMA_CHANGED` 계약 오류로 올립니다. |

### 계약 검증 원칙

- 실제 API를 호출하는 계약 검증(`npm run contract:live`)은 **수동 실행 전용**입니다. CI에서 고빈도로 호출하지 않습니다.
- 검증 실패가 접근 제한을 의미하는 경우 우회하지 않습니다. 헤더 위장, CAPTCHA 자동화, `429` 무시 후 재시도를 하지 않습니다.
- 픽스처에는 스키마 검증에 필요한 최소 필드만 남기고 실사용 채널명과 이미지 URL은 익명화합니다.

---

[Unreleased]: https://github.com/JTech-CO/NewbieFinder/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/JTech-CO/NewbieFinder/releases/tag/v1.0.0
