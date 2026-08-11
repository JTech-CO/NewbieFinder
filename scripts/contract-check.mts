#!/usr/bin/env node
/**
 * 수동 Contract Test.
 *
 * 실제 치지직 비공식 API 를 호출해 우리가 의존하는 응답 구조가 그대로인지 확인한다.
 * 이 검사는 "제품이 살아 있는지"를 보는 것이지 데이터를 수집하는 것이 아니다.
 *
 * 실행
 *   NF_CONTRACT_OK=1 npm run contract:live        (bash)
 *   $env:NF_CONTRACT_OK="1"; npm run contract:live (PowerShell)
 *
 * 안전 장치
 *   - 환경 변수 NF_CONTRACT_OK 가 "1" 이 아니면 안내만 출력하고 종료 코드 0 으로 끝난다.
 *     CI 나 `npm test` 가 실수로 실제 서버를 두드리지 않게 하기 위해서다.
 *   - 요청 사이에 최소 300ms 를 둔다.
 *   - 전체 요청 수를 10개로 제한한다. 초과하면 그 자리에서 실패한다.
 *   - 재시도하지 않는다. 접근이 막힌 것으로 보이면 우회하지 않고 그대로 보고한다.
 *
 * 이 파일은 Node 의 타입 스트리핑으로 그대로 실행된다.
 * (package.json: node --experimental-strip-types scripts/contract-check.mts)
 */

const API_ORIGIN = "https://api.chzzk.naver.com";
const LIVE_PATH = "/service/v1/lives";
const CHANNEL_PATH = "/service/v1/channels";

/** src/infrastructure/chzzk-web/endpoints.ts 의 LIVE_PAGE_SIZE 와 같아야 한다. */
const LIVE_PAGE_SIZE = 50;
/** 상한을 넘겨 요청했을 때의 동작을 확인하기 위한 값. */
const OVER_LIMIT_PAGE_SIZE = 51;
/** 시드 커서 확인에 쓰는 시청자 수 상한. (src/shared/constants.ts VIEWER_FILTER_RANGE.fallback) */
const VIEWER_CEILING = 10;

const MAX_REQUESTS = 10;
const MIN_REQUEST_INTERVAL_MS = 300;
const REQUEST_TIMEOUT_MS = 8_000;

interface CheckResult {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: CheckResult[] = [];
let requestCount = 0;
let lastRequestAt = 0;

function record(label: string, ok: boolean, detail = ""): boolean {
  results.push({ label, ok, detail });
  return ok;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `배열(길이 ${value.length})`;
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ApiResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly allowOrigin: string | null;
  readonly json: unknown;
  readonly parseError: string | null;
}

/**
 * 공개 데이터만 요청한다. 쿠키·인증 헤더를 붙이지 않는다.
 * Node 의 fetch 는 기본적으로 쿠키를 보내지 않으므로 별도 설정이 필요 없다.
 */
async function request(url: string): Promise<ApiResponse> {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`요청 상한 ${MAX_REQUESTS}개를 넘었습니다. 검사 항목을 줄여 주세요.`);
  }

  const waited = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && waited < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - waited);
  }

  requestCount += 1;
  lastRequestAt = Date.now();

  /*
   * User-Agent 를 자기 이름으로 밝힌다.
   *
   * Node 의 fetch(undici)는 기본적으로 User-Agent 를 보내지 않는데,
   * 그 상태로는 이 서버가 응답을 주지 않고 연결이 멈춘다.
   * 브라우저인 척하는 위장이 아니라
   * "이건 NewbieFinder 의 계약 점검 스크립트다"라고 정직하게 밝히는 것이다.
   * 확장 본체는 브라우저가 보내는 정상 User-Agent 를 그대로 쓰므로 이 설정이 필요 없다.
   */
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "NewbieFinder-ContractCheck (local development tool)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let json: unknown = null;
  let parseError: string | null = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  return {
    url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    allowOrigin: response.headers.get("access-control-allow-origin"),
    json,
    parseError,
  };
}

function liveListUrl(options: { size?: number; concurrentUserCount?: number; liveId?: number } = {}): string {
  const url = new URL(LIVE_PATH, API_ORIGIN);
  url.searchParams.set("size", String(options.size ?? LIVE_PAGE_SIZE));
  if (options.concurrentUserCount !== undefined) {
    url.searchParams.set("concurrentUserCount", String(options.concurrentUserCount));
    url.searchParams.set("liveId", String(options.liveId ?? 0));
  }
  return url.toString();
}

