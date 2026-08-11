import { applyFilters, needsFollowerLookup } from "../domain/filters";
import type { DiscoveryErrorCode } from "../domain/errors";
import { DiscoveryError, toDiscoveryErrorCode } from "../domain/errors";
import type {
  DiscoveryState,
  LiveCursor,
  PartialReason,
  ScanCoverage,
  ScanStrategy,
  StreamCandidate,
} from "../domain/models";
import { INITIAL_DISCOVERY_STATE } from "../domain/models";
import type { FinderSettings } from "../domain/settings";
import { debugLog } from "../shared/invariant";
import type { ChzzkClient } from "../infrastructure/chzzk-web/client";
import { seedCursorForViewerCeiling } from "../infrastructure/chzzk-web/endpoints";
import type { DiscoveryResumeToken, DiscoveryRunResult, DiscoverySnapshot } from "./discovery-events";
import { computeViewerFrontier, mergeCandidate } from "./discovery-events";
import type { FollowerResolver } from "./follower-resolver";
import { RequestBudget, resolveBudgetLimits } from "./request-budget";

/**
 * 라이브 탐색 오케스트레이터.
 *
 * 탐색 전략은 활성 조건이 정한다.
 *
 *  viewer-tail (시청자 조건 ON)
 *    keyset 커서를 `(시청자 상한 + 1, 0)` 에 시드해 조건을 만족하는 구간만 내림차순으로 훑는다.
 *    받아 온 모든 항목이 조건을 통과하므로 버리는 응답이 없고,
 *    커서가 소진되면 "이 구간은 빠짐없이 훑었다"고 정직하게 말할 수 있다.
 *
 *  latest (시청자 조건 OFF, 팔로워 조건만 ON)
 *    시청자 수로 구간을 좁힐 수 없으므로 최근 시작한 방송부터 훑는다.
 *    전체 라이브를 대표하지 않으므로 결과는 항상 부분 결과다.
 */

export interface DiscoveryRunInput {
  readonly settings: FinderSettings;
  readonly signal: AbortSignal;
  readonly resume?: DiscoveryResumeToken | null;
  /** 이어받기 시 이미 확보한 후보 */
  readonly existingCandidates?: readonly StreamCandidate[];
  readonly onSnapshot: (snapshot: DiscoverySnapshot) => void;
}

export interface DiscoveryOrchestrator {
  run(input: DiscoveryRunInput): Promise<DiscoveryRunResult>;
}

export interface OrchestratorDeps {
  readonly client: ChzzkClient;
  readonly followerResolver: FollowerResolver;
  readonly now?: () => number;
  /** 스냅샷 방출 최소 간격 (ms). 렌더 폭주를 막는다. */
  readonly emitIntervalMs?: number;
}

export function selectStrategy(settings: FinderSettings): ScanStrategy {
  return settings.viewerFilter.enabled ? "viewer-tail" : "latest";
}

