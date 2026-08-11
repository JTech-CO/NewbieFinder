/**
 * 로컬 번들 아이콘. 외부 아이콘 패키지나 원격 SVG 를 쓰지 않는다.
 * 선 굵기 1.75~2px, 외곽선 스타일.
 *
 * 공식 인증 마크처럼 보이는 체크 표시는 만들지 않는다.
 */

interface IconProps {
  readonly size?: number;
  readonly className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className: ["nf-icon", className].filter(Boolean).join(" "),
  };
}

/**
 * 제품 상징. 확장 아이콘(public/icons)과 같은 도형이다.
 *
 * 가운데 점은 아직 크게 노출되지 않은 라이브, 열린 두 개의 링은 탐색 과정을 뜻한다.
 * 링을 닫지 않고 오른쪽 아래를 비워 두는 것이 이 표식의 특징이므로
 * scripts/generate-icons.mjs 의 도형을 바꾸면 여기도 같이 바꿔야 한다.
 */
export function RadarIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M11.82 17.28 A5.28 5.28 0 1 1 16.48 14.8" />
      <path d="M11.68 21.12 A9.12 9.12 0 1 1 19.73 16.83" />
    </svg>
  );
}

export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 11a8 8 0 1 0-2.3 6" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function AlertIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.4h.01" />
    </svg>
  );
}

export function InfoIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6h.01" />
    </svg>
  );
}

export function ViewerIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M16.5 20v-1.7a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20" />
      <circle cx="10" cy="8" r="3.4" />
      <path d="M20.5 20v-1.7a3.5 3.5 0 0 0-2.6-3.4" />
    </svg>
  );
}

export function FollowerIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 20.2 4.9 13.4a4.3 4.3 0 0 1 6-6.1l1.1 1 1.1-1a4.3 4.3 0 0 1 6 6.1z" />
    </svg>
  );
}

export function ClockIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.4V12l3 1.8" />
    </svg>
  );
}

export function TagIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 12.6 12.6 20a1.8 1.8 0 0 1-2.5 0L4 13.9V4h9.9l6.1 6.1a1.8 1.8 0 0 1 0 2.5z" />
      <path d="M8.4 8.4h.01" />
    </svg>
  );
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  );
}
