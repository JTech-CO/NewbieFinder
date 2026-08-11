import type { LiveCursor } from "../../domain/models";

/**
 * 비공식 엔드포인트는 이 파일 밖으로 새지 않는다.
 * 경로가 바뀌면 여기와 schema/adapter 만 고치면 되도록 한다.
 *
 * 2026-08-11 실측 확인
 *  - GET /service/v1/lives            200 JSON, `size` 상한 50 (초과 요청 시 빈 배열)
 *  - GET /service/v1/channels/{id}    200 JSON, followerCount 포함
 *  - GET /service/v2/lives            404 (v2 없음)
 */

export const CHZZK_API_ORIGIN = "https://api.chzzk.naver.com";

/** 응답 상한. 50을 넘겨 요청하면 빈 배열이 오므로 절대 올리지 않는다. */
export const LIVE_PAGE_SIZE = 50;

export type LiveSortType = "LATEST";

export interface LiveListQuery {
  /** keyset 커서. null 이면 첫 페이지 */
  readonly cursor?: LiveCursor | null;
  /**
   * 정렬. 지정하지 않으면 시청자 수 내림차순(기본)이며 커서가 `(시청자 수, liveId)` 키셋으로 동작한다.
   * `LATEST` 는 시작 시각 내림차순이다.
   */
  readonly sortType?: LiveSortType | undefined;
  readonly size?: number;
}

/**
 * 라이브 목록 URL.
 *
 * 기본 정렬(sortType 미지정)에서 커서는 `(concurrentUserCount, liveId)` 내림차순 키셋이다.
 * 따라서 `cursor = { concurrentUserCount: 시청자상한 + 1, liveId: 0 }` 로 시드하면
 * 조건을 만족하는 구간의 첫 항목부터 바로 받을 수 있다. (실측 검증됨)
 */
export function buildLiveListUrl(query: LiveListQuery = {}): URL {
  const url = new URL("/service/v1/lives", CHZZK_API_ORIGIN);
  url.searchParams.set("size", String(query.size ?? LIVE_PAGE_SIZE));
  if (query.sortType) {
    url.searchParams.set("sortType", query.sortType);
  }
  if (query.cursor) {
    url.searchParams.set("concurrentUserCount", String(query.cursor.concurrentUserCount));
    url.searchParams.set("liveId", String(query.cursor.liveId));
  }
  return url;
}

/** 채널 정보(팔로워 수) URL. */
export function buildChannelInfoUrl(channelId: string): URL {
  return new URL(`/service/v1/channels/${encodeURIComponent(channelId)}`, CHZZK_API_ORIGIN);
}

/**
 * 시청자 상한 조건을 만족하는 구간의 시작 커서.
 * `(상한 + 1, 0)` 보다 작은 첫 키 = 시청자 수가 상한인 항목들 중 liveId 최대값.
 */
export function seedCursorForViewerCeiling(viewerMax: number): LiveCursor {
  return { concurrentUserCount: viewerMax + 1, liveId: 0 };
}

/** 요청 URL 이 허용된 API 오리진인지 확인한다. */
export function isAllowedApiUrl(url: URL): boolean {
  return url.origin === CHZZK_API_ORIGIN && url.protocol === "https:";
}
