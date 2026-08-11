import type { Dispatch } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { FinderSettings } from "../../domain/settings";
import { STORAGE_KEYS } from "../../shared/constants";
import { localStore } from "../../infrastructure/storage/chrome-storage";
import { loadSettings, saveSettings } from "../../infrastructure/storage/settings-store";
import type { FinderAction, FinderState } from "../app-reducer";

const SAVE_DEBOUNCE_MS = 250;

/**
 * 설정 읽기·쓰기.
 *
 * 저장 실패는 화면을 멈추지 않는다. 메모리 상태로 계속 쓰되 고지만 남긴다.
 */
export function useSettings(
  state: FinderState,
  dispatch: Dispatch<FinderAction>,
): {
  updateSettings: (next: FinderSettings) => void;
  dismissNotice: () => void;
} {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;
    void (async () => {
      const [settings, dismissed] = await Promise.all([
        loadSettings(),
        localStore.get<boolean>(STORAGE_KEYS.dismissedNotices),
      ]);
      if (cancelled) return;
      dispatch({ type: "settings/hydrated", settings, noticeDismissed: dismissed === true });
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // 변경 저장 (Debounce). 슬라이더를 끌 때마다 storage 를 두드리지 않는다.
  useEffect(() => {
    if (!state.settingsLoaded) return;

    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    const settings = state.settings;
    saveTimer.current = setTimeout(() => {
      void saveSettings(settings).then((okResult) => {
        if (!okResult) dispatch({ type: "settings/save-failed" });
      });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
  }, [state.settings, state.settingsLoaded, dispatch]);

  const updateSettings = useCallback(
    (next: FinderSettings) => {
      dispatch({ type: "settings/changed", settings: next });
    },
    [dispatch],
  );

  const dismissNotice = useCallback(() => {
    dispatch({ type: "notice/dismissed" });
    void localStore.set(STORAGE_KEYS.dismissedNotices, true);
  }, [dispatch]);

  return { updateSettings, dismissNotice };
}
