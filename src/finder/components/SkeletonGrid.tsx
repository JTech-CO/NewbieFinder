/** 기존 결과가 있을 때는 절대 스켈레톤으로 교체하지 않는다. 최초 로딩에서만 쓴다. */

export interface SkeletonGridProps {
  readonly count?: number;
}

export function SkeletonGrid({ count = 6 }: SkeletonGridProps) {
  return (
    <div className="nf-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="nf-skeleton" key={index}>
          <div className="nf-skeleton__media" />
          <div className="nf-skeleton__body">
            <div className="nf-skeleton__line" />
            <div className="nf-skeleton__line nf-skeleton__line--short" />
          </div>
        </div>
      ))}
    </div>
  );
}
