import type { FilterOutcome } from "../../domain/filters";

/**
 * 결과 수는 aria-live="polite" 로 알린다.
 * 완전 탐색과 부분 탐색 문구를 반드시 다르게 쓴다.
 */

export interface ResultSummaryProps {
  readonly resultCount: number;
  readonly conditionSummary: string;
  readonly coverageNote: string | null;
  readonly outcome: FilterOutcome;
  /** 시청자·팔로워 조건이 하나라도 켜져 있는지 */
  readonly conditionActive: boolean;
}

export function ResultSummary({
  resultCount,
  conditionSummary,
  coverageNote,
  outcome,
  conditionActive,
}: ResultSummaryProps) {
  // 조건이 없으면 개수를 세지 않는다.
  // "12개 찾았습니다" 와 "조건을 켜세요" 가 같이 뜨면 사용자를 헷갈리게 한다.
  if (!conditionActive) {
    return (
      <div className="nf-summary">
        <p className="nf-summary__count" aria-live="polite">
          아직 탐색 조건이 없습니다.
        </p>
        <p className="nf-summary__conditions">{conditionSummary}</p>
      </div>
    );
  }

  return (
    <div className="nf-summary">
      <p className="nf-summary__count" aria-live="polite">
        {resultCount > 0
          ? `${resultCount.toLocaleString("ko-KR")}개 방송을 찾았습니다.`
          : "조건에 맞는 방송이 아직 없습니다."}
      </p>
      <p className="nf-summary__conditions">{conditionSummary}</p>

      {coverageNote ? <p className="nf-summary__coverage">{coverageNote}</p> : null}

      {outcome.awaitingFollower > 0 || outcome.unresolvedFollower > 0 ? (
        <p className="nf-summary__pending">
          {outcome.awaitingFollower > 0
            ? `팔로워 판정 중 ${outcome.awaitingFollower.toLocaleString("ko-KR")}개`
            : null}
          {outcome.awaitingFollower > 0 && outcome.unresolvedFollower > 0 ? " · " : null}
          {outcome.unresolvedFollower > 0
            ? `팔로워 확인 실패 ${outcome.unresolvedFollower.toLocaleString("ko-KR")}개`
            : null}
        </p>
      ) : null}
    </div>
  );
}
