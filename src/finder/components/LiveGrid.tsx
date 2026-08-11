import type { StreamCandidate } from "../../domain/models";
import { LiveCard } from "./LiveCard";

/** 카드 최소 폭 280px 기준으로 열 수가 자동 결정된다. 정렬 키는 liveId 로 고정해 재사용된다. */

export interface LiveGridProps {
  readonly candidates: readonly StreamCandidate[];
  readonly now: number;
}

export function LiveGrid({ candidates, now }: LiveGridProps) {
  return (
    <div className="nf-grid">
      {candidates.map((candidate) => (
        <LiveCard key={candidate.liveId} candidate={candidate} now={now} />
      ))}
    </div>
  );
}
