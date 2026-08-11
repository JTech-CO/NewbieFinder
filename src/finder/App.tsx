import { useEffect, useMemo, useReducer, useState } from "react";
import { describeDiscoveryError, isContractError } from "../domain/errors";
import type { PartialReason } from "../domain/models";
import { isBaseFilterActive } from "../domain/settings";
import { DISCOVERY_BUDGET } from "../shared/constants";
import { finderReducer, INITIAL_FINDER_STATE } from "./app-reducer";
import {
  selectCanContinue,
  selectConditionSummary,
  selectCoverageNote,
  selectEmptyVariant,
  selectFilterOutcome,
  selectResults,
  selectStatusBadge,
} from "./app-selectors";
import { AppFooter } from "./components/AppFooter";
import { AppHeader } from "./components/AppHeader";
import { DiscoveryProgress } from "./components/DiscoveryProgress";
import { EmptyState } from "./components/EmptyState";
import { FilterPanel } from "./components/FilterPanel";
import { LiveGrid } from "./components/LiveGrid";
import { ResultSummary } from "./components/ResultSummary";
import { SkeletonGrid } from "./components/SkeletonGrid";
import { StateBanner } from "./components/StateBanner";
import { useDiscovery } from "./hooks/useDiscovery";
import { useRelativeClock } from "./hooks/useRelativeClock";
import { useSettings } from "./hooks/useSettings";

