# 아키텍처 (Architecture)

- 대상 제품: NewbieFinder v1.0.0
- 최종 갱신일: 2026-08-11
- 근거: 백서 4장(아키텍처 및 로직), 6.1(계층 의존성), M0 계약 검증(2026-08-11 실측)

이 문서는 NewbieFinder가 **어떻게 라이브를 찾는지**, 그리고 **왜 그렇게 찾는지**를 설명합니다. 특히 백서 초안의 단일 `LATEST` 전략이 구현 단계에서 두 전략으로 나뉜 이유를 기록합니다.

> **‘백서 N.N’ 표기에 관하여**
> `docs/` 안의 몇몇 문서에 `백서 4.6.6` 같은 표기가 남아 있습니다.
> 구현의 출발점이 된 「NewbieFinder 통합 기술·디자인 백서 v1.0.0」의 절 번호이며,
> 그 문서는 스토어 배포 준비 과정에서 저장소에서 제외했습니다.
> 소스 주석에서는 따라갈 수 없는 인용을 모두 걷어냈고, 결정의 배경과 근거는
> 이 문서, `docs/CONTRACT_RISK.md`, `CHANGELOG.md`에 옮겨 두었으므로 원문 없이도 읽을 수 있습니다.

---

## 1. 런타임 구성

```text
 ┌────────────────────────────────────────────┐
 │ https://chzzk.naver.com/*                  │
 │  URL 조건만 확인합니다. DOM 접근이 없습니다.  │
 └───────────────────┬────────────────────────┘
                     │ 툴바 아이콘 클릭
                     ▼
 ┌────────────────────────────────────────────┐
 │ Background Service Worker                  │
 │  · declarativeContent 규칙 등록             │
 │  · Finder 새 탭 생성                        │
 │  · 설치·업데이트 시 설정 마이그레이션         │
 │  · 데이터 탐색은 하지 않습니다.               │
 └───────────────────┬────────────────────────┘
                     │ chrome.tabs.create
                     ▼
 ┌────────────────────────────────────────────┐
 │ Finder Extension Page (React)              │
 │  UI ─ Reducer ─ Selectors                  │
 │        │                                   │
 │        ├─ Discovery Orchestrator           │
 │        │    ├─ Request Budget              │
 │        │    ├─ Follower Resolver           │
 │        │    └─ Chzzk Client (schema/adapter)│
 │        └─ chrome.storage (설정 · 캐시)       │
 └───────────────────┬────────────────────────┘
                     │ HTTPS 읽기 전용 GET
                     ▼
 ┌────────────────────────────────────────────┐
 │ https://api.chzzk.naver.com/service/v1/*   │
 │  치지직 웹 클라이언트용 비공식 응답            │
 └────────────────────────────────────────────┘
```

Service Worker는 의도적으로 얇습니다. 장시간 탐색, 페이지네이션, 대규모 캐시 처리를 Service Worker에 두면 MV3의 종료·부활 주기와 얽혀 상태 추적이 어려워집니다. 네트워크와 UI를 같은 탭에서 처리하므로 Background와의 지속 메시징도 필요하지 않습니다.

```text
Background → Finder : 새 탭 생성만
Finder → Storage    : 설정·캐시 읽기/쓰기
Finder → CHZZK API  : 직접 fetch
```

---

## 2. 계층 구조

```text
                     finder/  (React UI · Reducer · Selectors)
                          │
                          │ 호출
                          ▼
                  application/  (오케스트레이션 · 예산 · 팔로워 큐)
                          │
                          │ 호출
                          ▼
   ┌──────────────────► domain/ ◄──────────────────┐
   │                (순수 규칙 · 모델)                │
   │  의존                                      변환  │
   │                                                 │
shared/  (상수 · URL 검증)              infrastructure/
                                    (fetch · zod · chrome.storage)
```

의존 방향은 한 줄로 요약됩니다.

```text
finder → application → domain ← infrastructure
```

