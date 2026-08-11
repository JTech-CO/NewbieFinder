/**
 * 탐색 오류 모델.
 *
 * 원칙: 비공식 응답이 깨졌을 때 임의 추론으로 필드를 채우지 않고 진단 가능한 상태로 멈춘다.
 * 사용자에게 Stack Trace 나 원시 응답을 보여주지 않는다.
 */

export type DiscoveryErrorCode =
  | "NETWORK_OFFLINE"
  | "REQUEST_TIMEOUT"
  | "RATE_LIMITED"
  | "ACCESS_DENIED"
  | "LIVE_SCHEMA_CHANGED"
  | "CHANNEL_SCHEMA_CHANGED"
  | "INVALID_RESPONSE"
  | "STORAGE_FAILURE"
  | "UNKNOWN";

export interface DiscoveryErrorInfo {
  readonly code: DiscoveryErrorCode;
  /** 사용자에게 보여줄 한 줄 요약 */
  readonly title: string;
  /** 무슨 일이 있었고 무엇을 할 수 있는지 */
  readonly detail: string;
  /** 재시도 버튼을 제공할지 */
  readonly retryable: boolean;
  /** 이 오류로 인해 결과 그리드를 숨겨야 하는지 (계약 파손 계열) */
  readonly hidesResults: boolean;
}

export const DISCOVERY_ERROR_INFO: Readonly<Record<DiscoveryErrorCode, DiscoveryErrorInfo>> = {
  NETWORK_OFFLINE: {
    code: "NETWORK_OFFLINE",
    title: "인터넷 연결을 확인해 주세요.",
    detail: "네트워크에 연결되면 다시 탐색할 수 있습니다. 저장된 이전 결과가 있으면 함께 표시합니다.",
    retryable: true,
    hidesResults: false,
  },
  REQUEST_TIMEOUT: {
    code: "REQUEST_TIMEOUT",
    title: "치지직 응답이 지연되고 있습니다.",
    detail: "확인한 범위까지만 결과로 표시했습니다. 잠시 후 다시 시도해 주세요.",
    retryable: true,
    hidesResults: false,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    title: "요청이 제한되어 갱신을 잠시 중단했습니다.",
    detail: "요청을 더 보내지 않고 확보한 결과만 표시합니다. 잠시 후 새로고침해 주세요.",
    retryable: true,
    hidesResults: false,
  },
  ACCESS_DENIED: {
    code: "ACCESS_DENIED",
    title: "현재 데이터에 접근할 수 없습니다.",
    detail: "치지직이 이 요청을 허용하지 않았습니다. 우회하지 않고 탐색을 중단했습니다.",
    retryable: false,
    hidesResults: false,
  },
  LIVE_SCHEMA_CHANGED: {
    code: "LIVE_SCHEMA_CHANGED",
    title: "치지직 데이터 형식이 변경된 것으로 보입니다.",
    detail: "잘못된 결과를 표시하지 않고 탐색을 중단했습니다. 확장 업데이트가 필요할 수 있습니다.",
    retryable: true,
    hidesResults: true,
  },
  CHANNEL_SCHEMA_CHANGED: {
    code: "CHANNEL_SCHEMA_CHANGED",
    title: "팔로워 정보를 확인할 수 없습니다.",
    detail: "채널 응답 형식이 예상과 다릅니다. 시청자 조건 결과만 표시합니다.",
    retryable: true,
    hidesResults: false,
  },
  INVALID_RESPONSE: {
    code: "INVALID_RESPONSE",
    title: "응답을 해석하지 못했습니다.",
    detail: "예상한 형식의 데이터가 아니어서 결과를 만들지 않았습니다.",
    retryable: true,
    hidesResults: true,
  },
  STORAGE_FAILURE: {
    code: "STORAGE_FAILURE",
    title: "설정을 저장하지 못했습니다.",
    detail: "이번 탭에서는 계속 사용할 수 있지만 변경한 조건이 다음 실행에 남지 않을 수 있습니다.",
    retryable: false,
    hidesResults: false,
  },
  UNKNOWN: {
    code: "UNKNOWN",
    title: "알 수 없는 문제가 발생했습니다.",
    detail: "탐색을 중단했습니다. 새로고침해도 반복되면 확장 업데이트를 확인해 주세요.",
    retryable: true,
    hidesResults: false,
  },
};

export function describeDiscoveryError(code: DiscoveryErrorCode): DiscoveryErrorInfo {
  return DISCOVERY_ERROR_INFO[code] ?? DISCOVERY_ERROR_INFO.UNKNOWN;
}

/**
 * 탐색 계층 전용 오류.
 * `cause` 는 개발 로그에만 쓰고 사용자 화면에는 노출하지 않는다.
 */
export class DiscoveryError extends Error {
  override readonly name = "DiscoveryError";
  readonly code: DiscoveryErrorCode;
  /** HTTP 상태 등 진단에만 쓰는 부가 정보 */
  readonly status?: number;

  constructor(code: DiscoveryErrorCode, options?: { status?: number; cause?: unknown }) {
    super(describeDiscoveryError(code).title, options?.cause ? { cause: options.cause } : undefined);
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}

export function toDiscoveryErrorCode(error: unknown): DiscoveryErrorCode {
  if (error instanceof DiscoveryError) return error.code;
  if (error instanceof DOMException && error.name === "AbortError") return "REQUEST_TIMEOUT";
  if (error instanceof TypeError) return "NETWORK_OFFLINE";
  return "UNKNOWN";
}

/** 계약 파손 계열인지 (결과 그리드를 숨기고 진단을 보여야 하는지) */
export function isContractError(code: DiscoveryErrorCode): boolean {
  return code === "LIVE_SCHEMA_CHANGED" || code === "INVALID_RESPONSE";
}
