import { DiscoveryError, toDiscoveryErrorCode } from "../domain/errors";
import type { DiscoveryErrorCode } from "../domain/errors";
import { DISCOVERY_BUDGET } from "../shared/constants";
import { debugLog } from "../shared/invariant";
import type { ChzzkClient } from "../infrastructure/chzzk-web/client";
import { PromisePool } from "../infrastructure/network/promise-pool";
import { mergeChannelCache, pickFreshChannels, readChannelCache } from "../infrastructure/storage/cache-store";

/**
 * 팔로워 수 조회.
 *
 * 규칙
 *  - 동시성 4를 넘지 않는다.
 *  - 캐시(15분)를 먼저 본다.
 *  - 실패한 채널을 "조건 충족"으로 추정하지 않는다. 확인 실패 상태로 남긴다.
 *  - 429/403 을 만나면 남은 큐를 흘려보내고 중단한다. 우회하지 않는다.
 */

export type FollowerOutcome =
  | { readonly kind: "resolved"; readonly channelId: string; readonly followerCount: number }
  | { readonly kind: "failed"; readonly channelId: string };

export interface FollowerResolveOptions {
  readonly signal?: AbortSignal | undefined;
  /** 하나 확정될 때마다 호출된다. 점진적 표시를 위해 전체 완료를 기다리지 않는다. */
  readonly onResolved?: (outcome: FollowerOutcome) => void;
  /** 이 실행에서 새로 보낼 수 있는 최대 네트워크 요청 수 */
  readonly maxNetworkLookups?: number;
}

export interface FollowerResolveSummary {
  readonly resolved: number;
  readonly failed: number;
  /** 예산 때문에 아예 시도하지 못한 채널 수 */
  readonly skipped: number;
  /** 치명적 중단 사유 (429/403 등). 없으면 null */
  readonly haltedBy: DiscoveryErrorCode | null;
}

export interface FollowerResolver {
  resolve(
    channelIds: readonly string[],
    options?: FollowerResolveOptions,
  ): Promise<FollowerResolveSummary>;
}

/** 이 코드를 만나면 남은 요청을 보내지 않고 즉시 멈춘다. */
function isHaltingError(code: DiscoveryErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "ACCESS_DENIED" || code === "NETWORK_OFFLINE";
}

export function createFollowerResolver(
  client: ChzzkClient,
  deps: { now?: () => number } = {},
): FollowerResolver {
  const now = deps.now ?? (() => Date.now());

  return {
    async resolve(channelIds, options = {}) {
      const unique = [...new Set(channelIds)];
      if (unique.length === 0) {
        return { resolved: 0, failed: 0, skipped: 0, haltedBy: null };
      }

      const startedAt = now();
      const cached = pickFreshChannels(await readChannelCache(), startedAt);

      let resolved = 0;
      let failed = 0;
      const pendingNetwork: string[] = [];

      for (const channelId of unique) {
        const hit = cached.get(channelId);
        if (hit !== undefined) {
          resolved += 1;
          options.onResolved?.({ kind: "resolved", channelId, followerCount: hit });
        } else {
          pendingNetwork.push(channelId);
        }
      }

      const allowance = options.maxNetworkLookups ?? DISCOVERY_BUDGET.maxChannelLookupsPerRun;
      const targets = pendingNetwork.slice(0, Math.max(0, allowance));
      const skipped = pendingNetwork.length - targets.length;

      if (targets.length === 0) {
        return { resolved, failed, skipped, haltedBy: null };
      }

      const pool = new PromisePool(DISCOVERY_BUDGET.channelConcurrency);
      const fetched = new Map<string, number>();
      let haltedBy: DiscoveryErrorCode | null = null;

      await Promise.all(
        targets.map((channelId) =>
          pool
            .run(async () => {
              if (haltedBy !== null) return null;
              options.signal?.throwIfAborted();
              return client.fetchChannelInfo(channelId, { signal: options.signal });
            })
            .then(
              (info) => {
                if (info === null) {
                  // 중단 이후 흘려보낸 작업. 실패로 세지 않는다.
                  return;
                }
                if (info.kind === "resolved") {
                  fetched.set(channelId, info.followerCount);
                  resolved += 1;
                  options.onResolved?.({
                    kind: "resolved",
                    channelId,
                    followerCount: info.followerCount,
                  });
                } else {
                  failed += 1;
                  options.onResolved?.({ kind: "failed", channelId });
                }
              },
              (error: unknown) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                const code = error instanceof DiscoveryError ? error.code : toDiscoveryErrorCode(error);
                if (isHaltingError(code)) {
                  haltedBy ??= code;
                  pool.drainWaiting();
                }
                failed += 1;
                options.onResolved?.({ kind: "failed", channelId });
              },
            ),
        ),
      );

      if (fetched.size > 0) {
        await mergeChannelCache(fetched, now());
      }

      debugLog({
        event: "followers.resolved",
        at: startedAt,
        durationMs: now() - startedAt,
        count: resolved,
        ...(haltedBy ? { errorCode: haltedBy } : {}),
      });

      return { resolved, failed, skipped, haltedBy };
    },
  };
}
