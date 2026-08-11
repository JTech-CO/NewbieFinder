import { useId } from "react";
import { LockIcon } from "./icons";
import { ToggleSwitch } from "./ToggleSwitch";

/**
 * 기본 조건이 하나도 없으면 선택할 수 없다.
 * 잠금 아이콘과 설명을 함께 써서 색상만으로 비활성을 전달하지 않는다.
 */

export interface RecentSortControlProps {
  readonly checked: boolean;
  readonly available: boolean;
  readonly onToggle: (next: boolean) => void;
}

export function RecentSortControl({ checked, available, onToggle }: RecentSortControlProps) {
  const labelId = useId();
  const hintId = useId();

  return (
    <div className={`nf-recent${available ? "" : " nf-recent--locked"}`}>
      <div className="nf-recent__row">
        {/*
          잠겼을 때도 스위치를 렌더링한다. 컨트롤이 아예 사라지면 스크린 리더가
          "왜 못 쓰는지"에 도달할 수 없고, 키보드 사용자도 이유를 알 수 없다.
        */}
        <ToggleSwitch
          checked={checked}
          onChange={onToggle}
          labelledBy={labelId}
          describedBy={hintId}
          disabled={!available}
        />
        {available ? null : (
          <span className="nf-recent__lock" aria-hidden="true">
            <LockIcon size={16} />
          </span>
        )}
        <span className="nf-filter__label" id={labelId}>
          최근 시작한 방송부터
        </span>
      </div>
      <p className="nf-recent__hint" id={hintId}>
        {available
          ? "규모 조건을 통과한 방송 안에서 정렬합니다."
          : "시청자 수 또는 팔로워 수 조건을 먼저 켜세요."}
      </p>
    </div>
  );
}
