export type Priority = "critical" | "normal";

export class GateSaturatedError extends Error {
  constructor(
    public readonly label: string,
    public readonly maxQueueDepth: number,
  ) {
    super(`Concurrency gate "${label}" saturated (queue depth >= ${maxQueueDepth})`);
    this.name = "GateSaturatedError";
  }
}

export class GateAbortedError extends Error {
  constructor(public readonly label: string) {
    super(`Concurrency gate "${label}" lease acquisition aborted`);
    this.name = "GateAbortedError";
  }
}

export interface ConcurrencyGateOptions {
  maxConcurrent?: number;
  maxQueueDepth?: number;
  label?: string;
}

export class ConcurrencyGate {
  private active = 0;
  private criticalQueue: Array<() => void> = [];
  private normalQueue: Array<() => void> = [];
  private consecutiveCriticalDispatches = 0;

  readonly maxConcurrent: number;
  readonly maxQueueDepth: number;
  readonly label: string;

  constructor(opts: ConcurrencyGateOptions = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
    this.maxQueueDepth = Math.max(1, opts.maxQueueDepth ?? 100);
    this.label = opts.label ?? "default";
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.criticalQueue.length + this.normalQueue.length;
  }

  async acquire(priority: Priority = "normal", signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new GateAbortedError(this.label);
    if (this.queuedCount >= this.maxQueueDepth) {
      throw new GateSaturatedError(this.label, this.maxQueueDepth);
    }
    if (this.active < this.maxConcurrent) {
      return this.grantLease();
    }

    return new Promise<() => void>((resolve, reject) => {
      let entry: (() => void) | undefined;
      const onAbort = () => {
        this.criticalQueue = this.criticalQueue.filter((e) => e !== entry);
        this.normalQueue = this.normalQueue.filter((e) => e !== entry);
        reject(new GateAbortedError(this.label));
      };

      entry = () => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          this.dispatchNext();
          reject(new GateAbortedError(this.label));
          return;
        }
        resolve(this.grantLease());
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      (priority === "critical" ? this.criticalQueue : this.normalQueue).push(entry);
    });
  }

  async run<T>(fn: () => Promise<T>, priority: Priority = "normal", signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(priority, signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private grantLease(): () => void {
    this.active++;
    let used = false;
    return () => {
      if (used) return;
      used = true;
      this.dispatchNext();
    };
  }

  private dispatchNext(): void {
    this.active--;
    let next: (() => void) | undefined;

    // Prevent critical lane from permanently starving normal lane
    if (this.criticalQueue.length > 0 && this.consecutiveCriticalDispatches < 10) {
      next = this.criticalQueue.shift();
      this.consecutiveCriticalDispatches++;
    } else if (this.normalQueue.length > 0) {
      next = this.normalQueue.shift();
      this.consecutiveCriticalDispatches = 0;
    } else if (this.criticalQueue.length > 0) {
      next = this.criticalQueue.shift();
      this.consecutiveCriticalDispatches++;
    } else {
      this.consecutiveCriticalDispatches = 0;
    }

    next?.();
  }
}