/** 라이브 목록 봉투에서 우리가 실제로 쓰는 부분만 꺼낸다. */
function readLiveList(json: unknown): {
  content: Record<string, unknown> | null;
  items: unknown[];
  next: Record<string, unknown> | null;
} {
  const content = isRecord(json) && isRecord(json.content) ? json.content : null;
  const items = content && Array.isArray(content.data) ? content.data : [];
  const page = content && isRecord(content.page) ? content.page : null;
  const next = page && isRecord(page.next) ? page.next : null;
  return { content, items, next };
}

async function runChecks(): Promise<void> {
  // 1. 라이브 목록 기본 호출 ------------------------------------------------
  const first = await request(liveListUrl());
  const firstOk = record(
    "라이브 목록이 2xx JSON 을 반환합니다.",
    first.status >= 200 && first.status < 300 && first.parseError === null,
    `HTTP ${first.status} / content-type: ${first.contentType || "(없음)"}${
      first.parseError ? ` / JSON 파싱 실패: ${first.parseError}` : ""
    }`,
  );

  record(
    "CORS 응답 헤더 (참고 항목)",
    true,
    first.allowOrigin
      ? `access-control-allow-origin: ${first.allowOrigin}`
      : "응답에 access-control-allow-origin 이 없습니다. 확장에서는 host_permissions 로 요청하므로 브라우저에서 별도 확인이 필요합니다.",
  );

  if (!firstOk) {
    record(
      "이후 항목을 건너뜁니다.",
      false,
      "첫 요청이 실패했습니다. 접근이 제한된 것으로 보이면 우회하지 말고 제품 범위를 재검토해 주세요.",
    );
    return;
  }

  const firstList = readLiveList(first.json);
  record(
    "content.data 가 배열입니다.",
    Array.isArray(firstList.content?.data),
    `content: ${describe(firstList.content)} / data: ${describe(firstList.content?.data)} / 항목 ${firstList.items.length}개`,
  );

  const nextCursor = firstList.next;
  record(
    "content.page.next 가 (concurrentUserCount, liveId) 커서입니다.",
    nextCursor !== null &&
      typeof nextCursor.concurrentUserCount === "number" &&
      typeof nextCursor.liveId === "number",
    nextCursor === null
      ? "page.next 가 없습니다. 마지막 페이지이거나 응답 구조가 바뀐 것입니다."
      : `next: ${JSON.stringify(nextCursor)}`,
  );

  const sampleItem = firstList.items.find((item) => isRecord(item));
  const item = isRecord(sampleItem) ? sampleItem : null;
  record(
    "라이브 항목에 시청자 수와 시작 시각이 있습니다.",
    item !== null && typeof item.concurrentUserCount === "number" && typeof item.openDate === "string",
    item === null
      ? "검사할 라이브 항목이 없습니다."
      : `concurrentUserCount: ${describe(item.concurrentUserCount)} / openDate: ${String(item.openDate)}`,
  );

  const itemChannel = item && isRecord(item.channel) ? item.channel : null;
  const channelId = itemChannel && typeof itemChannel.channelId === "string" ? itemChannel.channelId : null;
  record(
    "라이브 항목에 channel.channelId 가 있습니다.",
    channelId !== null && /^[0-9a-f]{32}$/.test(channelId),
    channelId === null ? "channelId 를 찾지 못했습니다." : `channelId 형식 확인 (${channelId.length}자)`,
  );

  // 2. size 상한 ------------------------------------------------------------
  const overLimit = await request(liveListUrl({ size: OVER_LIMIT_PAGE_SIZE }));
  const overLimitList = readLiveList(overLimit.json);
  record(
    `size 상한이 ${LIVE_PAGE_SIZE} 입니다.`,
    overLimitList.items.length === 0 || overLimitList.items.length <= LIVE_PAGE_SIZE,
    `size=${OVER_LIMIT_PAGE_SIZE} 요청 결과 항목 ${overLimitList.items.length}개 (0개면 상한 초과 시 빈 배열이라는 기존 관측과 같습니다)`,
  );
  record(
    `size=${LIVE_PAGE_SIZE} 요청이 ${LIVE_PAGE_SIZE}개 이하를 반환합니다.`,
    firstList.items.length <= LIVE_PAGE_SIZE,
    `항목 ${firstList.items.length}개`,
  );

  // 3. 시드 커서 -------------------------------------------------------------
  const seeded = await request(
    liveListUrl({ concurrentUserCount: VIEWER_CEILING + 1, liveId: 0 }),
  );
  const seededList = readLiveList(seeded.json);
  const seededCounts = seededList.items
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => (typeof entry.concurrentUserCount === "number" ? entry.concurrentUserCount : Number.NaN));
  const seededMax = seededCounts.length > 0 ? Math.max(...seededCounts) : Number.NaN;
  record(
    `시드 커서 (${VIEWER_CEILING + 1}, 0) 가 시청자 ${VIEWER_CEILING}명 이하 구간에서 시작합니다.`,
    seededCounts.length > 0 && Number.isFinite(seededMax) && seededMax <= VIEWER_CEILING,
    seededCounts.length === 0
      ? "결과가 없습니다. 시각대에 따라 실제로 비어 있을 수 있으니 다시 확인해 주세요."
      : `항목 ${seededCounts.length}개, 최대 시청자 수 ${seededMax}명`,
  );

  // 4. 다음 페이지 커서 동작 -------------------------------------------------
  if (nextCursor !== null && typeof nextCursor.concurrentUserCount === "number" && typeof nextCursor.liveId === "number") {
    const second = await request(
      liveListUrl({ concurrentUserCount: nextCursor.concurrentUserCount, liveId: nextCursor.liveId }),
    );
    const secondList = readLiveList(second.json);
    const firstIds = new Set(
      firstList.items
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => String(entry.liveId)),
    );
    const overlapping = secondList.items
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .filter((entry) => firstIds.has(String(entry.liveId))).length;
    record(
      "page.next 커서로 다음 페이지를 이어받습니다.",
      second.status >= 200 && second.status < 300 && secondList.items.length > 0 && overlapping === 0,
      `HTTP ${second.status} / 항목 ${secondList.items.length}개 / 첫 페이지와 중복 ${overlapping}개`,
    );
  }

  // 5. 채널 팔로워 수 --------------------------------------------------------
  if (channelId !== null) {
    const channel = await request(new URL(`${CHANNEL_PATH}/${channelId}`, API_ORIGIN).toString());
    const channelContent = isRecord(channel.json) && isRecord(channel.json.content) ? channel.json.content : null;
    record(
      "채널 응답에 followerCount 가 있습니다.",
      channel.status >= 200 &&
        channel.status < 300 &&
        channelContent !== null &&
        typeof channelContent.followerCount === "number",
      `HTTP ${channel.status} / followerCount: ${describe(channelContent?.followerCount)}`,
    );
  } else {
    record("채널 응답에 followerCount 가 있습니다.", false, "channelId 를 얻지 못해 확인하지 못했습니다.");
  }

  // 6. 쿠키 없이 공개 데이터 -------------------------------------------------
  record(
    "로그인 쿠키 없이 공개 데이터를 받았습니다.",
    firstList.items.length > 0,
    "이 스크립트는 Cookie·Authorization 헤더를 보내지 않습니다. 위 요청들이 성공했다면 공개 데이터만으로 동작합니다.",
  );
}

