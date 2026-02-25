import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { ConsumeParams } from "./amqp-channel.js"
import type { AMQPMessage } from "./amqp-message.js"
import type { AMQPQueue } from "./amqp-queue.js"
import { AMQPSubscription, AMQPGeneratorSubscription } from "./amqp-subscription.js"
import type { ConsumerDefinition, SubscribeOptions } from "./amqp-subscription.js"
import type { AMQPTlsOptions } from "./amqp-tls-options.js"
import type { Logger } from "./types.js"

/**
 * Options for {@link AMQPSession.connect}.
 */
export interface AMQPSessionOptions {
  /** Initial delay in milliseconds before reconnecting (default: 1000) */
  reconnectInterval?: number
  /** Maximum delay in milliseconds between reconnection attempts (default: 30000) */
  maxReconnectInterval?: number
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
  /** Maximum number of reconnection attempts — 0 means infinite (default: 0) */
  maxRetries?: number
  /** TLS options — only used when connecting via amqp/amqps */
  tlsOptions?: AMQPTlsOptions
  /** Logger instance. Pass `null` to disable logging explicitly. */
  logger?: Logger | null
}

export type { SubscribeOptions } from "./amqp-subscription.js"

/**
 * High-level session with automatic reconnection and consumer recovery.
 *
 * Create via `AMQPSession.connect(url, options)`. The session owns its
 * underlying transport; use `session.client` only to inspect state, not
 * to open channels directly.
 */
export class AMQPSession {
  /** Fires after a successful (re)connection and consumer recovery */
  onconnect?: () => void
  /** Fires when max retries are exhausted */
  onfailed?: (error?: Error) => void

  /**
   * Underlying transport. Exposed for state inspection (e.g. `client.closed`)
   * and test access. Do not open channels on this directly, and do not
   * overwrite `client.ondisconnect` — the session uses it to drive reconnection.
   */
  readonly client: AMQPBaseClient

  private readonly options: {
    reconnectInterval: number
    maxReconnectInterval: number
    backoffMultiplier: number
    maxRetries: number
  }
  private readonly consumers = new Set<AMQPSubscription>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectResolve: (() => void) | undefined
  private reconnecting = false
  private stopped = false

  private constructor(client: AMQPBaseClient, options?: AMQPSessionOptions) {
    this.client = client
    this.options = {
      reconnectInterval: options?.reconnectInterval ?? 1000,
      maxReconnectInterval: options?.maxReconnectInterval ?? 30000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetries: options?.maxRetries ?? 0,
    }
    this.client.ondisconnect = () => {
      if (!this.stopped && !this.reconnecting) {
        void this.reconnectLoop()
      }
    }
  }

  /**
   * Connect to an AMQP broker and return a session with automatic reconnection.
   *
   * The transport is chosen from the URL scheme:
   * - `amqp://` / `amqps://` → TCP socket (`AMQPClient`)
   * - `ws://` / `wss://` → WebSocket (`AMQPWebSocketClient`)
   */
  static async connect(url: string, options?: AMQPSessionOptions): Promise<AMQPSession> {
    const u = new URL(url)
    let client: AMQPBaseClient
    if (u.protocol === "ws:" || u.protocol === "wss:") {
      const { AMQPWebSocketClient } = await import("./amqp-websocket-client.js")
      const vhost = decodeURIComponent(u.pathname.slice(1)) || "/"
      const username = decodeURIComponent(u.username) || "guest"
      const password = decodeURIComponent(u.password) || "guest"
      const wsUrl = `${u.protocol}//${u.host}${u.pathname}${u.search}`
      client = new AMQPWebSocketClient({ url: wsUrl, vhost, username, password, logger: options?.logger ?? null })
    } else {
      const { AMQPClient } = await import("./amqp-socket-client.js")
      client = new AMQPClient(url, options?.tlsOptions, options?.logger)
    }
    await client.connect()
    return new AMQPSession(client, options)
  }

