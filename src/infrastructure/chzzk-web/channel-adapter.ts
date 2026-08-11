import { DiscoveryError } from "../../domain/errors";
import { resolveChannelImageUrl } from "../../shared/url";
import { channelEnvelopeSchema } from "./channel-schema";

/** 팔로워 조회 결과. 확인되지 않은 상태를 0명과 구분해서 표현한다. */
export type ChannelInfoResult =
  | {
      readonly kind: "resolved";
      readonly channelId: string;
      readonly followerCount: number;
      readonly channelImageUrl: string | null;
      readonly verified: boolean;
      readonly openLive: boolean | null;
    }
  /** 응답은 정상인데 그 채널을 알 수 없다고 답한 경우 (자리표시자 응답) */
  | { readonly kind: "unknown-channel"; readonly channelId: string };

/**
 * 원시 채널 응답 → 팔로워 정보.
 *
 * @param requestedChannelId 요청에 사용한 채널 ID. 응답과 대조해야 자리표시자를 걸러 낼 수 있다.
 * @throws DiscoveryError CHANNEL_SCHEMA_CHANGED: 봉투가 깨졌거나 followerCount 가 사라진 경우
 */
export function adaptChannelInfo(raw: unknown, requestedChannelId: string): ChannelInfoResult {
  const envelope = channelEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new DiscoveryError("CHANNEL_SCHEMA_CHANGED", { cause: envelope.error });
  }

  const { code, content } = envelope.data;
  if (code !== 200) {
    throw new DiscoveryError("INVALID_RESPONSE", { status: code });
  }
  if (content === null) {
    return { kind: "unknown-channel", channelId: requestedChannelId };
  }

  // 존재하지 않는 채널이면 channelId 가 null 이거나 요청과 다르다.
  // 이때의 followerCount: 0 은 "팔로워가 0명"이 아니라 "모르는 채널"이라는 뜻이다.
  if (typeof content.channelId !== "string" || content.channelId !== requestedChannelId) {
    return { kind: "unknown-channel", channelId: requestedChannelId };
  }

  // followerCount 가 사라지면 기본값으로 숨기지 않고 계약 오류로 올린다.
  if (typeof content.followerCount !== "number" || !Number.isFinite(content.followerCount)) {
    throw new DiscoveryError("CHANNEL_SCHEMA_CHANGED");
  }
  if (content.followerCount < 0) {
    throw new DiscoveryError("CHANNEL_SCHEMA_CHANGED");
  }

  return {
    kind: "resolved",
    channelId: content.channelId,
    followerCount: Math.round(content.followerCount),
    channelImageUrl: resolveChannelImageUrl(content.channelImageUrl),
    verified: content.verifiedMark === true,
    openLive: typeof content.openLive === "boolean" ? content.openLive : null,
  };
}
