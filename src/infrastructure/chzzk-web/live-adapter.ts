import { parseOpenDate } from "../../domain/date";
import { DiscoveryError } from "../../domain/errors";
import type { LiveCursor, StreamCandidate } from "../../domain/models";
import { isValidChannelId, resolveChannelImageUrl, resolveThumbnailUrl } from "../../shared/url";
import { liveItemSchema, liveListEnvelopeSchema } from "./live-schema";

/**
 * 원시 라이브 응답 → 도메인 모델.
 *
 * 실패 정책
 *  - 봉투 구조가 깨졌다 → LIVE_SCHEMA_CHANGED 로 즉시 중단한다. 기본값으로 메우지 않는다.
 *  - 항목이 있는데 단 하나도 통과하지 못했다 → 항목 스키마가 바뀐 것으로 보고 중단한다.
 *  - 일부 항목만 실패했다 → 그 항목만 버리고 진단 카운트에 남긴다.
 */

export interface LivePageResult {
  readonly items: StreamCandidate[];
  readonly nextCursor: LiveCursor | null;
  /** 스키마를 통과하지 못한 항목 수 */
  readonly droppedItems: number;
  /** openDate 를 해석하지 못한 항목 수 */
  readonly unparsedDates: number;
  /** 응답이 돌려준 원시 항목 수 */
  readonly rawCount: number;
}

export function adaptLivePage(raw: unknown, fetchedAt: number): LivePageResult {
  const envelope = liveListEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new DiscoveryError("LIVE_SCHEMA_CHANGED", { cause: envelope.error });
  }

  const { code, content } = envelope.data;
  if (code !== 200) {
    throw new DiscoveryError("INVALID_RESPONSE", { status: code });
  }

  const items: StreamCandidate[] = [];
  let droppedItems = 0;
  let unparsedDates = 0;

  for (const rawItem of content.data) {
    const candidate = adaptLiveItem(rawItem, fetchedAt);
    if (candidate === null) {
      droppedItems += 1;
      continue;
    }
    if (candidate.startedAtEpoch === null) unparsedDates += 1;
    items.push(candidate);
  }

  // 항목이 왔는데 전부 실패했다면 개별 항목 문제가 아니라 계약 변경이다.
  if (content.data.length > 0 && items.length === 0) {
    throw new DiscoveryError("LIVE_SCHEMA_CHANGED");
  }

  const next = content.page?.next ?? null;

  return {
    items,
    nextCursor: next ? { concurrentUserCount: next.concurrentUserCount, liveId: next.liveId } : null,
    droppedItems,
    unparsedDates,
    rawCount: content.data.length,
  };
}

/**
 * 항목 하나를 변환한다. 도메인에 넣을 수 없으면 null.
 *
 * 버리는 조건
 *  - 스키마 불일치
 *  - channelId 형식 위반 (링크를 만들 수 없고 캐시 키로도 못 쓴다)
 *  - 음수 시청자 수 (의미를 추정하지 않는다)
 */
export function adaptLiveItem(raw: unknown, fetchedAt: number): StreamCandidate | null {
  const parsed = liveItemSchema.safeParse(raw);
  if (!parsed.success) return null;

  const item = parsed.data;

  if (!isValidChannelId(item.channel.channelId)) return null;
  if (!Number.isInteger(item.concurrentUserCount) || item.concurrentUserCount < 0) return null;

  const liveId = String(item.liveId);
  if (liveId.length === 0) return null;

  return {
    liveId,
    channelId: item.channel.channelId,
    channelName: item.channel.channelName,
    channelImageUrl: resolveChannelImageUrl(item.channel.channelImageUrl),
    liveTitle: item.liveTitle,
    thumbnailUrl:
      resolveThumbnailUrl(item.liveImageUrl) ?? resolveThumbnailUrl(item.defaultThumbnailImageUrl),
    viewerCount: item.concurrentUserCount,
    followerCount: null,
    followerState: "idle",
    startedAtRaw: item.openDate,
    startedAtEpoch: parseOpenDate(item.openDate),
    adult: item.adult,
    verified: item.channel.verifiedMark === true,
    categoryName: normalizeCategory(item.liveCategoryValue),
    sourceFetchedAt: fetchedAt,
  };
}

function normalizeCategory(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
