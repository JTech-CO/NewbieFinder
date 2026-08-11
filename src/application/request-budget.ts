import type { PartialReason } from "../domain/models";
import { DISCOVERY_BUDGET } from "../shared/constants";
import { LIVE_PAGE_SIZE } from "../infrastructure/chzzk-web/endpoints";

/**
 * 탐색 예산.
 *
 * 팔로워 조건은 후보 1개당 채널 요청 1개를 유발한다.
 * 그래서 팔로워 조건이 켜져 있으면 라이브 페이지도 채널 예산에 맞춰 줄인다.
 * 판정하지도 못할 후보를 잔뜩 받아 오는 것은 요청 낭비다.
 */
export interface BudgetLimits {
  readonly maxLivePages: number;
  readonly maxChannelLookups: number;
}

export function resolveBudgetLimits(followerFilterEnabled: boolean): BudgetLimits {
  if (!followerFilterEnabled) {
    return {
      maxLivePages: DISCOVERY_BUDGET.maxLivePagesPerRun,
      maxChannelLookups: 0,
    };
  }
  // 채널 예산으로 판정 가능한 만큼만 라이브를 받아 온다.
  const pagesCoveringChannelBudget = Math.ceil(
    DISCOVERY_BUDGET.maxChannelLookupsPerRun / LIVE_PAGE_SIZE,
  );
  return {
    maxLivePages: Math.min(DISCOVERY_BUDGET.maxLivePagesPerRun, pagesCoveringChannelBudget),
    maxChannelLookups: DISCOVERY_BUDGET.maxChannelLookupsPerRun,
  };
}

export class RequestBudget {
  private livePages = 0;
  private channelLookups = 0;
  private hitLivePageLimit = false;
  private hitChannelLimit = false;

  constructor(private readonly limits: BudgetLimits) {}

  get livePagesUsed(): number {
    return this.livePages;
  }

  get channelLookupsUsed(): number {
    return this.channelLookups;
  }

  get maxChannelLookups(): number {
    return this.limits.maxChannelLookups;
  }

  canFetchLivePage(): boolean {
    if (this.livePages >= this.limits.maxLivePages) {
      this.hitLivePageLimit = true;
      return false;
    }
    return true;
  }

  consumeLivePage(): void {
    this.livePages += 1;
  }

  /** 요청한 개수만큼 채널 조회를 허용하되 남은 예산까지만 내준다. */
  grantChannelLookups(requested: number): number {
    const remaining = Math.max(0, this.limits.maxChannelLookups - this.channelLookups);
    const granted = Math.min(requested, remaining);
    if (granted < requested) this.hitChannelLimit = true;
    this.channelLookups += granted;
    return granted;
  }

  /** 예산 때문에 중단되었다면 그 이유. 예산이 남았으면 null. */
  get partialReason(): PartialReason | null {
    if (this.hitChannelLimit) return "channel-budget";
    if (this.hitLivePageLimit) return "page-budget";
    return null;
  }
}
