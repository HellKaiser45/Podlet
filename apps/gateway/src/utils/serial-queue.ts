export class SerialQueue {
  private queue: Promise<void> = Promise.resolve();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let resolve: () => void;
    const prev = this.queue;
    this.queue = new Promise<void>(r => { resolve = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }
}
