import type { Dispatch } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DiscoveryResumeToken, DiscoverySnapshot } from "../../application/discovery-events";
import { createDiscoveryOrchestrator, selectStrategy } from "../../application/discovery-orchestrator";
import { createFollowerResolver } from "../../application/follower-resolver";
import { toDiscoveryErrorCode } from "../../domain/errors";
import { needsFollowerLookup, shouldDiscover } from "../../domain/filters";
import type { StreamCandidate } from "../../domain/models";
import type { FinderSettings } from "../../domain/settings";
import { sortCandidates } from "../../domain/sorting";
import { debugLog } from "../../shared/invariant";
import { createChzzkClient } from "../../infrastructure/chzzk-web/client";
import type { LiveCachePayload } from "../../infrastructure/storage/cache-store";
import { freshnessOf, readLiveCache, writeLiveCache } from "../../infrastructure/storage/cache-store";
import type { FinderAction, FinderState } from "../app-reducer";
import { selectNeedsRescan } from "../app-selectors";

/**
 * 탐색 수명주기.
 *
 * 네트워크 요청은 다음 경우에만 발생한다.
 *  - Finder 를 처음 열었고 쓸 수 있는 신선한 캐시가 없을 때
 *  - 사용자가 새로고침을 눌렀을 때
 *  - 사용자가 계속 탐색을 눌렀을 때
 *  - 사용자가 조건을 바꿔 기존 데이터로는 답할 수 없게 되었을 때
 *
 * 주기적 Polling 은 없다. 화면을 닫으면 진행 중인 요청은 AbortController 로 끊긴다.
 */

/** 팔로워 조건이 꺼져 있을 때 카드 표시용으로만 조회할 최대 채널 수 */
const LAZY_FOLLOWER_LIMIT = 40;
const AUTO_RESCAN_DEBOUNCE_MS = 600;
const FOLLOWER_FLUSH_MS = 150;

export interface DiscoveryControls {
  readonly refresh: () => void;
  readonly continueDiscovery: () => void;
  readonly cancel: () => void;
}

