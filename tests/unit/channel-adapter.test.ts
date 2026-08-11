import { describe, expect, it } from "vitest";

import { DiscoveryError } from "../../src/domain/errors";
import type { DiscoveryErrorCode } from "../../src/domain/errors";
import { adaptChannelInfo } from "../../src/infrastructure/chzzk-web/channel-adapter";
import changedChannel from "../fixtures/channel.changed.json";
import unknownChannel from "../fixtures/channel.unknown.json";
import validChannel from "../fixtures/channel.valid.json";

const CHANNEL_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_CHANNEL_ID = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

type JsonObject = Record<string, unknown>;

function clone(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function contentOf(envelope: JsonObject): JsonObject {
  return envelope["content"] as JsonObject;
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

describe("adaptChannelInfo - 정상", () => {
  it("요청한 채널과 응답이 일치하면 팔로워 수를 확정합니다", () => {
    const result = adaptChannelInfo(validChannel, CHANNEL_ID);

    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(result.channelId).toBe(CHANNEL_ID);
    expect(result.followerCount).toBe(34);
    expect(result.verified).toBe(false);
    expect(result.openLive).toBe(true);
    expect(result.channelImageUrl).toBeNull();
  });

  it("팔로워 0명도 확정 값으로 다룹니다", () => {
    const raw = clone(validChannel);
    contentOf(raw)["followerCount"] = 0;

    const result = adaptChannelInfo(raw, CHANNEL_ID);
    if (result.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(result.followerCount).toBe(0);
  });

  it("소수 팔로워 수는 반올림합니다", () => {
    const raw = clone(validChannel);
    contentOf(raw)["followerCount"] = 34.6;

    const result = adaptChannelInfo(raw, CHANNEL_ID);
    if (result.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(result.followerCount).toBe(35);
  });

  it("allowlist 를 통과한 프로필 이미지만 남깁니다", () => {
    const allowed = clone(validChannel);
    contentOf(allowed)["channelImageUrl"] = "https://nng-phinf.pstatic.net/example/profile_a.jpg";
    const allowedResult = adaptChannelInfo(allowed, CHANNEL_ID);
    if (allowedResult.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(allowedResult.channelImageUrl).toBe(
      "https://nng-phinf.pstatic.net/example/profile_a.jpg",
    );

    const blocked = clone(validChannel);
    contentOf(blocked)["channelImageUrl"] = "https://evil.example/profile.jpg";
    const blockedResult = adaptChannelInfo(blocked, CHANNEL_ID);
    if (blockedResult.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(blockedResult.channelImageUrl).toBeNull();
  });

  it("openLive 가 없으면 null 로 둡니다", () => {
    const raw = clone(validChannel);
    delete contentOf(raw)["openLive"];

    const result = adaptChannelInfo(raw, CHANNEL_ID);
    if (result.kind !== "resolved") throw new Error("resolved 결과를 기대했습니다.");
    expect(result.openLive).toBeNull();
  });
});

describe("adaptChannelInfo - 알 수 없는 채널", () => {
  it("자리표시자 응답의 followerCount 0 을 팔로워 0명으로 오해하지 않습니다", () => {
    const result = adaptChannelInfo(unknownChannel, CHANNEL_ID);
    expect(result).toEqual({ kind: "unknown-channel", channelId: CHANNEL_ID });
  });

  it("응답 channelId 가 요청과 다르면 알 수 없는 채널로 다룹니다", () => {
    const result = adaptChannelInfo(validChannel, OTHER_CHANNEL_ID);
    expect(result).toEqual({ kind: "unknown-channel", channelId: OTHER_CHANNEL_ID });
  });

  it("content 가 null 이면 알 수 없는 채널로 다룹니다", () => {
    const raw = clone(validChannel);
    raw["content"] = null;
    expect(adaptChannelInfo(raw, CHANNEL_ID)).toEqual({
      kind: "unknown-channel",
      channelId: CHANNEL_ID,
    });
  });
});

describe("adaptChannelInfo - 계약 파손", () => {
  it("followerCount 가 사라지면 기본값으로 메우지 않고 오류로 올립니다", () => {
    expectDiscoveryError(
      () => adaptChannelInfo(changedChannel, CHANNEL_ID),
      "CHANNEL_SCHEMA_CHANGED",
    );
  });

  it("followerCount 가 null 이어도 오류로 올립니다", () => {
    const raw = clone(validChannel);
    contentOf(raw)["followerCount"] = null;
    expectDiscoveryError(() => adaptChannelInfo(raw, CHANNEL_ID), "CHANNEL_SCHEMA_CHANGED");
  });

  it("followerCount 가 음수이면 오류로 올립니다", () => {
    const raw = clone(validChannel);
    contentOf(raw)["followerCount"] = -1;
    expectDiscoveryError(() => adaptChannelInfo(raw, CHANNEL_ID), "CHANNEL_SCHEMA_CHANGED");
  });

  it("followerCount 가 숫자가 아니면 오류로 올립니다", () => {
    const raw = clone(validChannel);
    contentOf(raw)["followerCount"] = "34";
    expectDiscoveryError(() => adaptChannelInfo(raw, CHANNEL_ID), "CHANNEL_SCHEMA_CHANGED");
  });

  it("봉투 구조가 깨지면 오류로 올립니다", () => {
    expectDiscoveryError(() => adaptChannelInfo(null, CHANNEL_ID), "CHANNEL_SCHEMA_CHANGED");
    expectDiscoveryError(() => adaptChannelInfo("<html>", CHANNEL_ID), "CHANNEL_SCHEMA_CHANGED");
    expectDiscoveryError(
      () => adaptChannelInfo({ content: { followerCount: 3 } }, CHANNEL_ID),
      "CHANNEL_SCHEMA_CHANGED",
    );
  });

  it("code 가 200 이 아니면 응답 오류로 다룹니다", () => {
    const raw = clone(validChannel);
    raw["code"] = 500;
    expectDiscoveryError(() => adaptChannelInfo(raw, CHANNEL_ID), "INVALID_RESPONSE");
  });
});