async function main(): Promise<void> {
  if (process.env.NF_CONTRACT_OK !== "1") {
    console.log("Contract Test 는 실제 치지직 서버에 요청을 보냅니다. 자동 실행을 막아 두었습니다.\n");
    console.log("실행하려면 환경 변수를 설정해 주세요.");
    console.log("  PowerShell : $env:NF_CONTRACT_OK=\"1\"; npm run contract:live");
    console.log("  bash/zsh   : NF_CONTRACT_OK=1 npm run contract:live\n");
    console.log(`요청은 최대 ${MAX_REQUESTS}개, 요청 간격은 최소 ${MIN_REQUEST_INTERVAL_MS}ms 로 제한됩니다.`);
    console.log("실패가 접근 제한을 뜻한다면 우회하지 말고 제품 범위를 다시 검토해 주세요.");
    return;
  }

  console.log("치지직 비공식 API Contract Test 를 시작합니다.");
  console.log(`대상: ${API_ORIGIN}\n`);

  try {
    await runChecks();
  } catch (error) {
    record(
      "검사 진행",
      false,
      `요청 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.label}`);
    if (result.detail.length > 0) {
      console.log(`    ${result.detail}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log("");
  console.log(`요청 ${requestCount}개 / 검사 ${results.length}건 중 실패 ${failed.length}건`);

  if (failed.length > 0) {
    console.error("\n계약이 달라졌을 수 있습니다.");
    console.error("infrastructure/chzzk-web 의 endpoints·schema·adapter 를 먼저 확인해 주세요.");
    console.error("접근 제한으로 보이는 경우에는 우회 구현을 추가하지 않습니다.");
    process.exitCode = 1;
    return;
  }

  console.log("확인한 범위에서 응답 구조가 기존 계약과 같습니다.");
}

await main();
