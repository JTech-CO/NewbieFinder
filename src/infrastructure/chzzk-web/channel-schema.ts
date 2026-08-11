import { z } from "zod";

/**
 * 채널 정보 런타임 스키마.
 *
 * 주의: 존재하지 않는 채널 ID 로 요청해도 API 는 200 + code 200 을 돌려주고
 * `channelId: null`, `channelName: "(알 수 없음)"`, `followerCount: 0` 인 자리표시자를 준다.
 * 이 값을 "팔로워 0명"으로 받아들이면 조건을 만족하지 않는 채널이 결과에 섞인다.
 * 따라서 adapter 에서 요청한 channelId 와 응답 channelId 가 같은지 반드시 대조한다.
 */

export const channelContentSchema = z.object({
  channelId: z.string().nullish(),
  channelName: z.string().nullish(),
  channelImageUrl: z.string().nullish(),
  verifiedMark: z.boolean().nullish(),
  channelType: z.string().nullish(),
  followerCount: z.number().finite().nullish(),
  openLive: z.boolean().nullish(),
});

export const channelEnvelopeSchema = z.object({
  code: z.number(),
  message: z.string().nullish(),
  content: channelContentSchema.nullable(),
});

export type RawChannelContent = z.infer<typeof channelContentSchema>;
export type RawChannelEnvelope = z.infer<typeof channelEnvelopeSchema>;