| 계층 | 담당 | 금지 |
|---|---|---|
| `domain` | 필터·정렬·설정 정규화·날짜 파싱·오류 모델 | Chrome API, React, Zod, fetch를 import하지 않습니다. |
| `application` | 탐색 순서, 예산 집행, 팔로워 조회 큐, 부분 결과 판정 | DOM과 React에 의존하지 않습니다. |
| `infrastructure` | HTTP, 런타임 스키마 검증, 어댑터, `chrome.storage` | 도메인 규칙(필터 판정 등)을 재구현하지 않습니다. |
| `finder` | 렌더링, 사용자 입력, 접근성 | 네트워크를 직접 호출하지 않습니다. 스냅샷만 보고 그립니다. |
| `shared` | 정책 상수, URL 허용 목록, 결과 타입 | 어떤 계층도 하위로 끌어내리지 않습니다. |

이 방향을 지키는 실질적 이유는 **비공식 API가 바뀌었을 때 수정 범위를 좁히기 위해서**입니다 (NFR-007). 엔드포인트 문자열은 `infrastructure/chzzk-web/endpoints.ts` 한 파일에만 존재하고, 응답 해석은 스키마와 어댑터에서 끝납니다. 경로나 필드가 바뀌어도 도메인·애플리케이션·UI는 손대지 않습니다.

---

## 3. 탐색 전략 두 가지

활성화된 조건이 전략을 결정합니다.

```ts
function selectStrategy(settings: FinderSettings): ScanStrategy {
  return settings.viewerFilter.enabled ? "viewer-tail" : "latest";
}
```

| 전략 | 사용 조건 | 정렬 파라미터 | 결과 완전성 |
|---|---|---|---|
| `viewer-tail` | 시청자 조건 ON (팔로워 조건 병행 가능) | `sortType` 미지정 = 시청자 수 내림차순 | 커서를 소진하면 해당 구간을 빠짐없이 훑었다고 말할 수 있습니다. |
| `latest` | 시청자 조건 OFF, 팔로워 조건만 ON | `sortType=LATEST` | 항상 부분 결과입니다. |

### 3.1. `viewer-tail`: 시드 커서로 조건 구간만 훑기

M0 계약 검증에서 확인한 사실이 이 전략의 근거입니다.

- `GET /service/v1/lives` 의 **기본 정렬은 시청자 수 내림차순**입니다.
- `content.page.next` 는 `{ concurrentUserCount, liveId }` 형태의 **keyset 커서**이며, 기본 정렬에서 이 쌍의 내림차순으로 동작합니다.
- 따라서 커서를 임의의 값으로 **시드**하면 목록의 중간부터 바로 읽을 수 있습니다.

```ts
// infrastructure/chzzk-web/endpoints.ts
function seedCursorForViewerCeiling(viewerMax: number): LiveCursor {
  return { concurrentUserCount: viewerMax + 1, liveId: 0 };
}
```

`(상한 + 1, 0)` 보다 작은 첫 키는 "시청자 수가 상한인 항목들 중 `liveId` 가 가장 큰 것"입니다. 즉 **조건을 만족하는 구간의 첫 항목**입니다.

```text
서버 기본 정렬 = 시청자 수 내림차순 (전체 라이브)

  12,431명  ┐
   ...      │  관심 없는 구간.
      11명  ┘  시드 커서 덕분에 이 구간은 한 페이지도 받지 않습니다.
 ─────────────  시드 커서 = (viewerMax + 1, 0)   ※ 예: viewerMax = 10
      10명  ┐
       ...  │  조건 만족 구간. 받아 온 항목이 전부 결과 후보가 됩니다.
       0명  ┘
 ─────────────  page.next == null → coverage.exhausted = true
```

이 구조의 장점은 세 가지입니다.

1. **수율 100%.** 응답으로 받은 모든 항목이 시청자 조건을 통과합니다. 버려지는 응답이 없으므로 같은 예산으로 훨씬 깊게 훑습니다.
2. **정직한 완전성 주장.** 커서가 소진되면 "이 조건 구간은 빠짐없이 봤다"고 말할 수 있습니다. 이때만 부분 결과 배너를 내립니다.
3. **진행률의 의미가 분명함.** 다음 커서의 시청자 수 + 1이 곧 "여기까지는 전부 확인했다"는 경계값(`viewerFrontier`)입니다.

```ts
// application/discovery-events.ts
function computeViewerFrontier(nextCursor: LiveCursor | null): number {
  return nextCursor === null ? 0 : nextCursor.concurrentUserCount + 1;
}
```

### 3.2. `latest`: 최근 시작 순으로 훑기

