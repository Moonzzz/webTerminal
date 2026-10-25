/** Serial execution with admission limits, including the running operation. */
export class BoundedTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private bytes = 0;
  private tasks = 0;
  private stopped = false;

  constructor(private readonly limits: { maxPendingBytes: number; maxPendingMessages: number }) {}

  enqueue(bytes: number, operation: () => Promise<void>): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Transport queue closed'));
    if (this.bytes + bytes > this.limits.maxPendingBytes || this.tasks >= this.limits.maxPendingMessages) {
      this.stop();
      return Promise.reject(new Error('Terminal transport backlog exceeds limit'));
    }
    this.bytes += bytes;
    this.tasks++;
    const result = this.tail.then(async () => {
      if (!this.stopped) await operation();
    }).finally(() => {
      this.bytes -= bytes;
      this.tasks--;
    });
    this.tail = result.catch(() => { this.stop(); });
    return result;
  }

  drain() { return this.tail; }
  stop() { this.stopped = true; }
}
