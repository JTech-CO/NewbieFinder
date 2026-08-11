import type { StatusKind } from "../app-selectors";

/** 대문자는 LIVE 에만 쓴다. 색만으로 상태를 구분하지 않도록 항상 텍스트를 함께 둔다. */

export interface StatusBadgeProps {
  readonly kind: StatusKind | "live";
  readonly label: string;
  readonly showDot?: boolean;
}

export function StatusBadge({ kind, label, showDot = false }: StatusBadgeProps) {
  return (
    <span className={`nf-badge nf-badge--${kind}`}>
      {showDot ? <span className="nf-badge__dot" aria-hidden="true" /> : null}
      {label}
    </span>
  );
}