시청자 조건이 꺼져 있으면 시청자 수로 구간을 좁힐 수 없습니다. 팔로워 수는 라이브 목록 응답에 없고 채널을 개별 조회해야만 알 수 있으므로, 서버 정렬로 미리 좁힐 방법이 없습니다.

이때는 `sortType=LATEST` 로 최근 시작한 방송부터 훑습니다. 예산이 허용하는 범위까지만 보게 되므로 **결과는 언제나 부분 결과**이며, `partialReason = "latest-strategy"` 로 그 사실을 화면에 명시합니다.

```text
시작 시각 내림차순 (전체 라이브)

  방금 시작  ┐
    ...     │  예산이 닿는 만큼만 훑습니다.
            │  각 후보의 팔로워 수는 채널을 따로 조회해야 알 수 있습니다.
  예산 소진  ┘
 ─────────────  아래는 보지 못했습니다 → 항상 partial
    ...
```

### 3.3. 왜 단일 `LATEST` 전략에서 바뀌었나

백서 초안(4.4.1)은 라이브 목록을 언제나 `sortType=LATEST` 로 읽는 단일 전략이었습니다. M0 계약 검증에서 실제 응답을 확인한 뒤 다음 이유로 두 전략으로 나눴습니다.

| 항목 | 단일 `LATEST` | `viewer-tail` 도입 후 |
|---|---|---|
| 수율 | 대부분의 응답 항목이 시청자 조건에서 탈락합니다. 인기 방송이 섞여 들어옵니다. | 받아 온 항목이 전부 조건을 통과합니다. |
| 완전성 | 전체 라이브를 훑은 적이 없으므로 항상 부분 결과입니다. | 조건 구간을 소진하면 완전 탐색을 정직하게 주장할 수 있습니다. |
| 예산 효율 | 페이지 20장(최대 1,000건)을 써도 조건 통과 후보가 몇 건에 그칠 수 있습니다. | 같은 20장이 전부 조건 통과 후보입니다. |
| 팔로워 조회 | 조건에 걸리지도 않을 채널까지 조회할 위험이 있습니다. | 시청자 조건을 먼저 통과한 후보만 조회합니다. |
| 사용자 문구 | "부분 결과"만 반복 노출됩니다. | 상황에 맞는 정확한 문구를 쓸 수 있습니다. |

핵심은 성능이 아니라 **정직함**입니다. 이 제품의 성공 기준은 결과를 많이 보여주는 것이 아니라 잘못된 완전성을 주장하지 않는 것입니다. 시드 커서는 "이 조건 구간은 빠짐없이 봤다"는 문장을 기술적으로 뒷받침해 주는 유일한 방법이었습니다.

`latest` 전략을 남겨 둔 이유는, 팔로워 조건만 켠 경우 서버 정렬로 좁힐 방법이 없기 때문입니다. 이 경우를 억지로 완전 탐색인 것처럼 다루지 않고 부분 결과로 명시합니다.

---

## 4. 탐색 파이프라인

```text
 Finder 진입 / 새로고침
        │
        ▼
 ① 캐시 확인 ─────────────► 신선하면 즉시 렌더 (dataOrigin = cache-fresh)
        │
        ▼
 ② 전략 선택 (viewer-tail | latest)
        │
        ▼
 ③ 라이브 목록 루프  ◄──── 예산: maxLivePages
        │   · 스키마 검증 → 어댑터 → StreamCandidate
        │   · 성인 방송 제외 · 중복 제거(liveId → channelId)
        │   · 커서 갱신 · coverage 갱신
        │   · 스냅샷 방출 (최소 120ms 간격)
        ▼
 ④ 팔로워 판정 (조건 ON일 때만)  ◄──── 예산: maxChannelLookups
        │   · 대상 = 성인 아님 + followerState "idle" + 시청자 상한 이하
        │   · 캐시 우선 → 남은 것만 네트워크 (동시성 4)
        │   · 하나 확정될 때마다 스냅샷 방출
        │   · 429/403/오프라인 → 남은 큐를 흘려보내고 중단
        ▼
 ⑤ 최종 필터·정렬 → 부분 결과 사유 판정 → 캐시 저장
        │
        ▼
 ⑥ resume 토큰 반환 (커서가 남아 있으면 `계속 탐색` 활성화)
```

