import { describe, expect, it } from "vitest";

import { DiscoveryError } from "../../src/domain/errors";
import type { DiscoveryErrorCode } from "../../src/domain/errors";
import type { StreamCandidate } from "../../src/domain/models";
import { adaptLiveItem, adaptLivePage } from "../../src/infrastructure/chzzk-web/live-adapter";
import { THUMBNAIL_TYPE } from "../../src/shared/constants";
import changedPage from "../fixtures/live-page.changed.json";
import lastPage from "../fixtures/live-page.last.json";
import validPage from "../fixtures/live-page.valid.json";

const FETCHED_AT = Date.parse("2026-08-11T03:00:00+09:00");

type JsonObject = Record<string, unknown>;

function clone(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function contentOf(page: JsonObject): JsonObject {
  return page["content"] as JsonObject;
}

function dataOf(page: JsonObject): JsonObject[] {
  return contentOf(page)["data"] as JsonObject[];
}

function itemAt(page: JsonObject, index: number): JsonObject {
  const item = dataOf(page)[index];
  if (item === undefined) throw new Error(`픽스처에 ${index}번 항목이 없습니다.`);
  return item;
}

function requireAt(items: readonly StreamCandidate[], index: number): StreamCandidate {
  const item = items[index];
  if (item === undefined) throw new Error(`결과에 ${index}번 항목이 없습니다.`);
  return item;
}

function expectDiscoveryError(run: () => unknown, code: DiscoveryErrorCode): void {
  let thrown: unknown;
  let didThrow = false;
  try {
    run();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  expect(didThrow).toBe(true);
  expect(thrown).toBeInstanceOf(DiscoveryError);
  expect((thrown as DiscoveryError).code).toBe(code);
}

describe("adaptLivePage - 정상 변환", () => {
  it("픽스처의 모든 항목을 도메인 모델로 옮깁니다", () => {
    const result = adaptLivePage(validPage, FETCHED_AT);

    expect(result.rawCount).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.droppedItems).toBe(0);
    expect(result.unparsedDates).toBe(0);
  });

  it("첫 항목의 필드를 정확히 매핑합니다", () => {
    const first = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 0);

    expect(first.liveId).toBe("20476569");
    expect(first.channelId).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(first.channelName).toBe("채널A");
    expect(first.liveTitle).toBe("첫 방송입니다 잘 부탁드려요");
    expect(first.viewerCount).toBe(3);
    expect(first.adult).toBe(false);
    expect(first.verified).toBe(false);
    expect(first.categoryName).toBe("테스트 게임 A");
    expect(first.sourceFetchedAt).toBe(FETCHED_AT);
  });

  it("팔로워 정보는 조회 전이므로 미확인 상태로 둡니다", () => {
    const first = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 0);
    expect(first.followerCount).toBeNull();
    expect(first.followerState).toBe("idle");
  });

  it("원본 openDate 를 보존하면서 한국 표준시로 해석합니다", () => {
    const first = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 0);
    expect(first.startedAtRaw).toBe("2026-08-11 00:11:17");
    expect(first.startedAtEpoch).toBe(Date.parse("2026-08-11T00:11:17+09:00"));
  });

  it("썸네일 템플릿의 {type} 을 치환합니다", () => {
    const first = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 0);
    expect(first.thumbnailUrl).toBe(
      `https://livecloud-thumb.akamaized.net/chzzk/livecloud/example-a/thumbnail/image_${THUMBNAIL_TYPE}.jpg`,
    );
    expect(first.thumbnailUrl).not.toContain("{type}");
  });

  it("liveImageUrl 이 없으면 기본 썸네일로 대체합니다", () => {
    const second = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 1);
    expect(second.thumbnailUrl).toBe("https://ssl.pstatic.net/example/default_thumbnail_480.jpg");
  });

  it("빈 문자열 채널 이미지를 null 로 정리합니다", () => {
    const items = adaptLivePage(validPage, FETCHED_AT).items;
    expect(requireAt(items, 0).channelImageUrl).toBeNull();
    expect(requireAt(items, 1).channelImageUrl).toBe(
      "https://nng-phinf.pstatic.net/example/profile_b.jpg",
    );
    expect(requireAt(items, 2).channelImageUrl).toBeNull();
  });

  it("성인 방송 표시와 인증 표시를 그대로 옮깁니다", () => {
    const third = requireAt(adaptLivePage(validPage, FETCHED_AT).items, 2);
    expect(third.adult).toBe(true);
    expect(third.verified).toBe(true);
    expect(third.categoryName).toBeNull();
  });
});

describe("adaptLivePage - 커서", () => {
  it("다음 커서를 파싱합니다", () => {
    const result = adaptLivePage(validPage, FETCHED_AT);
    expect(result.nextCursor).toEqual({ concurrentUserCount: 7, liveId: 20476565 });
  });

  it("커서를 소진한 마지막 페이지는 null 입니다", () => {
    const result = adaptLivePage(lastPage, FETCHED_AT);
    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(2);
  });

  it("page 자체가 없으면 null 입니다", () => {
    const raw = clone(validPage);
    delete contentOf(raw)["page"];
    expect(adaptLivePage(raw, FETCHED_AT).nextCursor).toBeNull();
  });

  it("page 가 null 이어도 null 입니다", () => {
    const raw = clone(validPage);
    contentOf(raw)["page"] = null;
    expect(adaptLivePage(raw, FETCHED_AT).nextCursor).toBeNull();
  });

  it("시청자 0명 항목도 그대로 후보로 남깁니다", () => {
    const items = adaptLivePage(lastPage, FETCHED_AT).items;
    expect(items.map((item) => item.viewerCount)).toEqual([1, 0]);
  });
});