export function createDiscoveryOrchestrator(deps: OrchestratorDeps): DiscoveryOrchestrator {
  const now = deps.now ?? (() => Date.now());
  const emitIntervalMs = deps.emitIntervalMs ?? 120;

  return {
    async run(input): Promise<DiscoveryRunResult> {
      const { settings, signal, onSnapshot } = input;
      const strategy = selectStrategy(settings);
      const budget = new RequestBudget(resolveBudgetLimits(settings.followerFilter.enabled));

      const byChannelId = new Map<string, StreamCandidate>();
      for (const candidate of input.existingCandidates ?? []) {
        byChannelId.set(candidate.channelId, candidate);
      }

      let cursor: LiveCursor | null =
        input.resume?.cursor ??
        (strategy === "viewer-tail" ? seedCursorForViewerCeiling(settings.viewerFilter.max) : null);

      let coverage: ScanCoverage = input.resume?.coverage ?? {
        strategy,
        viewerCeiling: strategy === "viewer-tail" ? settings.viewerFilter.max : null,
        viewerFrontier: null,
        exhausted: false,
      };

      let scannedPages = input.resume?.scannedPages ?? 0;
      let scannedLives = input.resume?.scannedLives ?? 0;
      let unparsedDates = 0;
      let errorCode: DiscoveryErrorCode | null = null;
      let lastEmitAt = 0;

      const emit = (phase: DiscoveryState["phase"], force = false): void => {
        const at = now();
        if (!force && at - lastEmitAt < emitIntervalMs) return;
        lastEmitAt = at;
        onSnapshot(buildSnapshot());
        function buildSnapshot(): DiscoverySnapshot {
          const candidates = [...byChannelId.values()];
          const outcome = applyFilters(candidates, settings);
          return {
            candidates,
            state: {
              ...INITIAL_DISCOVERY_STATE,
              phase,
              scannedPages,
              scannedLives,
              resolvedChannels: countByFollowerState(candidates, "ready"),
              unresolvedChannels: countByFollowerState(candidates, "failed"),
              pendingChannels: outcome.awaitingFollower,
              matchedResults: outcome.matched.length,
              hasNextPage: cursor !== null,
              coverage,
              partialReason: null,
              lastUpdatedAt: at,
              dataOrigin: "network",
              errorCode,
              unparsedDates,
            },
          };
        }
      };

      /* ---------------- 1단계: 라이브 목록 ---------------- */

      const startedAt = now();
      let pageFailed = false;

      try {
        while (budget.canFetchLivePage()) {
          signal.throwIfAborted();

          const page = await deps.client.fetchLivePage(
            {
              cursor,
              sortType: strategy === "latest" ? "LATEST" : undefined,
            },
            { signal },
          );

          budget.consumeLivePage();
          scannedPages += 1;
          scannedLives += page.rawCount;
          unparsedDates += page.unparsedDates;

          for (const item of page.items) {
            mergeCandidate(byChannelId, item);
          }

          cursor = page.nextCursor;
          coverage = {
            ...coverage,
            viewerFrontier:
              strategy === "viewer-tail" ? computeViewerFrontier(cursor) : coverage.viewerFrontier,
            exhausted: cursor === null,
          };

          emit("loading-lives");

          if (cursor === null) break;
          // 응답이 비어 있는데 커서만 도는 경우 무한 루프를 막는다.
          if (page.rawCount === 0) break;
        }
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        pageFailed = true;
        errorCode = error instanceof DiscoveryError ? error.code : toDiscoveryErrorCode(error);
        debugLog({ event: "discovery.lives.failed", at: startedAt, errorCode });
      }

      emit("loading-lives", true);

      /* ---------------- 2단계: 팔로워 판정 ---------------- */

      let followerSkipped = 0;
      let followerHalt: DiscoveryErrorCode | null = null;

      if (settings.followerFilter.enabled && !isFatal(errorCode)) {
        // 시청자 조건이 꺼져 있으면 시청자 수로 거르지 않는다.
        // needsFollowerLookup 이 그 규칙을 이미 담고 있으므로 그대로 쓴다.
        const targets = [...byChannelId.values()]
          .filter((item) => needsFollowerLookup(item, settings))
          .map((item) => item.channelId);

        const allowance = budget.grantChannelLookups(targets.length);

        if (targets.length > 0) {
          markLoading(byChannelId, targets.slice(0, allowance));
          emit("loading-followers", true);

          const summary = await deps.followerResolver.resolve(targets.slice(0, allowance), {
            signal,
            maxNetworkLookups: allowance,
            onResolved: (outcome) => {
              applyFollowerOutcome(byChannelId, outcome);
              emit("loading-followers");
            },
          });

          followerSkipped = summary.skipped + Math.max(0, targets.length - allowance);
          followerHalt = summary.haltedBy;
          // 예산이나 중단으로 시도조차 못한 후보는 idle 로 되돌려 다음 실행에서 다시 시도한다.
          resetUnattempted(byChannelId);
        }
      }

      /* ---------------- 마무리 ---------------- */

      const partialReason = resolvePartialReason({
        strategy,
        hasNextPage: cursor !== null,
        budgetReason: budget.partialReason,
        followerSkipped,
        followerHalt,
        pageFailed,
        errorCode,
      });

      const candidates = [...byChannelId.values()];
      const outcome = applyFilters(candidates, settings);
      const finishedAt = now();

      const hasAnyResult = candidates.length > 0;
      const phase: DiscoveryState["phase"] = !hasAnyResult && errorCode !== null
        ? "error"
        : partialReason !== null || errorCode !== null
          ? "partial"
          : "ready";

      const finalSnapshot: DiscoverySnapshot = {
        candidates,
        state: {
          phase,
          scannedPages,
          scannedLives,
          resolvedChannels: countByFollowerState(candidates, "ready"),
          unresolvedChannels: countByFollowerState(candidates, "failed"),
          pendingChannels: outcome.awaitingFollower,
          matchedResults: outcome.matched.length,
          hasNextPage: cursor !== null,
          coverage,
          partialReason,
          lastUpdatedAt: finishedAt,
          dataOrigin: "network",
          errorCode,
          unparsedDates,
        },
      };

      onSnapshot(finalSnapshot);

      debugLog({
        event: "discovery.done",
        at: startedAt,
        durationMs: finishedAt - startedAt,
        pageIndex: scannedPages,
        count: outcome.matched.length,
        ...(errorCode ? { errorCode } : {}),
      });

      return {
        snapshot: finalSnapshot,
        resume:
          cursor === null
            ? null
            : { cursor, coverage, scannedPages, scannedLives },
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* 내부 도우미                                                          */
/* ------------------------------------------------------------------ */

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error instanceof DOMException && error.name === "AbortError";
}

/** 결과 그리드를 만들 수 없는 계약 파손인지 */
function isFatal(code: DiscoveryErrorCode | null): boolean {
  return code === "LIVE_SCHEMA_CHANGED" || code === "INVALID_RESPONSE" || code === "ACCESS_DENIED";
}

function countByFollowerState(
  candidates: readonly StreamCandidate[],
  state: StreamCandidate["followerState"],
): number {
  let count = 0;
  for (const candidate of candidates) {
    if (candidate.followerState === state) count += 1;
  }
  return count;
}

function markLoading(map: Map<string, StreamCandidate>, channelIds: readonly string[]): void {
  for (const channelId of channelIds) {
    const item = map.get(channelId);
    if (item && item.followerState === "idle") {
      map.set(channelId, { ...item, followerState: "loading" });
    }
  }
}

function resetUnattempted(map: Map<string, StreamCandidate>): void {
  for (const [channelId, item] of map) {
    if (item.followerState === "loading") {
      map.set(channelId, { ...item, followerState: "idle" });
    }
  }
}

export function applyFollowerOutcome(
  map: Map<string, StreamCandidate>,
  outcome: { kind: "resolved" | "failed"; channelId: string; followerCount?: number },
): void {
  const item = map.get(outcome.channelId);
  if (!item) return;

  if (outcome.kind === "resolved" && typeof outcome.followerCount === "number") {
    map.set(outcome.channelId, {
      ...item,
      followerCount: outcome.followerCount,
      followerState: "ready",
    });
    return;
  }

  map.set(outcome.channelId, { ...item, followerCount: null, followerState: "failed" });
}

interface PartialReasonInput {
  readonly strategy: ScanStrategy;
  readonly hasNextPage: boolean;
  readonly budgetReason: PartialReason | null;
  readonly followerSkipped: number;
  readonly followerHalt: DiscoveryErrorCode | null;
  readonly pageFailed: boolean;
  readonly errorCode: DiscoveryErrorCode | null;
}

/**
 * 왜 부분 결과인지 하나로 정한다. 사용자에게 "전체를 찾았다"고 잘못 말하지 않기 위한 핵심 로직이다.
 */
export function resolvePartialReason(input: PartialReasonInput): PartialReason | null {
  if (input.followerHalt === "RATE_LIMITED") return "rate-limit";
  if (input.followerHalt === "NETWORK_OFFLINE") return "network";
  if (input.errorCode === "RATE_LIMITED") return "rate-limit";
  if (input.errorCode === "NETWORK_OFFLINE" || input.errorCode === "REQUEST_TIMEOUT") {
    return "network";
  }
  if (input.pageFailed) return "network";
  if (input.followerSkipped > 0) return "channel-budget";
  if (input.budgetReason !== null && input.hasNextPage) return input.budgetReason;
  // 최근 시작 순 전략은 전체 라이브를 훑은 적이 없으므로 언제나 부분 결과다.
  if (input.strategy === "latest") return "latest-strategy";
  return null;
}
