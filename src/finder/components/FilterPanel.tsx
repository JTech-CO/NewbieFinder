import type { FinderSettings } from "../../domain/settings";
import { describeConditions, isBaseFilterActive } from "../../domain/settings";
import { FOLLOWER_FILTER_RANGE, VIEWER_FILTER_RANGE } from "../../shared/constants";
import { FilterControl } from "./FilterControl";
import { CloseIcon } from "./icons";
import { RecentSortControl } from "./RecentSortControl";

export interface FilterPanelProps {
  readonly settings: FinderSettings;
  readonly onChange: (next: FinderSettings) => void;
  readonly noticeDismissed: boolean;
  readonly onDismissNotice: () => void;
}

export function FilterPanel({
  settings,
  onChange,
  noticeDismissed,
  onDismissNotice,
}: FilterPanelProps) {
  const baseActive = isBaseFilterActive(settings);

  return (
    <aside className="nf-panel" aria-label="뉴비 탐색 조건">
      <h2 className="nf-panel__title">뉴비 조건</h2>

      <div className="nf-panel__body">
        <FilterControl
          label="시청자 수"
          enabled={settings.viewerFilter.enabled}
          value={settings.viewerFilter.max}
          min={VIEWER_FILTER_RANGE.min}
          max={VIEWER_FILTER_RANGE.max}
          unitLabel="명 이하"
          onToggle={(enabled) =>
            onChange({ ...settings, viewerFilter: { ...settings.viewerFilter, enabled } })
          }
          onValueChange={(max) =>
            onChange({ ...settings, viewerFilter: { ...settings.viewerFilter, max } })
          }
        />

        <FilterControl
          label="팔로워 수"
          enabled={settings.followerFilter.enabled}
          value={settings.followerFilter.max}
          min={FOLLOWER_FILTER_RANGE.min}
          max={FOLLOWER_FILTER_RANGE.max}
          unitLabel="명 이하"
          onToggle={(enabled) =>
            onChange({ ...settings, followerFilter: { ...settings.followerFilter, enabled } })
          }
          onValueChange={(max) =>
            onChange({ ...settings, followerFilter: { ...settings.followerFilter, max } })
          }
        />

        <RecentSortControl
          checked={settings.recentFirst}
          available={baseActive}
          onToggle={(recentFirst) => onChange({ ...settings, recentFirst })}
        />
      </div>

      <div className="nf-panel__summary">
        <span className="nf-panel__summary-label">현재 조건</span>
        <p>{describeConditions(settings)}</p>
      </div>

      <p className="nf-panel__help">
        두 조건을 함께 켜면 시청자 수와 팔로워 수를 모두 만족하는 방송만 표시합니다.
      </p>

      {noticeDismissed ? null : (
        <div className="nf-inline-note" role="note">
          <p>
            팔로워 조건은 채널 정보를 순차 확인하므로 시청자 조건보다 결과가 늦게 표시될 수 있습니다.
          </p>
          <button
            type="button"
            className="nf-inline-note__close"
            onClick={onDismissNotice}
            aria-label="안내 닫기"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </aside>
  );
}