  /**
   * Subscribe to a queue with automatic consumer recovery on reconnection.
   * Messages will be delivered asynchronously to the callback.
   * @param queue - queue name or {@link AMQPQueue} object
   * @param consumeParams - consume parameters (noAck, exclusive, tag, args)
   * @param callback - called for each delivered message
   * @param [options] - queue declaration and prefetch settings for recovery
   */
  async subscribe(
    queue: string | AMQPQueue,
    consumeParams: ConsumeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
    options?: SubscribeOptions,
  ): Promise<AMQPSubscription>
  /**
   * Subscribe to a queue with automatic consumer recovery on reconnection.
   * Messages will be delivered through an async-iterable subscription that
   * continues yielding across reconnections.
   * @param queue - queue name or {@link AMQPQueue} object
   * @param consumeParams - consume parameters (noAck, exclusive, tag, args)
   * @param [options] - queue declaration and prefetch settings for recovery
   */
  async subscribe(
    queue: string | AMQPQueue,
    consumeParams: ConsumeParams,
    callback?: undefined,
    options?: SubscribeOptions,
  ): Promise<AMQPGeneratorSubscription>
  async subscribe(
    queue: string | AMQPQueue,
    consumeParams: ConsumeParams,
    callback?: (msg: AMQPMessage) => void | Promise<void>,
    options?: SubscribeOptions,
  ): Promise<AMQPSubscription | AMQPGeneratorSubscription> {
    const def: ConsumerDefinition = {
      queueName: typeof queue === "string" ? queue : queue.name,
      consumeParams,
      ...(callback !== undefined && { callback }),
      options: options ?? {},
    }

    const consumer = await this.bindConsumer(def)
    const sub = callback ? new AMQPSubscription(consumer, def) : new AMQPGeneratorSubscription(consumer, def)

    this.consumers.add(sub)
    sub.onCancel = () => {
      this.consumers.delete(sub)
    }

    return sub
  }

  /**
   * Stop the session: cancel reconnection, clear consumer tracking,
   * and close the underlying connection.
   */
  async stop(reason?: string): Promise<void> {
    this.stopped = true
    this.cancelWait()
    const subs = [...this.consumers]
    this.consumers.clear()
    for (const sub of subs) {
      sub.cancel().catch(() => {})
    }
    delete this.client.ondisconnect
    if (!this.client.closed) {
      await this.client.close(reason)
    }
  }

  private async reconnectLoop(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true

    while (!this.stopped) {
      this.reconnectAttempts++

      // Give up after maxRetries
      if (this.options.maxRetries > 0 && this.reconnectAttempts > this.options.maxRetries) {
        this.stopped = true
        this.onfailed?.(new Error(`Max reconnection attempts (${this.options.maxRetries}) reached`))
        continue
      }

      // Wait with exponential backoff
      const delay = Math.min(
        this.options.reconnectInterval * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts - 1),
        this.options.maxReconnectInterval,
      )
      this.client.logger?.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
      await this.waitBeforeRetry(delay)
      if (this.stopped) continue // stop() was called during the wait

      // Attempt to connect — retry on failure
      try {
        await this.client.connect()
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.client.logger?.warn("AMQP-Client reconnect error:", error.message)
        continue
      }

      // Re-establish consumers on the fresh connection
      this.reconnectAttempts = 0
      await this.recoverConsumers()
      if (this.stopped || this.client.closed) continue // stop() called, or connection dropped during recovery

      this.onconnect?.()
      break
    }

    this.reconnecting = false
  }

  private waitBeforeRetry(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.reconnectResolve = resolve
      this.reconnectTimer = setTimeout(resolve, ms)
    })
  }

  private cancelWait(): void {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.reconnectResolve?.()
    this.reconnectResolve = undefined
  }

  private async bindConsumer(def: ConsumerDefinition) {
    const ch = await this.client.channel()
    if (def.options.prefetch !== undefined) {
      await ch.basicQos(def.options.prefetch)
    }
    const q = def.options.queue
      ? await ch.queue(def.queueName, def.options.queue, def.options.queueArgs || {})
      : await ch.queue(def.queueName, { passive: true })
    return def.callback ? await q.subscribe(def.consumeParams, def.callback) : await q.subscribe(def.consumeParams)
  }

  private async recoverConsumers(): Promise<void> {
    if (this.client.closed) return

    for (const sub of this.consumers) {
      try {
        const consumer = await this.bindConsumer(sub.def)
        sub.setConsumer(consumer)
        this.client.logger?.debug(`Recovered consumer for queue: ${sub.def.queueName}`)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.client.logger?.warn(`Failed to recover consumer for queue ${sub.def.queueName}:`, error.message)
      }
    }
  }
}