중요한 순서 규칙이 하나 있습니다. **팔로워 조회 대상은 시청자 조건을 이미 통과한 후보로 한정합니다.** 판정에 쓰이지도 않을 채널을 조회하는 것은 요청 낭비이자 서버에 대한 실례입니다.

---

## 5. 요청 예산

팔로워 조건은 후보 1건당 채널 요청 1건을 유발합니다. 그래서 예산은 두 축을 함께 조입니다.

```ts
// shared/constants.ts
const DISCOVERY_BUDGET = {
  maxLivePagesPerRun: 20,      // 한 번의 실행에서 받을 라이브 페이지 수
  maxChannelLookupsPerRun: 300, // 한 번의 실행에서 조회할 채널 수
  channelConcurrency: 4,        // 채널 조회 동시성
  refreshCooldownMs: 20_000,    // 수동 새로고침 쿨다운
};
```

```text
팔로워 조건 OFF
  maxLivePages    = 20            (페이지당 50건 → 최대 1,000건)
  maxChannelLookups = 0

팔로워 조건 ON
  maxChannelLookups = 300
  maxLivePages      = min(20, ceil(300 / 50)) = 6
                       └─ 판정하지도 못할 후보를 잔뜩 받아 오지 않습니다.
```

`LIVE_PAGE_SIZE = 50` 은 실측으로 확인한 서버 상한입니다. 50을 넘겨 요청하면 데이터가 늘어나는 대신 빈 배열이 돌아오므로 절대 올리지 않습니다.

예산에 걸렸는데 다음 커서가 남아 있으면 상태를 `partial` 로 두고 `계속 탐색` 버튼을 제공합니다. 이어받기는 `DiscoveryResumeToken`(커서 + coverage + 누적 카운트)으로 처리하며, **같은 예산과 같은 캐시를 그대로 적용합니다.** 버튼을 반복해서 눌러도 요청 제한이 느슨해지지 않습니다.

---

## 6. 캐시

| 캐시 | 신선(Fresh) | 오래됨(Stale) 허용 | 저장소 |
|---|---:|---:|---|
| 라이브 페이지 | 45초 | 5분 | `chrome.storage.local` |
| 채널 팔로워 | 15분 | 24시간 | `chrome.storage.local` |
| 썸네일 | 브라우저 HTTP 캐시 | 서버 정책 | 확장이 별도 보관하지 않습니다 |
| 설정 | 만료 없음 | 해당 없음 | `chrome.storage.sync` |

```text
 진입
   │
   ├─ Fresh 있음 ──► 즉시 렌더 (cache-fresh) ──► 백그라운드 갱신
   │                                              ├─ 성공 → network 로 교체
   │                                              └─ 실패 → 캐시 유지 + 오류 배지
   ├─ Stale만 있음 ► 즉시 렌더 (cache-stale)  ──► 백그라운드 갱신
   │                 "이전 데이터 · 8분 전 갱신"    ├─ 성공 → network 로 교체
   │                                              └─ 실패 → 이전 데이터 고지 유지
   └─ 없음 ────────► Skeleton ─────────────────► 성공 → 실시간 결과
                                                 실패 → Error State
```

`dataOrigin` (`none` / `network` / `cache-fresh` / `cache-stale`)을 상태에 담아 UI로 올립니다. **캐시를 실시간 데이터처럼 보이게 하지 않기 위한 값**이며, 이 값 없이는 "몇 분 전 갱신"을 정확히 쓸 수 없습니다.

`unlimitedStorage` 를 쓰지 않으므로 용량은 스스로 자릅니다 (채널 2,000건, 라이브 후보 1,500건).

---

## 7. 부분 결과 판정

"전체를 찾았다"고 잘못 말하지 않기 위한 핵심 로직입니다. 사유는 우선순위대로 **하나만** 고릅니다.

```text
 followerHalt == RATE_LIMITED                    → "rate-limit"
 followerHalt == NETWORK_OFFLINE                 → "network"
 errorCode    == RATE_LIMITED                    → "rate-limit"
 errorCode    == NETWORK_OFFLINE | REQUEST_TIMEOUT → "network"
 라이브 페이지 요청 실패                            → "network"
 예산 때문에 시도조차 못한 채널 있음                 → "channel-budget"
 예산 소진 + 다음 커서 남음                         → "page-budget" | "channel-budget"
 전략 == latest                                   → "latest-strategy"
 그 외                                            → null  (완전 탐색)
```

