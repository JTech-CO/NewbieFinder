import type { CSSProperties } from "react";
import { useEffect, useId, useState } from "react";
import { clampInt } from "../../domain/settings";
import { ToggleSwitch } from "./ToggleSwitch";

/**
 * Toggle, Number, Range 가 같은 값을 공유한다.
 * OFF 여도 마지막 숫자를 잃지 않는다. Number 를 클릭한다고 자동으로 켜지지 않는다.
 */

export interface FilterControlProps {
  readonly label: string;
  readonly enabled: boolean;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unitLabel: string;
  readonly onToggle: (next: boolean) => void;
  readonly onValueChange: (next: number) => void;
}

export function FilterControl({
  label,
  enabled,
  value,
  min,
  max,
  unitLabel,
  onToggle,
  onValueChange,
}: FilterControlProps) {
  const labelId = useId();
  const inputId = useId();
  const rangeId = useId();

  // 입력 중에는 화면 값을 그대로 두고, 확정(blur/Enter) 시점에 정규화한다.
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string): void => {
    const next = clampInt(raw, min, max, value);
    setDraft(String(next));
    if (next !== value) onValueChange(next);
  };

  const valueText = `${value}${unitLabel}`;

  // 슬라이더의 Active Fill 비율은 CSS 가 `--nf-range-fill` 로 받는다.
  // 조건이 꺼져 있으면 값은 그대로 두되 Fill 은 비운다. 적용 중인 것처럼 보이면 안 된다.
  const fillPercent = !enabled || max <= min ? 0 : ((value - min) / (max - min)) * 100;
  const rangeStyle = { "--nf-range-fill": `${fillPercent.toFixed(1)}%` } as CSSProperties;

  return (
    <div className={`nf-filter${enabled ? "" : " nf-filter--disabled"}`}>
      <div className="nf-filter__head">
        <ToggleSwitch checked={enabled} onChange={onToggle} labelledBy={labelId} />
        <span className="nf-filter__label" id={labelId}>
          {label}
        </span>

        <span className="nf-filter__control">
          <label className="nf-visually-hidden" htmlFor={inputId}>
            {`최대 ${label}`}
          </label>
          <input
            id={inputId}
            className="nf-number"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(event.currentTarget.value);
            }}
          />
          <span className="nf-filter__unit">{unitLabel}</span>
        </span>
      </div>

      <input
        id={rangeId}
        className="nf-range"
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        style={rangeStyle}
        aria-label={`최대 ${label}`}
        aria-valuetext={valueText}
        onChange={(event) => onValueChange(clampInt(event.target.value, min, max, value))}
      />

      <div className="nf-filter__bounds" aria-hidden="true">
        <span className="nf-filter__bound">{min}</span>
        <span className="nf-filter__bound">{max}</span>
      </div>
    </div>
  );
}
