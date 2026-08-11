/**
 * 동시성 제한 큐. 범용 라이브러리를 넣지 않고 작은 내부 유틸로 구현한다.
 *
 * 채널 조회를 4개까지만 병렬 실행해 비공식 API 에 부담을 주지 않는 것이 목적이다.
 */

type Task<T> = () => Promise<T>;

export class PromisePool {
  private readonly concurrency: number;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError("concurrency 는 1 이상의 정수여야 합니다.");
    }
    this.concurrency = concurrency;
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  async run<T>(task: Task<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** 아직 시작하지 않은 대기 작업을 모두 흘려보낸다. 취소 시 사용한다. */
  drainWaiting(): void {
    while (this.waiting.length > 0) {
      this.waiting.shift()?.();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}

/**
 * 항목들을 동시성 제한 아래에서 처리하고, 완료되는 순서대로 콜백을 호출한다.
 * 점진적 결과 표시를 위해 전체 완료를 기다리지 않는다.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R | null, item: T, index: number) => void,
): Promise<Array<R | null>> {
  const pool = new PromisePool(concurrency);
  const results: Array<R | null> = new Array(items.length).fill(null);

  await Promise.all(
    items.map((item, index) =>
      pool
        .run(() => worker(item, index))
        .then(
          (value) => {
            results[index] = value;
            onSettled?.(value, item, index);
          },
          () => {
            results[index] = null;
            onSettled?.(null, item, index);
          },
        ),
    ),
  );

  return results;
}