export function App() {
  const [state, dispatch] = useReducer(finderReducer, INITIAL_FINDER_STATE);
  const { updateSettings, dismissNotice } = useSettings(state, dispatch);
  const { refresh, continueDiscovery } = useDiscovery(state, dispatch);
  const now = useRelativeClock();

  const outcome = useMemo(() => selectFilterOutcome(state), [state]);
  const results = useMemo(() => selectResults(state, outcome), [state, outcome]);
  const status = useMemo(() => selectStatusBadge(state), [state]);
  const conditionSummary = useMemo(() => selectConditionSummary(state), [state]);
  const coverageNote = useMemo(() => selectCoverageNote(state), [state]);
  const emptyVariant = selectEmptyVariant(state, results.length);
  const canContinue = selectCanContinue(state);
  const conditionActive = isBaseFilterActive(state.settings);

  const cooldownMs = useRefreshCooldown(state.lastRefreshAt);
  const showSkeleton = state.isRunning && state.candidates.length === 0;

  const errorInfo = state.discovery.errorCode ? describeDiscoveryError(state.discovery.errorCode) : null;
  const hideResults = state.discovery.errorCode !== null && isContractError(state.discovery.errorCode);
  const partial = describePartialReason(state.discovery.partialReason, state.discovery.scannedLives);

  return (
    <div className="nf-app">
      <AppHeader
        status={status}
        lastUpdatedAt={state.discovery.lastUpdatedAt}
        isRunning={state.isRunning}
        cooldownMs={cooldownMs}
        onRefresh={refresh}
      />

      <main className="nf-app__main">
        <div className="nf-app__sidebar">
          <FilterPanel
            settings={state.settings}
            onChange={updateSettings}
            noticeDismissed={state.noticeDismissed}
            onDismissNotice={dismissNotice}
          />
        </div>

        <section className="nf-app__results" aria-labelledby="nf-results-title">
          <h2 className="nf-visually-hidden" id="nf-results-title">
            탐색 결과
          </h2>

          {state.storageFailed ? (
            <StateBanner
              kind="warning"
              title="설정을 저장하지 못했습니다."
              detail="이번 탭에서는 그대로 사용할 수 있지만, 변경한 조건이 다음 실행에 남지 않을 수 있습니다."
            />
          ) : null}

          {errorInfo ? (
            <StateBanner
              kind={hideResults ? "error" : "warning"}
              title={errorInfo.title}
              detail={errorInfo.detail}
              code={state.discovery.errorCode ?? undefined}
              actionLabel={errorInfo.retryable ? "다시 시도" : undefined}
              onAction={errorInfo.retryable ? refresh : undefined}
            />
          ) : null}

          {!hideResults && partial ? (
            <StateBanner
              kind="warning"
              title={partial.title}
              detail={partial.detail}
              actionLabel={canContinue ? "계속 탐색" : undefined}
              onAction={canContinue ? continueDiscovery : undefined}
            />
          ) : null}

          {state.discovery.dataOrigin === "cache-stale" ? (
            <StateBanner
              kind="info"
              title="이전에 저장한 데이터를 표시하고 있습니다."
              detail="최신 정보를 보려면 새로고침해 주세요."
              actionLabel="새로고침"
              onAction={refresh}
            />
          ) : null}

          <ResultSummary
            resultCount={results.length}
            conditionSummary={conditionSummary}
            coverageNote={hideResults ? null : coverageNote}
            outcome={outcome}
            conditionActive={conditionActive}
          />

          {conditionActive ? (
            <DiscoveryProgress discovery={state.discovery} isRunning={state.isRunning} />
          ) : null}

          {hideResults ? null : showSkeleton ? (
            <SkeletonGrid count={6} />
          ) : emptyVariant ? (
            <EmptyState
              variant={emptyVariant}
              {...(emptyVariant === "no-result" && canContinue
                ? { onAction: continueDiscovery, actionLabel: "계속 탐색" }
                : {})}
            />
          ) : (
            <>
              <LiveGrid candidates={results} now={now} />
              {canContinue ? (
                <div className="nf-cluster nf-app__continue">
                  <button type="button" className="nf-button nf-button--primary" onClick={continueDiscovery}>
                    계속 탐색
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      <AppFooter lastUpdatedAt={state.discovery.lastUpdatedAt} now={now} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface PartialCopy {
  readonly title: string;
  readonly detail: string;
}

/**
 * 부분 결과 사유를 사용자 문장으로.
 * "대략적인 전체 결과" 같은 표현을 쓰지 않는다.
 */
function describePartialReason(reason: PartialReason | null, scannedLives: number): PartialCopy | null {
  if (reason === null) return null;

  const scanned = scannedLives.toLocaleString("ko-KR");

  switch (reason) {
    case "page-budget":
      return {
        title: "현재 탐색한 범위의 결과입니다.",
        detail: `지금까지 라이브 ${scanned}개를 확인했습니다. 전체 라이브를 대표하지 않을 수 있습니다.`,
      };
    case "channel-budget":
      return {
        title: "일부 채널만 확인했습니다.",
        detail: `한 번에 확인하는 채널 수를 ${DISCOVERY_BUDGET.maxChannelLookupsPerRun}개로 제한하고 있습니다. 이어서 다음 구간을 확인할 수 있습니다.`,
      };
    case "rate-limit":
      return {
        title: "요청이 제한되어 탐색을 중단했습니다.",
        detail: "확보한 범위까지만 표시합니다. 잠시 후 새로고침해 주세요.",
      };
    case "network":
      return {
        title: "네트워크 문제로 일부 구간을 확인하지 못했습니다.",
        detail: `지금까지 확인한 라이브 ${scanned}개 기준 결과입니다.`,
      };
    case "latest-strategy":
      return {
        title: "최근 시작한 방송 범위에서 찾은 결과입니다.",
        detail:
          "시청자 수 조건 없이 팔로워 조건만 사용하면 최근 시작한 방송부터 확인합니다. 시청자 수 조건을 함께 켜면 해당 구간을 빠짐없이 확인할 수 있습니다.",
      };
    default:
      return null;
  }
}

/** 새로고침 쿨다운은 1초 단위로만 다시 그린다. 쿨다운이 도는 동안에만 타이머를 만든다. */
function useRefreshCooldown(lastRefreshAt: number | null): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (lastRefreshAt === null) return;
    if (Date.now() - lastRefreshAt >= DISCOVERY_BUDGET.refreshCooldownMs) return;

    const timer = setInterval(() => {
      const at = Date.now();
      setTick(at);
      if (at - lastRefreshAt >= DISCOVERY_BUDGET.refreshCooldownMs) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [lastRefreshAt]);

  if (lastRefreshAt === null) return 0;
  return Math.max(0, DISCOVERY_BUDGET.refreshCooldownMs - (tick - lastRefreshAt));
}