export function useDiscovery(
  state: FinderState,
  dispatch: Dispatch<FinderAction>,
): DiscoveryControls {
  const client = useMemo(() => createChzzkClient(), []);
  const followerResolver = useMemo(() => createFollowerResolver(client), [client]);
  const orchestrator = useMemo(
    () => createDiscoveryOrchestrator({ client, followerResolver }),
    [client, followerResolver],
  );

  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const bootstrapDoneRef = useRef(false);

  // 콜백이 항상 최신 상태를 보게 한다. 의존성 배열 때문에 재실행이 도는 것을 막는다.
  const stateRef = useRef(state);
  stateRef.current = state;

  /* ---------------- 팔로워 Lazy 조회 (조건이 꺼져 있을 때 표시 전용) ---------------- */

  const lazyResolveFollowers = useCallback(
    async (candidates: readonly StreamCandidate[], settings: FinderSettings, signal: AbortSignal) => {
      if (settings.followerFilter.enabled) return;

      const targets = sortCandidates(
        candidates.filter((candidate) => needsFollowerLookup(candidate, settings)),
        settings,
      )
        .slice(0, LAZY_FOLLOWER_LIMIT)
        .map((candidate) => candidate.channelId);

      if (targets.length === 0) return;

      let buffer: Array<{ channelId: string; followerCount: number | null }> = [];
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = (): void => {
        flushTimer = null;
        if (buffer.length === 0 || signal.aborted) return;
        dispatch({ type: "followers/updated", updates: buffer });
        buffer = [];
      };

      await followerResolver.resolve(targets, {
        signal,
        maxNetworkLookups: LAZY_FOLLOWER_LIMIT,
        onResolved: (outcome) => {
          buffer.push({
            channelId: outcome.channelId,
            followerCount: outcome.kind === "resolved" ? outcome.followerCount : null,
          });
          flushTimer ??= setTimeout(flush, FOLLOWER_FLUSH_MS);
        },
      });

      if (flushTimer !== null) clearTimeout(flushTimer);
      flush();
    },
    [dispatch, followerResolver],
  );

  /* ---------------- 탐색 실행 ---------------- */

  const run = useCallback(
    async (options: { manual: boolean; resume: DiscoveryResumeToken | null }): Promise<void> => {
      const current = stateRef.current;
      if (runningRef.current) return;
      if (!shouldDiscover(current.settings)) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;

      const settings = current.settings;
      dispatch({ type: "discovery/started", at: Date.now(), manual: options.manual });

      try {
        const result = await orchestrator.run({
          settings,
          signal: controller.signal,
          resume: options.resume,
          existingCandidates: options.resume ? current.candidates : [],
          onSnapshot: (snapshot: DiscoverySnapshot) => {
            if (!controller.signal.aborted) dispatch({ type: "discovery/snapshot", snapshot });
          },
        });

        if (controller.signal.aborted) return;

        dispatch({
          type: "discovery/finished",
          snapshot: result.snapshot,
          resume: result.resume,
        });

        void persistCache(result.snapshot, settings);
        void lazyResolveFollowers(result.snapshot.candidates, settings, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) {
          dispatch({ type: "discovery/cancelled" });
          return;
        }
        const code = toDiscoveryErrorCode(error);
        debugLog({ event: "discovery.failed", at: Date.now(), errorCode: code });
        dispatch({ type: "discovery/failed", code });
      } finally {
        runningRef.current = false;
      }
    },
    [dispatch, lazyResolveFollowers, orchestrator],
  );

  /* ---------------- 최초 진입: 캐시 우선, 필요할 때만 네트워크 ---------------- */

  useEffect(() => {
    if (!state.settingsLoaded || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    let cancelled = false;

    void (async () => {
      const now = Date.now();
      const entry = await readLiveCache();
      const freshness = freshnessOf(entry, now);
      const settings = stateRef.current.settings;

      const usable =
        entry !== undefined && freshness !== "expired" && cacheCoversSettings(entry.payload, settings);

      if (usable && entry && !cancelled) {
        dispatch({
          type: "cache/hydrated",
          candidates: entry.payload.candidates,
          origin: freshness === "fresh" ? "cache-fresh" : "cache-stale",
          updatedAt: entry.createdAt,
          discovery: {
            coverage: entry.payload.coverage,
            scannedPages: entry.payload.scannedPages,
            scannedLives: entry.payload.scannedLives,
            hasNextPage: false,
          },
        });
      }

      bootstrapDoneRef.current = true;
      if (cancelled) return;

      // 신선한 캐시를 그대로 쓸 수 있으면 네트워크를 건드리지 않는다.
      if (!usable || freshness !== "fresh") {
        await run({ manual: false, resume: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.settingsLoaded, dispatch, run]);

  /* ---------------- 조건이 바뀌어 기존 데이터로 답할 수 없을 때 ---------------- */

  useEffect(() => {
    if (!bootstrapDoneRef.current) return;
    if (state.isRunning || runningRef.current) return;
    if (!selectNeedsRescan(state)) return;

    const timer = setTimeout(() => {
      void run({ manual: false, resume: null });
    }, AUTO_RESCAN_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [state, run]);

  /* ---------------- 언마운트 정리 ---------------- */

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /* ---------------- 조작 ---------------- */

  const refresh = useCallback(() => {
    void run({ manual: true, resume: null });
  }, [run]);

  const continueDiscovery = useCallback(() => {
    const resume = stateRef.current.resume;
    if (resume === null) return;
    void run({ manual: false, resume });
  }, [run]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { refresh, continueDiscovery, cancel };
}

/* ------------------------------------------------------------------ */

function cacheCoversSettings(payload: LiveCachePayload, settings: FinderSettings): boolean {
  if (payload.coverage.strategy !== selectStrategy(settings)) return false;
  if (!settings.viewerFilter.enabled) return true;
  return (payload.viewerCeiling ?? -1) >= settings.viewerFilter.max;
}

async function persistCache(snapshot: DiscoverySnapshot, settings: FinderSettings): Promise<void> {
  await writeLiveCache(
    {
      candidates: [...snapshot.candidates],
      coverage: snapshot.state.coverage,
      scannedPages: snapshot.state.scannedPages,
      scannedLives: snapshot.state.scannedLives,
      viewerCeiling: settings.viewerFilter.enabled ? settings.viewerFilter.max : null,
    },
    Date.now(),
  );
}
