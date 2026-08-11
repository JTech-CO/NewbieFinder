import { AlertIcon, InfoIcon } from "./icons";

/** 배너는 결과를 가리지 않는다. Stack Trace 나 원시 응답을 노출하지 않는다. */

export type BannerKind = "error" | "warning" | "info";

export interface StateBannerProps {
  readonly kind: BannerKind;
  readonly title: string;
  readonly detail: string;
  /** 진단용 코드. 개발자에게 전달할 때만 쓰는 짧은 식별자다. */
  readonly code?: string | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}

export function StateBanner({
  kind,
  title,
  detail,
  code,
  actionLabel,
  onAction,
}: StateBannerProps) {
  return (
    <div
      className={`nf-banner nf-banner--${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <span className="nf-banner__icon" aria-hidden="true">
        {kind === "info" ? <InfoIcon size={18} /> : <AlertIcon size={18} />}
      </span>

      <div className="nf-banner__content">
        <p className="nf-banner__title">{title}</p>
        <p className="nf-banner__detail">{detail}</p>
        {code ? <p className="nf-banner__code">오류 코드: {code}</p> : null}
      </div>

      {actionLabel && onAction ? (
        <button type="button" className="nf-button nf-button--ghost nf-banner__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
