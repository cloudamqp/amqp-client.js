import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { AMQPChannel, ExchangeParams, ExchangeType, QueueParams } from "./amqp-channel.js"

/**
 * Options for {@link AMQPSession#queue}. Combines queue declaration
 * parameters (`passive`, `durable`, `autoDelete`, `exclusive`) with the
 * queue arguments table (`x-message-ttl`, `x-delivery-limit`, ...) so
 * callers don't have to pass `undefined` placeholders to reach the
 * arguments table.
 */
export type QueueOptions = QueueParams & {
  /** Queue arguments table (e.g. `{ "x-delivery-limit": 3 }`). */
  arguments?: Record<string, unknown>
}

/**
 * Options for {@link AMQPSession#exchange} and the typed-exchange
 * shortcuts. Combines exchange declaration parameters (`passive`,
 * `durable`, `autoDelete`, `internal`) with the exchange arguments table
 * (`x-delayed-type`, `alternate-exchange`, ...).
 */
export type ExchangeOptions = ExchangeParams & {
  /** Exchange arguments table (e.g. `{ "x-delayed-type": "direct" }`). */
  arguments?: Record<string, unknown>
}
import { decodeMessage } from "./amqp-codec-registry.js"
import type { ParserMap, CoderMap, ParserRegistry, CoderRegistry } from "./amqp-codec-registry.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { ResolveBody } from "./amqp-publisher.js"
import { AMQPQueue } from "./amqp-queue.js"
import type { AMQPTlsOptions } from "./amqp-tls-options.js"
import type { Logger } from "./types.js"
import { AMQPExchange } from "./amqp-exchange.js"
import { AMQPRPCClient } from "./amqp-rpc-client.js"
import { AMQPRPCServer } from "./amqp-rpc-server.js"
import type { RPCHandler } from "./amqp-rpc-server.js"
import type { AMQPMessage } from "./amqp-message.js"

/**
 * Options for {@link AMQPSession.connect}.
 */
export interface AMQPSessionOptions<
  P extends ParserMap = {},
  C extends CoderMap = {},
  KP extends keyof P & string = never,
  KC extends keyof C & string = never,
> {
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
  /** Parser registry for automatic message serialization/deserialization. */
  parsers?: ParserRegistry<P>
  /** Coder registry for automatic message encoding/decoding. */
  coders?: CoderRegistry<C>
  /** Default content-type applied to published messages when not set explicitly. */
  defaultContentType?: KP
  /** Default content-encoding applied to published messages when not set explicitly. */
  defaultContentEncoding?: KC
  /**
   * AMQP virtual host. For WebSocket URLs the URL path is the relay endpoint,
   * not the vhost — use this option to specify the vhost explicitly.
   * Defaults to `"/"` for WebSocket connections and to the URL path for TCP connections.
   */
  vhost?: string
  /**
   * Connection name, shown in the RabbitMQ management UI. Overrides any
   * `?name=` in the URL.
   */
  name?: string
  /**
   * Heartbeat interval in seconds (0 disables). Overrides any `?heartbeat=` in
   * the URL.
   */
  heartbeat?: number
  /**
   * Max AMQP frame size in bytes (minimum 8192). Overrides any `?frameMax=` in
   * the URL.
   */
  frameMax?: number
  /**
   * Max channels the session may open on this connection (0 = unlimited).
   * Overrides any `?channelMax=` in the URL.
   */
  channelMax?: number
  /**
   * Fires after a successful (re)connection — both the initial connect and
   * every reconnect after consumer recovery completes. Registering here
   * rather than after `connect()` resolves means a single handler covers
   * both code paths.
   *
   * The session is passed in because on the initial connect this fires
   * before the `connect()` call returns, so closures over the outer
   * `session` variable would still see `undefined`. Use the argument —
   * it's the same instance either way.
   *
   * Fire-and-forget. If your handler does async setup that the rest of
   * your code depends on, drive it yourself (e.g. `await setup(session)`
   * after `connect()` resolves) and use `onconnect` to re-run it on
   * reconnects.
   */
  onconnect?(session: AMQPSession<P, C, KP, KC>): void
  /**
   * Fires when the underlying connection drops, before the reconnect loop
   * starts. Useful for visibility into the gap between disconnect and
   * reconnect.
   */
  ondisconnect?: (error?: Error) => void
  /** Fires when max reconnect retries are exhausted. */
  onfailed?: (error?: Error) => void
  /**
   * Fires when the broker blocks the connection from publishing — usually
   * triggered by a resource alarm (memory or disk) on the server. Subsequent
   * publishes reject with `Connection blocked by server` until the broker
   * unblocks. Use this to apply backpressure upstream.
   */
  onblocked?: (reason: string) => void
  /** Fires when the broker lifts a previous block on the connection. */
  onunblocked?: () => void
  /**
   * Fires when a `mandatory: true` publish is returned by the broker because
   * it had no route to a queue. The session wires this onto every channel it
   * opens for publishing, so a single handler covers all session publishes.
   */
  onreturn?: (msg: AMQPMessage<P>) => void
}

