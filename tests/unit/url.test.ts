import { describe, expect, it } from "vitest";

import {
  buildChannelUrl,
  isAllowedImageUrl,
  isValidChannelId,
  resolveChannelImageUrl,
  resolveThumbnailUrl,
} from "../../src/shared/url";
import { CHZZK_WEB_ORIGIN, THUMBNAIL_TYPE } from "../../src/shared/constants";

const VALID_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("isValidChannelId", () => {
  it("32자리 소문자 16진수만 통과시킵니다", () => {
    expect(isValidChannelId(VALID_ID)).toBe(true);
    expect(isValidChannelId("0".repeat(32))).toBe(true);
    expect(isValidChannelId("f".repeat(32))).toBe(true);
  });

  it("길이가 다르면 거부합니다", () => {
    expect(isValidChannelId("a".repeat(31))).toBe(false);
    expect(isValidChannelId("a".repeat(33))).toBe(false);
    expect(isValidChannelId("")).toBe(false);
  });

  it("대문자와 16진수가 아닌 문자를 거부합니다", () => {
    expect(isValidChannelId(VALID_ID.toUpperCase())).toBe(false);
    expect(isValidChannelId("g".repeat(32))).toBe(false);
    expect(isValidChannelId(`${VALID_ID.slice(0, 31)}-`)).toBe(false);
  });

  it("문자열이 아닌 값을 거부합니다", () => {
    expect(isValidChannelId(null)).toBe(false);
    expect(isValidChannelId(undefined)).toBe(false);
    expect(isValidChannelId(12345)).toBe(false);
    expect(isValidChannelId({ channelId: VALID_ID })).toBe(false);
  });
});

describe("buildChannelUrl", () => {
  it("코드에서 조립한 치지직 HTTPS 주소를 돌려줍니다", () => {
    expect(buildChannelUrl(VALID_ID)).toBe(`${CHZZK_WEB_ORIGIN}/${VALID_ID}`);
    expect(buildChannelUrl(VALID_ID)?.startsWith("https://chzzk.naver.com/")).toBe(true);
  });

  it("형식이 어긋난 채널 ID 에는 링크를 만들지 않습니다", () => {
    expect(buildChannelUrl("")).toBeNull();
    expect(buildChannelUrl("not-a-channel-id")).toBeNull();
    expect(buildChannelUrl(VALID_ID.toUpperCase())).toBeNull();
    expect(buildChannelUrl(`${VALID_ID}?next=https://evil.example`)).toBeNull();
    expect(buildChannelUrl("../../evil")).toBeNull();
    expect(buildChannelUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("isAllowedImageUrl", () => {
  it("allowlist 호스트의 HTTPS 주소를 허용합니다", () => {
    expect(isAllowedImageUrl("https://livecloud-thumb.akamaized.net/a/image_480.jpg")).toBe(true);
    expect(isAllowedImageUrl("https://nng-phinf.pstatic.net/a/profile.jpg")).toBe(true);
    expect(isAllowedImageUrl("https://SSL.PSTATIC.NET/a/b.jpg")).toBe(true);
  });

  it("HTTP 는 거부합니다", () => {
    expect(isAllowedImageUrl("http://nng-phinf.pstatic.net/a/profile.jpg")).toBe(false);
  });

  it("allowlist 밖의 호스트를 거부합니다", () => {
    expect(isAllowedImageUrl("https://example.com/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://pstatic.net/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://akamaized.net/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://notakamaized.net/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://pstatic.net.evil.example/a.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://evil.example/?x=.pstatic.net")).toBe(false);
  });

  it("HTTPS 가 아닌 스킴을 거부합니다", () => {
    expect(isAllowedImageUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBe(false);
    expect(isAllowedImageUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedImageUrl("chrome-extension://abc/image.png")).toBe(false);
  });

  it("문자열이 아니거나 비어 있으면 거부합니다", () => {
    expect(isAllowedImageUrl("")).toBe(false);
    expect(isAllowedImageUrl(null)).toBe(false);
    expect(isAllowedImageUrl(undefined)).toBe(false);
    expect(isAllowedImageUrl(42)).toBe(false);
    expect(isAllowedImageUrl("그냥 문자열")).toBe(false);
  });
});

describe("resolveThumbnailUrl", () => {
  it("{type} 자리를 지원되는 크기로 치환합니다", () => {
    const raw = "https://livecloud-thumb.akamaized.net/chzzk/a/thumbnail/image_{type}.jpg";
    expect(resolveThumbnailUrl(raw)).toBe(
      `https://livecloud-thumb.akamaized.net/chzzk/a/thumbnail/image_${THUMBNAIL_TYPE}.jpg`,
    );
    expect(resolveThumbnailUrl(raw)).not.toContain("{type}");
  });

  it("치환 뒤에도 알 수 없는 자리표시자가 남으면 버립니다", () => {
    expect(
      resolveThumbnailUrl("https://livecloud-thumb.akamaized.net/a/image_{size}.jpg"),
    ).toBeNull();
    expect(
      resolveThumbnailUrl("https://livecloud-thumb.akamaized.net/a/image_{type}_{v}.jpg"),
    ).toBeNull();
  });

  it("허용되지 않은 호스트와 HTTP 를 거부합니다", () => {
    expect(resolveThumbnailUrl("https://evil.example/a/image_{type}.jpg")).toBeNull();
    expect(
      resolveThumbnailUrl("http://livecloud-thumb.akamaized.net/a/image_{type}.jpg"),
    ).toBeNull();
  });

  it("빈 값과 문자열이 아닌 값은 null 입니다", () => {
    expect(resolveThumbnailUrl("")).toBeNull();
    expect(resolveThumbnailUrl(null)).toBeNull();
    expect(resolveThumbnailUrl(undefined)).toBeNull();
    expect(resolveThumbnailUrl(7)).toBeNull();
  });
});

describe("resolveChannelImageUrl", () => {
  it("빈 문자열과 공백을 null 로 다룹니다", () => {
    expect(resolveChannelImageUrl("")).toBeNull();
    expect(resolveChannelImageUrl("   ")).toBeNull();
    expect(resolveChannelImageUrl(null)).toBeNull();
    expect(resolveChannelImageUrl(undefined)).toBeNull();
  });

  it("allowlist 를 통과한 주소만 돌려줍니다", () => {
    const allowed = "https://nng-phinf.pstatic.net/a/profile.jpg";
    expect(resolveChannelImageUrl(allowed)).toBe(allowed);
    expect(resolveChannelImageUrl("https://evil.example/a/profile.jpg")).toBeNull();
  });
});
