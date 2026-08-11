import { z } from "zod";

/**
 * 라이브 목록 런타임 스키마.
 *
 * TypeScript interface 만으로 비공식 응답을 신뢰하지 않는다.
 * 여기를 통과한 값만 도메인 모델로 변환한다.
 *
 * 봉투(envelope)와 페이지 구조는 엄격하게 본다. 이게 깨지면 계약 변경이다.
 * 개별 항목은 느슨하게 본다. 항목 하나가 이상하다고 페이지 전체를 버릴 이유는 없다.
 */

export const liveCursorSchema = z.object({
  concurrentUserCount: z.number().finite(),
  liveId: z.number().finite(),
});

export const liveChannelSchema = z.object({
  channelId: z.string().min(1),
  channelName: z.string(),
  channelImageUrl: z.string().nullish(),
  verifiedMark: z.boolean().nullish(),
});

export const liveItemSchema = z.object({
  liveId: z.union([z.number().finite(), z.string().min(1)]),
  liveTitle: z.string(),
  liveImageUrl: z.string().nullish(),
  defaultThumbnailImageUrl: z.string().nullish(),
  concurrentUserCount: z.number().finite(),
  openDate: z.string(),
  adult: z.boolean(),
  categoryType: z.string().nullish(),
  liveCategory: z.string().nullish(),
  liveCategoryValue: z.string().nullish(),
  channel: liveChannelSchema,
});

/**
 * 봉투. `content.data` 는 unknown[] 로 받아 항목 단위로 따로 검증한다.
 * `content.page` 가 아예 없는 응답도 실제로 존재할 수 있으므로 nullish 로 둔다.
 */
export const liveListEnvelopeSchema = z.object({
  code: z.number(),
  message: z.string().nullish(),
  content: z.object({
    size: z.number().nullish(),
    data: z.array(z.unknown()),
    page: z
      .object({
        next: liveCursorSchema.nullish(),
        prev: liveCursorSchema.nullish(),
      })
      .nullish(),
  }),
});

export type RawLiveItem = z.infer<typeof liveItemSchema>;
export type RawLiveListEnvelope = z.infer<typeof liveListEnvelopeSchema>;
