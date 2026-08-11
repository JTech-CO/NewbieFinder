import { formatUpdatedAt } from "../../domain/date";
import { BRAND_MARK_SRC, EXTENSION_NAME } from "../../shared/constants";
import type { StatusBadge as StatusBadgeType } from "../app-selectors";
import { RefreshIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

/** 마지막 갱신 시각과 데이터 상태를 항상 함께 보여 준다. 캐시를 실시간처럼 보이게 하지 않는다. */

export interface AppHeaderProps {
  readonly status: StatusBadgeType;
  readonly lastUpdatedAt: number | null;
  readonly isRunning: boolean;
  /** 남은 쿨다운(ms). 0 이면 지금 누를 수 있다. */
  readonly cooldownMs: number;
  readonly onRefresh: () => void;
}

export function AppHeader({
  status,
  lastUpdatedAt,
  isRunning,
  cooldownMs,
  onRefresh,
}: AppHeaderProps) {
  const cooldownSeconds = Math.ceil(cooldownMs / 1000);
  const disabled = isRunning || cooldownMs > 0;
  const title = isRunning
    ? "탐색이 진행 중입니다."
    : cooldownMs > 0
      ? `${cooldownSeconds}초 후 다시 갱신할 수 있습니다.`
      : "지금 다시 탐색합니다.";

  return (
    <header className="nf-header">
      <div className="nf-header__inner">
        <div className="nf-header__brand">
          {/* 제품명이 바로 옆에 있으므로 alt 를 비워 중복 안내를 만들지 않는다. */}
          <img className="nf-header__logo" src={BRAND_MARK_SRC} alt="" decoding="async" />
          <span className="nf-header__title">
            <strong>{EXTENSION_NAME}</strong>
            <span className="nf-header__tagline">작은 라이브를 먼저 발견합니다.</span>
          </span>
        </div>

        <div className="nf-header__status">
          <StatusBadge kind={status.kind} label={status.label} showDot={status.kind === "loading"} />
          <span className="nf-header__updated">{formatUpdatedAt(lastUpdatedAt)}</span>
        </div>

        <div className="nf-header__actions">
          <button
            type="button"
            className="nf-button nf-button--ghost"
            onClick={onRefresh}
            disabled={disabled}
            title={title}
            aria-label={
              cooldownMs > 0 ? `새로고침, ${cooldownSeconds}초 후 가능` : "결과 새로고침"
            }
          >
            <span className={isRunning ? "nf-button__spinner" : undefined}>
              <RefreshIcon size={16} />
            </span>
            {cooldownMs > 0 ? `${cooldownSeconds}초` : "새로고침"}
          </button>
        </div>
      </div>
    </header>
  );
}
