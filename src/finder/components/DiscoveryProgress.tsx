import type { CSSProperties } from "react";
import type { DiscoveryState } from "../../domain/models";
import { selectProgressText } from "../app-selectors";

/**
 * 결과 그리드를 막는 전체 화면 스피너를 쓰지 않는다.
 * 총량을 모르면 진행률 대신 처리한 숫자를 그대로 보여 준다.
 */

export interface DiscoveryProgressProps {
  readonly discovery: DiscoveryState;
  readonly isRunning: boolean;
}

export function DiscoveryProgress({ discovery, isRunning }: DiscoveryProgressProps) {
  const lines = selectProgressText(discovery);
  if (!isRunning && lines.length === 0) return null;

  const judged = discovery.resolvedChannels + discovery.unresolvedChannels;
  const total = judged + discovery.pendingChannels;
  const ratio = total > 0 ? Math.min(1, judged / total) : null;

  return (
    <div className="nf-progress" aria-live="polite" aria-busy={isRunning}>
      {ratio !== null && discovery.pendingChannels > 0 ? (
        <div
          className="nf-progress__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={judged}
          aria-label="채널 정보 판정 진행률"
        >
          <div
            className="nf-progress__fill"
            style={{ "--nf-progress-value": `${Math.round(ratio * 100)}%` } as CSSProperties}
          />
        </div>
      ) : null}

      <div className="nf-progress__text">
        {lines.map((line) => (
          <span className="nf-progress__row" key={line}>
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}
