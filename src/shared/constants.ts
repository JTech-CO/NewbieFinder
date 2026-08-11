/**
 * 제품 전역 상수.
 *
 * 여기 있는 값은 "정책"이다. 매직 넘버를 코드 곳곳에 흩어 두지 않는다.
 * 비공식 API 관련 값(경로·페이지 크기)은 infrastructure/chzzk-web/endpoints.ts 에만 둔다.
 */

export const EXTENSION_NAME = "NewbieFinder";
export const EXTENSION_VERSION = "1.0.0";
export const SETTINGS_SCHEMA_VERSION = 1;
export const CACHE_SCHEMA_VERSION = 1;

/** 치지직 웹 서비스 오리진. 확장 아이콘 활성화 조건과 결과 카드 링크에 사용한다. */
export const CHZZK_WEB_ORIGIN = "https://chzzk.naver.com";
export const CHZZK_WEB_HOST = "chzzk.naver.com";

/** 확장 내부 Finder 페이지 경로 (manifest 기준 상대 경로). */
export const FINDER_PAGE_PATH = "finder/index.html";

export const VIEWER_FILTER_RANGE = {
  min: 1,
  max: 30,
  fallback: 10,
} as const;

export const FOLLOWER_FILTER_RANGE = {
  min: 1,
  max: 100,
  fallback: 50,
} as const;

/**
 * 탐색 예산.
 * 예산에 도달했는데 다음 커서가 남아 있으면 상태는 `partial` 이 된다.
 */
export const DISCOVERY_BUDGET = {
  /** 한 번의 실행에서 요청할 라이브 목록 페이지 수 상한 */
  maxLivePagesPerRun: 20,
  /** 한 번의 실행에서 조회할 채널(팔로워) 수 상한 */
  maxChannelLookupsPerRun: 300,
  /** 채널 조회 동시성 상한 */
  channelConcurrency: 4,
  /** 수동 새로고침 쿨다운 */
  refreshCooldownMs: 20_000,
} as const;

/** 네트워크 요청 정책. 재시도는 우회가 아니라 일시 오류 복구 범위에 한정한다. */
export const REQUEST_POLICY = {
  timeoutMs: 8_000,
  maxRetries429: 2,
  maxRetries5xx: 1,
  baseBackoffMs: 600,
  maxBackoffMs: 5_000,
  /** Retry-After 가 이 값을 넘으면 재시도하지 않고 RATE_LIMITED 로 중단한다. */
  maxHonoredRetryAfterMs: 30_000,
} as const;

export const CACHE_TTL = {
  liveFreshMs: 45_000,
  liveStaleMs: 5 * 60_000,
  channelFreshMs: 15 * 60_000,
  channelStaleMs: 24 * 60 * 60_000,
} as const;

/** 캐시 용량 상한. `unlimitedStorage` 를 쓰지 않으므로 스스로 잘라야 한다. */
export const CACHE_LIMITS = {
  maxChannelEntries: 2_000,
  maxLiveCandidates: 1_500,
} as const;

/** chrome.storage 키. 문자열 오타를 막기 위해 한곳에서 관리한다. */
export const STORAGE_KEYS = {
  /** chrome.storage.sync */
  settings: "nf.settings.v1",
  /** chrome.storage.local */
  liveCache: "nf.cache.lives.v1",
  channelCache: "nf.cache.channels.v1",
  /** chrome.storage.local: 1회성 안내 닫힘 여부 */
  dismissedNotices: "nf.ui.dismissedNotices.v1",
  /** chrome.storage.session */
  refreshLock: "nf.session.refreshLock.v1",
} as const;

/**
 * 채널 ID 형식. 실측 응답 기준 32자리 소문자 16진수.
 * 검증에 실패하면 링크를 만들지 않고 후보에서 제외한다.
 */
export const CHANNEL_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * 렌더링을 허용하는 이미지 호스트 접미사.
 * manifest 의 `img-src` CSP 와 반드시 같은 범위를 유지해야 한다.
 */
export const ALLOWED_IMAGE_HOST_SUFFIXES = [".pstatic.net", ".akamaized.net"] as const;

/** 썸네일 URL 템플릿의 `{type}` 자리에 넣을 크기. */
export const THUMBNAIL_TYPE = "480";

/** 로컬 대체 이미지 (public/images). */
export const THUMBNAIL_FALLBACK_SRC = "/images/thumbnail-fallback.svg";

/**
 * 헤더 로고. 툴바에 뜨는 확장 아이콘과 같은 파일을 쓴다.
 * 화면용 도형을 따로 그리면 아이콘과 로고가 조금씩 어긋나므로 원본 하나만 둔다.
 * 128px 원본을 축소해 고해상도 화면에서도 선명하게 보이게 한다.
 */
export const BRAND_MARK_SRC = "/icons/icon-128.png";

/**
 * 치지직 `openDate` 는 오프셋 없는 `YYYY-MM-DD HH:mm:ss` 형식이며
 * 실측 결과 한국 표준시(UTC+9) 벽시계 값이다. 한곳에서만 정의한다.
 */
export const CHZZK_OPEN_DATE_UTC_OFFSET = "+09:00";

/** 상대 시간 표시를 갱신하는 공유 클럭 주기. 카드마다 타이머를 두지 않는다. */
export const RELATIVE_CLOCK_INTERVAL_MS = 60_000;
