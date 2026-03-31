import { CustomBaseEvent } from "./types"


export class AgentEventStream {
  private queue: (CustomBaseEvent | null)[] = [];
  private closed = false;
  private resolve: (() => void) | null = null;
  private heartbeatInterval: Timer | null = null;

  constructor() {
    this.heartbeatInterval = setInterval(() => {
      if (this.closed) return;
      this.queue.push(null); // null = heartbeat
      this.resolve?.();
      this.resolve = null;
    }, 5000);
  }

  push(event: CustomBaseEvent) {
    if (this.closed) return;
    this.queue.push(event);
    this.resolve?.();
    this.resolve = null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.resolve?.();
    this.resolve = null;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event === null) {
          yield `: heartbeat\n\n`; // SSE comment, clients ignore it
        } else {
          yield `data: ${JSON.stringify(event)}\n\n`;
        }
      }
      if (this.closed) break;
      await new Promise<void>(r => this.resolve = r);
    }
  }
}
