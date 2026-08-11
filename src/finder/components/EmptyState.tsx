import type { EmptyVariant } from "../app-selectors";
import { RadarIcon } from "./icons";

/** 과도한 일러스트 대신 작은 레이더 아이콘과 텍스트를 쓴다. */

export interface EmptyStateProps {
  readonly variant: Exclude<EmptyVariant, null>;
  readonly onAction?: (() => void) | undefined;
  readonly actionLabel?: string | undefined;
}

const COPY: Record<Exclude<EmptyVariant, null>, { title: string; detail: string }> = {
  "no-condition": {
    title: "탐색 조건을 하나 이상 켜세요.",
    detail: "시청자 수 또는 팔로워 수 기준을 선택하면 현재 라이브를 찾습니다.",
  },
  "no-result": {
    title: "현재 조건에 맞는 방송을 찾지 못했습니다.",
    detail: "상한을 조금 높이거나 다음 구간을 계속 탐색해 보세요.",
  },
  "no-live": {
    title: "현재 확인된 라이브가 없습니다.",
    detail: "잠시 후 새로고침해 주세요.",
  },
};

export function EmptyState({ variant, onAction, actionLabel }: EmptyStateProps) {
  const copy = COPY[variant];

  return (
    <div className="nf-empty">
      <span className="nf-empty__icon" aria-hidden="true">
        <RadarIcon size={32} />
      </span>
      <p className="nf-empty__title">{copy.title}</p>
      <p className="nf-empty__detail">{copy.detail}</p>
      {onAction && actionLabel ? (
        <button type="button" className="nf-button nf-button--primary nf-empty__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
