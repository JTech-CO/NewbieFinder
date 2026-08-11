/** role="switch" + aria-checked 를 제공하고 색상만으로 상태를 전달하지 않는다. */

export interface ToggleSwitchProps {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** 라벨 요소의 id. 스크린 리더가 무엇을 켜고 끄는지 알 수 있어야 한다. */
  readonly labelledBy: string;
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  disabled = false,
}: ToggleSwitchProps) {
  // 네이티브 disabled 대신 aria-disabled 를 쓴다.
  // 비활성 이유(aria-describedby)를 읽으려면 스크린 리더가 컨트롤에 도달할 수 있어야 한다.
  const className = [
    "nf-switch",
    checked ? "nf-switch--on" : "",
    disabled ? "nf-switch--disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      className={className}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className="nf-switch__thumb" aria-hidden="true" />
      <span className="nf-visually-hidden">{checked ? "켜짐" : "꺼짐"}</span>
    </button>
  );
}
