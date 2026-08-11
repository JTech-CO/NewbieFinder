/**
 * In-flight 요청 합치기.
 *
 * 같은 채널을 여러 후보가 동시에 필요로 할 때 요청을 한 번만 보낸다.
 * 결과(성공/실패) 가 확정되면 항목을 지워 다음 요청이 새로 나갈 수 있게 한다.
 */
export class RequestDeduper<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  get size(): number {
    return this.inFlight.size;
  }

  has(key: string): boolean {
    return this.inFlight.has(key);
  }

  run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = factory().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.inFlight.clear();
  }
}