`null` 이 나오는 경우는 실질적으로 하나뿐입니다. **`viewer-tail` 전략으로 커서를 끝까지 소진했고, 예산에도 걸리지 않았고, 실패한 요청이 없는 경우.** 이때만 부분 결과 배너를 내립니다.

최종 `phase` 는 다음과 같이 정합니다.

```text
 후보 0건 + errorCode 있음        → "error"
 partialReason 또는 errorCode 있음 → "partial"
 그 외                            → "ready"
```

---

## 8. 실패 처리 원칙

### 8.1. 계약이 깨지면 멈춥니다

응답 필드가 사라지거나 형태가 바뀌면 기본값으로 채워 화면을 유지하지 않습니다. `LIVE_SCHEMA_CHANGED`, `INVALID_RESPONSE` 는 결과 그리드를 숨기고 진단 코드를 보여 줍니다 (`hidesResults: true`). 잘못된 데이터를 정상 결과처럼 보여주는 것이 아무것도 안 보여주는 것보다 나쁩니다 (NFR-002).

`CHANNEL_SCHEMA_CHANGED` 는 팔로워 정보만 못 쓰는 상황이므로 시청자 조건 결과는 그대로 보여 줍니다.

### 8.2. 팔로워 미확인을 조건 충족으로 추정하지 않습니다

| 팔로워 조건 | `followerState` | 결과 |
|---|---|---|
| OFF | 어느 상태든 | 다른 조건으로 판단합니다. |
| ON | `ready` + 상한 이하 | 포함 |
| ON | `ready` + 상한 초과 | 제외 |
| ON | `idle` / `loading` | 판정 대기 (결과 그리드가 아닌 대기 카운트로 표시) |
| ON | `failed` | 결과에 포함하지 않고 `확인 실패` 로 분리합니다. |

여기에 실측으로 확인한 함정이 하나 더 있습니다. **존재하지 않는 채널도 `404` 가 아니라 `200` 과 함께 `followerCount: 0` 자리표시자를 반환합니다.** 이 `0` 을 팔로워 수로 받아들이면 존재하지 않는 채널이 모든 팔로워 조건을 통과합니다. 그래서 어댑터에서 응답의 `channelId` 를 요청한 ID와 대조해 다르면 `unknown-channel` 로 분류합니다.

### 8.3. 우회하지 않습니다

`429`, `403` 을 만나면 남은 큐를 흘려보내고 즉시 멈춥니다. `Retry-After` 가 있으면 존중하되, 30초를 넘으면 재시도하지 않고 `RATE_LIMITED` 로 중단합니다. 재시도는 우회 수단이 아니라 일시 오류 복구 범위(429 최대 2회, 5xx 최대 1회)에 한정합니다.

헤더 위장, CAPTCHA 자동화, 무한 재시도는 구현하지 않습니다. 자세한 내용은 [`CONTRACT_RISK.md`](./CONTRACT_RISK.md)에 있습니다.

---

## 9. 상태 불변식

두 기본 조건이 모두 꺼지면 최근 시작 순도 꺼집니다. 이 규칙은 UI에서만이 아니라 Reducer와 Selector 어디로 값이 들어와도 동일하게 강제됩니다.

```ts
// domain/settings.ts
function enforceSettingsInvariants(settings: FinderSettings): FinderSettings {
  const recentFirst = isBaseFilterActive(settings) && settings.recentFirst;
  if (recentFirst === settings.recentFirst) return settings;
  return { ...settings, recentFirst };
}
```

최근 시작 순을 단독 탐색 기준으로 허용하지 않는 이유는, 방송을 막 시작한 대형 채널이 결과를 지배해 제품의 목적이 무너지기 때문입니다.

---

## 10. 관측 가능성

외부 telemetry를 사용하지 않습니다. 개발 모드에서만 구조화된 디버그 이벤트(`event`, `at`, `durationMs`, `pageIndex`, `status`, `errorCode`)를 남기며, 다음은 어떤 경우에도 로그에 남기지 않습니다.

- 원시 API 응답 전체
- 쿠키와 요청 헤더
- 사용자의 IP나 계정 식별 정보
- 썸네일 URL의 일회성 파라미터 전체
- 브라우저 방문 기록