describe("adaptLivePage - 계약 파손", () => {
  it("content 가 없으면 스키마 변경으로 중단합니다", () => {
    const raw = clone(validPage);
    delete raw["content"];
    expectDiscoveryError(() => adaptLivePage(raw, FETCHED_AT), "LIVE_SCHEMA_CHANGED");
  });

  it("content 가 null 이면 스키마 변경으로 중단합니다", () => {
    const raw = clone(validPage);
    raw["content"] = null;
    expectDiscoveryError(() => adaptLivePage(raw, FETCHED_AT), "LIVE_SCHEMA_CHANGED");
  });

  it("content.data 가 배열이 아니면 스키마 변경으로 중단합니다", () => {
    const raw = clone(validPage);
    contentOf(raw)["data"] = { "0": "항목" };
    expectDiscoveryError(() => adaptLivePage(raw, FETCHED_AT), "LIVE_SCHEMA_CHANGED");
  });

  it("응답 자체가 객체가 아니면 스키마 변경으로 중단합니다", () => {
    expectDiscoveryError(() => adaptLivePage(null, FETCHED_AT), "LIVE_SCHEMA_CHANGED");
    expectDiscoveryError(() => adaptLivePage("<html>", FETCHED_AT), "LIVE_SCHEMA_CHANGED");
    expectDiscoveryError(() => adaptLivePage([], FETCHED_AT), "LIVE_SCHEMA_CHANGED");
  });

  it("항목에서 필수 필드가 사라져 전부 실패하면 스키마 변경으로 중단합니다", () => {
    expectDiscoveryError(() => adaptLivePage(changedPage, FETCHED_AT), "LIVE_SCHEMA_CHANGED");
  });

  it("code 가 200 이 아니면 응답 오류로 다룹니다", () => {
    const raw = clone(validPage);
    raw["code"] = 404;
    expectDiscoveryError(() => adaptLivePage(raw, FETCHED_AT), "INVALID_RESPONSE");
  });

  it("항목이 없는 정상 응답은 오류가 아닙니다", () => {
    const raw = clone(validPage);
    contentOf(raw)["data"] = [];
    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.items).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.droppedItems).toBe(0);
  });
});

describe("adaptLivePage - 개별 항목 실패", () => {
  it("일부 항목만 깨졌으면 그 항목만 버리고 셉니다", () => {
    const raw = clone(validPage);
    dataOf(raw).push({ liveId: 1 });

    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.rawCount).toBe(4);
    expect(result.items).toHaveLength(3);
    expect(result.droppedItems).toBe(1);
  });

  it("음수 시청자 수 항목은 의미를 추정하지 않고 버립니다", () => {
    const raw = clone(validPage);
    itemAt(raw, 0)["concurrentUserCount"] = -1;

    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.items).toHaveLength(2);
    expect(result.droppedItems).toBe(1);
    expect(result.items.some((item) => item.liveId === "20476569")).toBe(false);
  });

  it("정수가 아닌 시청자 수 항목도 버립니다", () => {
    const raw = clone(validPage);
    itemAt(raw, 0)["concurrentUserCount"] = 3.5;
    expect(adaptLivePage(raw, FETCHED_AT).droppedItems).toBe(1);
  });

  it("채널 ID 형식이 어긋난 항목은 링크를 만들 수 없으므로 버립니다", () => {
    const raw = clone(validPage);
    (itemAt(raw, 0)["channel"] as JsonObject)["channelId"] = "NOT-A-CHANNEL-ID";

    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.items).toHaveLength(2);
    expect(result.droppedItems).toBe(1);
  });

  it("openDate 해석 실패는 제외 사유가 아니라 진단 카운트입니다", () => {
    const raw = clone(validPage);
    itemAt(raw, 0)["openDate"] = "언제인지 알 수 없음";

    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.items).toHaveLength(3);
    expect(result.droppedItems).toBe(0);
    expect(result.unparsedDates).toBe(1);

    const first = requireAt(result.items, 0);
    expect(first.startedAtEpoch).toBeNull();
    expect(first.startedAtRaw).toBe("언제인지 알 수 없음");
  });

  it("허용되지 않은 호스트의 썸네일은 버리고 항목은 남깁니다", () => {
    const raw = clone(validPage);
    itemAt(raw, 0)["liveImageUrl"] = "https://evil.example/image_{type}.jpg";

    const result = adaptLivePage(raw, FETCHED_AT);
    expect(result.items).toHaveLength(3);
    expect(requireAt(result.items, 0).thumbnailUrl).toBeNull();
  });
});

describe("adaptLiveItem", () => {
  it("정상 항목을 변환합니다", () => {
    const item = adaptLiveItem(itemAt(clone(validPage), 1), FETCHED_AT);
    expect(item).not.toBeNull();
    expect(item?.liveId).toBe("20476512");
    expect(item?.viewerCount).toBe(12);
  });

  it("문자열 liveId 도 받아들입니다", () => {
    const raw = itemAt(clone(validPage), 0);
    raw["liveId"] = "20476569";
    expect(adaptLiveItem(raw, FETCHED_AT)?.liveId).toBe("20476569");
  });

  it("스키마를 통과하지 못하면 null 입니다", () => {
    expect(adaptLiveItem(null, FETCHED_AT)).toBeNull();
    expect(adaptLiveItem({}, FETCHED_AT)).toBeNull();
    expect(adaptLiveItem("항목", FETCHED_AT)).toBeNull();
  });

  it("channel 이 없으면 null 입니다", () => {
    const raw = itemAt(clone(validPage), 0);
    delete raw["channel"];
    expect(adaptLiveItem(raw, FETCHED_AT)).toBeNull();
  });
});
