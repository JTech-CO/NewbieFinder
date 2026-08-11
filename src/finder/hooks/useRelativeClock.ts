import { useEffect, useState } from "react";
import { RELATIVE_CLOCK_INTERVAL_MS } from "../../shared/constants";

/**
 * 공유 클럭.
 *
 * 카드마다 타이머를 만들지 않는다. 화면 전체가 1분에 한 번만 상대 시간을 다시 계산한다.
 * 탭이 숨겨져 있으면 갱신하지 않고, 다시 보일 때 즉시 맞춘다.
 * 화면을 닫으면 타이머가 남지 않는다.
 */
export function useRelativeClock(intervalMs = RELATIVE_CLOCK_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = (): void => {
      if (timer !== null) return;
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = (): void => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);

  return now;
}
