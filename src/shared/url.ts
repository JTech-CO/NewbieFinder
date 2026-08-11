import {
  ALLOWED_IMAGE_HOST_SUFFIXES,
  CHANNEL_ID_PATTERN,
  CHZZK_WEB_ORIGIN,
  THUMBNAIL_TYPE,
} from "./constants";

/**
 * URL 안전 규칙.
 *
 * - 탐색 링크는 코드에서 생성한다. API 응답의 임의 URL 을 클릭 대상으로 신뢰하지 않는다.
 * - 이미지 URL 은 allowlist 를 통과한 HTTPS 만 렌더링한다.
 */

export function isValidChannelId(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_ID_PATTERN.test(value);
}

/**
 * 결과 카드가 여는 치지직 채널 주소. 응답 값이 아니라 코드에서 조립한다.
 * 채널 ID 형식이 어긋나면 null 을 반환하고 링크를 만들지 않는다.
 */
export function buildChannelUrl(channelId: string): string | null {
  if (!isValidChannelId(channelId)) return null;
  return `${CHZZK_WEB_ORIGIN}/${channelId}`;
}

function parseHttpsUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "https:" ? url : null;
}

/** allowlist 에 있는 HTTPS 이미지 호스트인지 확인한다. */
export function isAllowedImageUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  const url = parseHttpsUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOST_SUFFIXES.some(
    (suffix) => host.endsWith(suffix) && host.length > suffix.length,
  );
}

/**
 * 라이브 썸네일 URL 정규화.
 *
 * 실측 응답은 `.../thumbnail/image_{type}.jpg` 형태의 템플릿을 준다.
 * `{type}` 을 지원되는 크기 문자열로 치환한 뒤 allowlist 를 통과한 것만 반환한다.
 * 치환 후에도 `{` 가 남아 있으면 알 수 없는 템플릿이므로 버린다.
 */
export function resolveThumbnailUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const replaced = raw.replaceAll("{type}", THUMBNAIL_TYPE);
  if (replaced.includes("{") || replaced.includes("}")) return null;
  return isAllowedImageUrl(replaced) ? replaced : null;
}

/** 채널 프로필 이미지. 빈 문자열을 자주 주므로 별도로 걸러 낸다. */
export function resolveChannelImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return isAllowedImageUrl(raw) ? raw : null;
}
