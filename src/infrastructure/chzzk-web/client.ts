import type { LiveCursor } from "../../domain/models";
import { fetchPublicJson } from "../network/fetch-json";
import { RequestDeduper } from "../network/request-deduper";
import type { ChannelInfoResult } from "./channel-adapter";
import { adaptChannelInfo } from "./channel-adapter";
import type { LiveSortType } from "./endpoints";
import { buildChannelInfoUrl, buildLiveListUrl } from "./endpoints";
import type { LivePageResult } from "./live-adapter";
import { adaptLivePage } from "./live-adapter";

/**
 * 비공식 응답에 접근하는 유일한 창구.
 * 상위 계층은 URL 도, Zod 도, fetch 도 직접 만지지 않는다.
 */
export interface ChzzkClient {
  fetchLivePage(request: LivePageRequest, options?: RequestOptions): Promise<LivePageResult>;
  fetchChannelInfo(channelId: string, options?: RequestOptions): Promise<ChannelInfoResult>;
}

export interface LivePageRequest {
  readonly cursor?: LiveCursor | null;
  readonly sortType?: LiveSortType | undefined;
}

export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface ChzzkClientDeps {
  /** 테스트에서 고정 픽스처를 주입하기 위한 확장점 */
  readonly requestJson?: (url: URL, options: RequestOptions) => Promise<unknown>;
  readonly now?: () => number;
}

export function createChzzkClient(deps: ChzzkClientDeps = {}): ChzzkClient {
  const requestJson =
    deps.requestJson ?? ((url: URL, options: RequestOptions) => fetchPublicJson(url, options));
  const now = deps.now ?? (() => Date.now());

  const channelDeduper = new RequestDeduper<ChannelInfoResult>();

  return {
    async fetchLivePage(request, options = {}) {
      const url = buildLiveListUrl({
        cursor: request.cursor ?? null,
        sortType: request.sortType,
      });
      const raw = await requestJson(url, options);
      return adaptLivePage(raw, now());
    },

    async fetchChannelInfo(channelId, options = {}) {
      return channelDeduper.run(channelId, async () => {
        const raw = await requestJson(buildChannelInfoUrl(channelId), options);
        return adaptChannelInfo(raw, channelId);
      });
    },
  };
}