/**
 * High-level session with automatic reconnection and consumer recovery.
 *
 * The generic parameters thread parser/coder type information through all
 * session-owned handles (queues, exchanges, RPC clients/servers).
 *
 * Users never write the generics explicitly — they're inferred from the `connect()` call.
 *
 * Create via `AMQPSession.connect(url, options)`.
 */
export class AMQPSession<
  P extends ParserMap = {},
  C extends CoderMap = {},
  KP extends keyof P & string = never,
  KC extends keyof C & string = never,
> {
  private readonly onconnect?: (session: AMQPSession<P, C, KP, KC>) => void
  private readonly ondisconnect?: (error?: Error) => void
  private readonly onfailed?: (error?: Error) => void
  private readonly onreturn?: (msg: AMQPMessage<P>) => void

  private readonly client: AMQPBaseClient

  /** `true` when the underlying connection is closed. */
  get closed(): boolean {
    return this.client.closed
  }

  /** @internal */
  get logger(): Logger | null | undefined {
    return this.client.logger
  }

  /** @internal Parser registry for publish encoding and consume decoding. */
  readonly parsers?: ParserRegistry<P>
  /** @internal Coder registry for publish encoding and consume decoding. */
  readonly coders?: CoderRegistry<C>
  /** @internal Default content-type for published messages. */
  readonly defaultContentType?: KP
  /** @internal Default content-encoding for published messages. */
  readonly defaultContentEncoding?: KC

  private readonly options: {
    reconnectInterval: number
    maxReconnectInterval: number
    backoffMultiplier: number
    maxRetries: number
  }
  private readonly queues = new Map<string, AMQPQueue<P, C, KP, KC>>()
  private readonly rpcClients = new Set<AMQPRPCClient<P, C, KP, KC>>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectResolve: (() => void) | undefined
  private reconnecting = false
  private stopped = false

  // Channels managed by the session. Both are created lazily and reset to null
  // when the connection drops so they are re-opened transparently on next use.
  private opsChannel: AMQPChannel | null = null // management + unconfirmed publish
  private confirmChannel: AMQPChannel | null = null // confirmed publish (confirmSelect enabled)
  // In-flight creation promises prevent concurrent callers from opening duplicate channels.
  private opsChannelPromise: Promise<AMQPChannel> | null = null
  private confirmChannelPromise: Promise<AMQPChannel> | null = null

  private constructor(client: AMQPBaseClient, options?: AMQPSessionOptions<P, C, KP, KC>) {
    this.client = client
    if (options?.parsers) this.parsers = options.parsers
    if (options?.coders) this.coders = options.coders
    if (options?.defaultContentType) this.defaultContentType = options.defaultContentType
    if (options?.defaultContentEncoding) this.defaultContentEncoding = options.defaultContentEncoding
    if (options?.onconnect) this.onconnect = options.onconnect
    if (options?.ondisconnect) this.ondisconnect = options.ondisconnect
    if (options?.onfailed) this.onfailed = options.onfailed
    if (options?.onreturn) this.onreturn = options.onreturn
    if (options?.onblocked) this.client.onblocked = options.onblocked
    if (options?.onunblocked) this.client.onunblocked = options.onunblocked
    this.options = {
      reconnectInterval: options?.reconnectInterval ?? 1000,
      maxReconnectInterval: options?.maxReconnectInterval ?? 30000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetries: options?.maxRetries ?? 0,
    }
    this.client.ondisconnect = (err) => {
      this.client.logger?.warn(`${this.logTag()}: disconnected`)
      this.opsChannel = null
      this.confirmChannel = null
      this.opsChannelPromise = null
      this.confirmChannelPromise = null
      this.ondisconnect?.(err)
      if (!this.stopped && !this.reconnecting) {
        void this.reconnectLoop()
      }
    }
  }

  private logTag(): string {
    return this.client.name ? `AMQPSession[${this.client.name}]` : "AMQPSession"
  }

  /**
   * Connect to an AMQP broker and return a session with automatic reconnection.
   *
   * The transport is chosen from the URL scheme:
   * - `amqp://` / `amqps://` → TCP socket (`AMQPClient`)
   * - `ws://` / `wss://` → WebSocket (`AMQPWebSocketClient`)
   */
  static async connect<
    P extends ParserMap = {},
    C extends CoderMap = {},
    KP extends keyof P & string = never,
    KC extends keyof C & string = never,
  >(url: string, options?: AMQPSessionOptions<P, C, KP, KC>): Promise<AMQPSession<P, C, KP, KC>> {
    const u = new URL(url)
    let client: AMQPBaseClient
    if (u.protocol === "ws:" || u.protocol === "wss:") {
      const { AMQPWebSocketClient } = await import("./amqp-websocket-client.js")
      const vhost = options?.vhost ?? "/"
      const username = decodeURIComponent(u.username) || "guest"
      const password = decodeURIComponent(u.password) || "guest"
      const name = options?.name ?? u.searchParams.get("name") ?? undefined
      const heartbeat = options?.heartbeat ?? numericParam(u.searchParams.get("heartbeat"))
      const frameMax = options?.frameMax ?? numericParam(u.searchParams.get("frameMax"))
      const channelMax = options?.channelMax ?? numericParam(u.searchParams.get("channelMax"))
      const wsUrl = `${u.protocol}//${u.host}${u.pathname}${u.search}`
      const init: ConstructorParameters<typeof AMQPWebSocketClient>[0] = {
        url: wsUrl,
        vhost,
        username,
        password,
        logger: options?.logger ?? null,
      }
      if (name) init.name = name
      if (heartbeat !== undefined) init.heartbeat = heartbeat
      if (frameMax !== undefined) init.frameMax = frameMax
      if (channelMax !== undefined) init.channelMax = channelMax
      client = new AMQPWebSocketClient(init)
    } else {
      const { AMQPClient } = await import("./amqp-socket-client.js")
      // AMQPClient reads name/heartbeat/frameMax/channelMax from URL query
      // params, so route options through the URL rather than touching the
      // low-level constructor signature.
      const overrides: Record<string, string | undefined> = {
        name: options?.name,
        heartbeat: options?.heartbeat?.toString(),
        frameMax: options?.frameMax?.toString(),
        channelMax: options?.channelMax?.toString(),
      }
      for (const [key, val] of Object.entries(overrides)) {
        if (val !== undefined) u.searchParams.set(key, val)
      }
      client = new AMQPClient(u.toString(), options?.tlsOptions, options?.logger)
    }
    await client.connect()
    const session = new AMQPSession(client, options)
    client.logger?.info(`${session.logTag()}: connected`)
    options?.onconnect?.(session)
    return session
  }

  /**
   * Return the shared ops channel, opening a new one if needed.
   * Used by queue/exchange handles for management operations and fire-and-forget publishes.
   * @internal
   */
  getOpsChannel(): Promise<AMQPChannel> {
    if (this.opsChannel && !this.opsChannel.closed) return Promise.resolve(this.opsChannel)
    if (this.opsChannelPromise) return this.opsChannelPromise
    this.opsChannelPromise = this.client.channel().then((ch) => {
      this.wireReturnHandler(ch)
      this.wireManagedChannelErrorHandler(ch)
      this.opsChannel = ch
      this.opsChannelPromise = null
      return ch
    })
    this.opsChannelPromise.catch(() => {
      this.opsChannelPromise = null
    })
    return this.opsChannelPromise
  }

  // Forward returned (unroutable mandatory) messages from a channel to the
  // session-level onreturn handler so callers register a single hook
  // regardless of which channel published. Decoded through the session's
  // parsers/coders so the body shape matches what publish() accepted.
  private wireReturnHandler(ch: AMQPChannel): void {
    if (!this.onreturn) return
    ch.onReturn = (msg) => {
      const handler = this.onreturn
      if (!handler) return
      void (async () => {
        try {
          if (this.parsers || this.coders) {
            await decodeMessage(msg, this.parsers ?? {}, this.coders ?? {})
          }
          handler(msg as AMQPMessage<P>)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          this.client.logger?.warn(`${this.logTag()}: onreturn handler failed:`, error.message)
        }
      })()
    }
  }

  // Ops/confirm channels reopen on next use, so an expected close (e.g. a
  // passive declare of a missing queue) shouldn't hit the connection error
  // log. The awaiting RPC still rejects via setClosed. Matches amqp-client.rb.
  private wireManagedChannelErrorHandler(ch: AMQPChannel): void {
    ch.onerror = (reason) => {
      this.client.logger?.debug(`${this.logTag()}: channel ${ch.id} closed (${reason}); will reopen on next use`)
    }
  }

  // Serializes operations on the shared ops channel. AMQP channel-level
  // errors (NOT_FOUND on a passive declare, PRECONDITION_FAILED on
  // mismatched declare args, exclusive conflicts, etc.) close the channel.
  // Without a mutex, a concurrent RPC in flight on the same channel fails
  // with a generic "channel closed" error that has nothing to do with what
  // it was doing. Mirrors the Ruby client's single-connection invariant —
  // throughput-wise this serializes declares + bind/unbind/purge/delete +
  // basicGet + unconfirmed publishes; confirmed publishes (confirm channel)
  // and consumers (dedicated channels via openChannel) are unaffected.
  private opsLock: Promise<unknown> = Promise.resolve()

  /**
   * Run `fn` with exclusive access to the shared ops channel. Each caller
   * waits for the previous one to settle, so a channel-closing RPC error
   * never disrupts an unrelated op in flight.
   * @internal
   */
  withOpsChannel<T>(fn: (ch: AMQPChannel) => Promise<T>): Promise<T> {
    const result = this.opsLock.then(async () => {
      const ch = await this.getOpsChannel()
      return fn(ch)
    })
    // Chain even on rejection so a failing op doesn't deadlock subsequent
    // callers. Errors propagate to the caller via the returned promise.
    this.opsLock = result.catch(() => {})
    return result
  }

  /**
   * Return the shared confirm channel, opening and enabling publish confirms if needed.
   * Used by queue/exchange handles for confirmed publishes.
   * @internal
   */
  getConfirmChannel(): Promise<AMQPChannel> {
    if (this.confirmChannel && !this.confirmChannel.closed) return Promise.resolve(this.confirmChannel)
    if (this.confirmChannelPromise) return this.confirmChannelPromise
    this.confirmChannelPromise = this.client.channel().then(async (ch) => {
      await ch.confirmSelect()
      this.wireReturnHandler(ch)
      this.wireManagedChannelErrorHandler(ch)
      this.confirmChannel = ch
      this.confirmChannelPromise = null
      return ch
    })
    this.confirmChannelPromise.catch(() => {
      this.confirmChannelPromise = null
    })
    return this.confirmChannelPromise
  }

  /**
   * Open a fresh dedicated channel. Used by queue handles for consumer channels.
   * @internal
   */
  openChannel(): Promise<AMQPChannel> {
    return this.client.channel()
  }

  /**
   * Remove a queue handle from the session cache. Called by
   * {@link AMQPQueue#delete} after the broker acks the delete so subsequent
   * `session.queue(name)` calls don't hand back a handle to a queue that no
   * longer exists.
   * @internal
   */
  removeQueue(name: string): void {
    this.queues.delete(name)
  }

  /**
   * Declare a queue and return a session-bound {@link AMQPQueue} handle.
   * The returned queue's `subscribe` uses auto-recovery and `publish` waits for
   * a broker confirm.
   *
   * Subsequent calls with the same (non-empty) name return the cached handle
   * without redeclaring, and `options` on those calls are ignored.
   *
   * Server-named queues (declared with `""`) are not cached or tracked for
   * auto-recovery: every call declares a fresh queue, and the broker assigns a
   * new name on every connection, so the old name is dead after a reconnect and
   * can't be recovered. Neither the queue nor its consumers are auto-recovered —
   * `AMQPQueue.subscribe()` recovery does not apply here. Re-declare such a queue
   * in an {@link AMQPSessionOptions.onconnect} handler — it runs again after every
   * reconnect — and bind/subscribe there.
   * @param name - queue name (use "" to let the broker generate a name)
   * @param [options] - queue declaration parameters and queue arguments
   */
  async queue(name: string, options?: QueueOptions): Promise<AMQPQueue<P, C, KP, KC>> {
    if (name !== "") {
      const cached = this.queues.get(name)
      if (cached) return cached
    }
    const { arguments: queueArguments, ...declarationParams } = options ?? {}
    return this.withOpsChannel(async (ch) => {
      const res = await ch.queueDeclare(name, declarationParams, queueArguments)
      // Server-named queues can't be recovered by name, so don't register them
      // for auto-recovery — a cached handle would chase a dead name on every
      // reconnect (and never get evicted). Callers re-declare in `onconnect`.
      if (name === "") return new AMQPQueue<P, C, KP, KC>(this, res.name)
      const existing = this.queues.get(res.name)
      if (existing) return existing
      const q = new AMQPQueue<P, C, KP, KC>(this, res.name)
      this.queues.set(res.name, q)
      return q
    })
  }

  /**
   * Declare an exchange and return a session-bound {@link AMQPExchange} handle.
   * @param name - exchange name
   * @param type - exchange type: `"direct"`, `"fanout"`, `"topic"`, `"headers"`, or a custom type
   * @param [options] - exchange declaration parameters and exchange arguments
   */
  async exchange(name: string, type: ExchangeType, options?: ExchangeOptions): Promise<AMQPExchange<P, C, KP, KC>> {
    const { arguments: exchangeArguments, ...declarationParams } = options ?? {}
    return this.withOpsChannel(async (ch) => {
      await ch.exchangeDeclare(name, type, declarationParams, exchangeArguments)
      return new AMQPExchange<P, C, KP, KC>(this, name)
    })
  }

  /**
   * Declare a direct exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.direct"] - exchange name
   */
  async directExchange(name = "amq.direct", options?: ExchangeOptions): Promise<AMQPExchange<P, C, KP, KC>> {
    if (name === "") return new AMQPExchange<P, C, KP, KC>(this, "") // default exchange — no declare needed
    return this.exchange(name, "direct", options)
  }

  /**
   * Declare a fanout exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.fanout"] - exchange name
   */
  fanoutExchange(name = "amq.fanout", options?: ExchangeOptions): Promise<AMQPExchange<P, C, KP, KC>> {
    return this.exchange(name, "fanout", options)
  }

  /**
   * Declare a topic exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.topic"] - exchange name
   */
  topicExchange(name = "amq.topic", options?: ExchangeOptions): Promise<AMQPExchange<P, C, KP, KC>> {
    return this.exchange(name, "topic", options)
  }

  /**
   * Declare a headers exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.headers"] - exchange name
   */
  headersExchange(name = "amq.headers", options?: ExchangeOptions): Promise<AMQPExchange<P, C, KP, KC>> {
    return this.exchange(name, "headers", options)
  }

  /**
   * Perform an RPC call: publish a message and wait for the response.
   * Creates a temporary client per call — simple and sufficient for most use cases.
   *
   * For high-throughput scenarios where the per-call channel overhead matters,
   * use {@link rpcClient} to create a reusable client instead.
   *
   * @param queue - The routing key / queue name of the RPC server
   * @param body - The request body
   * @param options - Optional AMQP properties and timeout
   * @param options.timeout - Timeout in milliseconds
   * @returns The reply {@link AMQPMessage}
   */
  async rpcCall(
    queue: string,
    body: ResolveBody<P, KP>,
    options?: AMQPProperties & { timeout?: number },
  ): Promise<AMQPMessage<P>> {
    const rpc = new AMQPRPCClient<P, C, KP, KC>(this)
    await rpc.start()
    try {
      return await rpc.call(queue, body, options)
    } finally {
      await rpc.close()
    }
  }

  /**
   * Create and start a reusable RPC client that keeps its channel open
   * across multiple calls. Prefer {@link rpcCall} for simplicity; use this
   * when you need to avoid the per-call channel overhead.
   *
   * @returns A started {@link AMQPRPCClient} ready for {@link AMQPRPCClient.call} invocations.
   */
  async rpcClient(): Promise<AMQPRPCClient<P, C, KP, KC>> {
    const rpc = new AMQPRPCClient<P, C, KP, KC>(this)
    await rpc.start()
    this.rpcClients.add(rpc)
    return rpc
  }

  /** @internal Remove an RPC client from session recovery tracking. */
  untrackRPCClient(rpc: AMQPRPCClient<P, C, KP, KC>): void {
    this.rpcClients.delete(rpc)
  }

  /**
   * Create and start an RPC server that consumes from the given queue.
   * Each incoming message is passed to `handler`; the returned value is
   * published back to the caller's `replyTo` address.
   *
   * @param queue - Queue name to consume from
   * @param handler - Callback that receives the decoded message, returns the response body
   * @param prefetch - Channel prefetch count (default: 1)
   * @returns A started {@link AMQPRPCServer}
   */
  async rpcServer(queue: string, handler: RPCHandler<P, KP>, prefetch?: number): Promise<AMQPRPCServer<P, C, KP, KC>> {
    const server = new AMQPRPCServer<P, C, KP, KC>(this)
    await server.start(queue, handler, prefetch)
    return server
  }

  /**
   * Stop the session: cancel reconnection, clear consumer tracking,
   * and close the underlying connection.
   */
  async stop(reason?: string): Promise<void> {
    this.stopped = true
    this.cancelWait()
    for (const queue of this.queues.values()) {
      queue.cancelAll()
    }
    this.queues.clear()
    for (const rpc of this.rpcClients) {
      rpc.close().catch(() => {})
    }
    this.rpcClients.clear()
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
        this.client.logger?.error(`${this.logTag()}: reconnect gave up`)
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
      await this.recoverQueues()
      if (this.stopped || this.client.closed) continue // stop() called, or connection dropped during recovery

      this.client.logger?.info(`${this.logTag()}: reconnected`)
      this.onconnect?.(this)
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

  private async recoverQueues(): Promise<void> {
    if (this.client.closed) return
    for (const queue of this.queues.values()) {
      await queue.recover()
    }
    for (const rpc of this.rpcClients) {
      try {
        await rpc.recover()
        this.client.logger?.debug("Recovered RPC client")
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.client.logger?.warn("Failed to recover RPC client:", error.message)
      }
    }
  }
}

function numericParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
