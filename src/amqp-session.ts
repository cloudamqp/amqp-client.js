import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { ConsumeParams, QueueParams } from "./amqp-channel.js"
import { AMQPConsumer } from "./amqp-consumer.js"
import type { AMQPMessage } from "./amqp-message.js"

/**
 * Options for automatic reconnection behavior
 */
export interface ReconnectOptions {
  /** Initial delay in milliseconds before reconnecting (default: 1000) */
  reconnectInterval?: number
  /** Maximum delay in milliseconds between reconnection attempts (default: 30000) */
  maxReconnectInterval?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Maximum number of reconnection attempts, 0 for infinite (default: 0) */
  maxRetries?: number
}

/** @internal */
interface ConsumerDefinition {
  queue: string
  params: ConsumeParams
  callback: (msg: AMQPMessage) => void | Promise<void>
  prefetch: number | undefined
  queueParams: QueueParams | undefined
  queueArgs: Record<string, unknown> | undefined
}

/**
 * High-level session with automatic reconnection and consumer recovery.
 *
 * Created via `client.start(options)`. Owns the reconnection loop,
 * consumer tracking, and lifecycle callbacks.
 */
export class AMQPSession {
  /** Fires after a successful (re)connection and consumer recovery */
  onconnect?: () => void
  /** Fires when the connection is lost */
  ondisconnect?: (error?: Error) => void
  /** Fires before each reconnection attempt */
  onreconnecting?: (attempt: number) => void
  /** Fires when max retries are exhausted */
  onfailed?: (error?: Error) => void

  private readonly client: AMQPBaseClient
  private readonly options: Required<ReconnectOptions>
  private readonly consumers = new Map<AMQPConsumer, ConsumerDefinition>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectResolve: (() => void) | undefined
  private stopped = false

  constructor(client: AMQPBaseClient, options?: ReconnectOptions) {
    this.client = client
    this.options = {
      reconnectInterval: options?.reconnectInterval ?? 1000,
      maxReconnectInterval: options?.maxReconnectInterval ?? 30000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetries: options?.maxRetries ?? 0,
    }
    this.client.ondisconnect = (error?: Error) => {
      this.ondisconnect?.(error)
      if (!this.stopped) {
        void this.scheduleReconnect()
      }
    }
  }

  /**
   * Subscribe to a queue with automatic consumer recovery on reconnection.
   *
   * Returns an {@link AMQPConsumer} whose `cancel()` also removes it
   * from auto-recovery. The same consumer object stays valid across
   * reconnections — its internal channel and tag are swapped in-place.
   */
  async subscribe(
    queue: string,
    params: ConsumeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
    options?: {
      queueParams?: QueueParams
      queueArgs?: Record<string, unknown>
      prefetch?: number
    },
  ): Promise<AMQPConsumer> {
    const ch = await this.client.channel()

    if (options?.prefetch !== undefined) {
      await ch.basicQos(options.prefetch)
    }

    const q = options?.queueParams
      ? await ch.queue(queue, options.queueParams, options.queueArgs || {})
      : await ch.queue(queue, { passive: true })

    const consumer = await q.subscribe(params, callback)

    this.consumers.set(consumer, {
      queue,
      params,
      callback,
      prefetch: options?.prefetch,
      queueParams: options?.queueParams,
      queueArgs: options?.queueArgs,
    })

    consumer._onCancel = () => {
      this.consumers.delete(consumer)
    }

    return consumer
  }

  /**
   * Stop the session: cancel reconnection, clear consumer tracking,
   * and close the underlying connection.
   */
  async stop(reason?: string): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.reconnectResolve) {
      this.reconnectResolve()
      this.reconnectResolve = undefined
    }
    this.consumers.clear()
    if (!this.client.closed) {
      await this.client.close(reason)
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) return

    this.reconnectAttempts++

    if (this.options.maxRetries > 0 && this.reconnectAttempts > this.options.maxRetries) {
      this.stopped = true
      this.onfailed?.(new Error(`Max reconnection attempts (${this.options.maxRetries}) reached`))
      return
    }

    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts - 1),
      this.options.maxReconnectInterval,
    )

    this.client.logger?.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    await new Promise<void>((resolve) => {
      this.reconnectResolve = resolve
      this.reconnectTimer = setTimeout(resolve, delay)
    })
    this.reconnectResolve = undefined

    if (this.stopped) return

    this.onreconnecting?.(this.reconnectAttempts)

    try {
      await this.client.connect()
      this.reconnectAttempts = 0
      await this.recoverConsumers()
      this.onconnect?.()
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.client.logger?.warn("AMQP-Client reconnect error:", error.message)
      void this.scheduleReconnect()
    }
  }

  private async recoverConsumers(): Promise<void> {
    if (this.client.closed) return

    for (const [oldConsumer, definition] of this.consumers) {
      try {
        const ch = await this.client.channel()

        if (definition.prefetch !== undefined) {
          await ch.basicQos(definition.prefetch)
        }

        const q = definition.queueParams
          ? await ch.queue(definition.queue, definition.queueParams, definition.queueArgs || {})
          : await ch.queue(definition.queue, { passive: true })

        const newConsumer = await q.subscribe(definition.params, definition.callback)

        // Swap: replace the new consumer in the channel map with
        // the user's existing reference so message delivery and
        // cancel() both target the right object.
        ch.consumers.delete(newConsumer.tag)
        ch.consumers.set(newConsumer.tag, oldConsumer)
        oldConsumer._update(ch, newConsumer.tag)

        this.client.logger?.debug(`Recovered consumer for queue: ${definition.queue}`)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.client.logger?.warn(`Failed to recover consumer for queue ${definition.queue}:`, error.message)
      }
    }
  }
}
