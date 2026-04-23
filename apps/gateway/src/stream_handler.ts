import type { CustomBaseEvent } from "./types"

export class AgentEventStream {
  private queue: CustomBaseEvent[] = []
  private closed = false
  private resolve: (() => void) | null = null
  private logWriter: ReturnType<ReturnType<typeof Bun.file>["writer"]>
  private logtoconsole = false

  // Heartbeat configuration
  private heartbeatIntervalMs: number;

  constructor(
    logFilePath: string = "agent-events.log",
    heartbeatIntervalMs: number = 15000 // Default to 15 seconds
  ) {
    this.logWriter = Bun.file(logFilePath).writer()
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  push(event: CustomBaseEvent) {
    if (this.closed) return
    const timestamp = new Date().toISOString()
    const logString = `[${timestamp}] ${JSON.stringify(event)}\n`

    try {
      this.logWriter.write(logString)
      this.logWriter.flush()
    } catch (err) {
      console.error(`[AgentEventStream] Failed to write to log file: ${err}`)
    }

    if (this.logtoconsole) {
      console.log(logString)
    }

    this.queue.push(event)

    // Wake up the iterator
    if (this.resolve) {
      this.resolve()
      this.resolve = null
    }
  }

  async close() {
    if (this.closed) return
    this.closed = true

    if (this.resolve) {
      this.resolve()
      this.resolve = null
    }

    try {
      await this.logWriter.end()
    } catch (err) {
      console.error('[AgentEventStream] Failed to close log writer:', err)
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<CustomBaseEvent> {
    while (true) {
      // 1. Drain the queue first
      while (this.queue.length > 0) {
        yield this.queue.shift()!
      }

      // 2. Check if we should exit
      if (this.closed) break

      // 3. Wait for either a push() or the heartbeat timeout
      await new Promise<void>((res) => {
        this.resolve = res

        // If no event is pushed within the interval, resolve anyway to trigger heartbeat
        setTimeout(() => {
          if (this.resolve === res) {
            res()
            this.resolve = null
          }
        }, this.heartbeatIntervalMs)
      })

      // 4. If the queue is still empty after waking up, it means the timeout fired
      if (this.queue.length === 0 && !this.closed) {
        // Yield a standard "ping" or "heartbeat" event
        // Using 'as any' here if CustomBaseEvent doesn't strictly allow this type
        yield {
          type: "heartbeat",
          timestamp: new Date().toISOString()
        } as unknown as CustomBaseEvent
      }
    }
  }
}
