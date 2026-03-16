import type { AMQPBaseClient } from "./amqp-base-client.js"
import type { AMQPChannel, ExchangeParams, ExchangeType, QueueParams } from "./amqp-channel.js"
import type { AMQPCodecRegistry } from "./amqp-codec-registry.js"
import type { AMQPProperties } from "./amqp-properties.js"
import type { PlainBody, Body } from "./amqp-publisher.js"
import type { CodecMode } from "./amqp-message.js"
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
  /** Codec registry for automatic message encoding/decoding. */
  codecs?: AMQPCodecRegistry
  /** Default content-type applied to published messages when not set explicitly. */
  defaultContentType?: string
  /** Default content-encoding applied to published messages when not set explicitly. */
  defaultContentEncoding?: string
  /**
   * AMQP virtual host. For WebSocket URLs the URL path is the relay endpoint,
   * not the vhost — use this option to specify the vhost explicitly.
   * Defaults to `"/"` for WebSocket connections and to the URL path for TCP connections.
   */
  vhost?: string
}

/**
 * High-level session with automatic reconnection and consumer recovery.
 *
 * The generic parameter `C` tracks whether a codec registry is configured.
 * When `C` is `"codec"`, publish methods accept any `Body` (objects, arrays, etc.).
 * When `C` is `"plain"` (default), only raw wire types (string, Uint8Array, etc.) are accepted.
 *
 * Users never write `C` explicitly — it's inferred from the `connect()` call.
 *
 * Create via `AMQPSession.connect(url, options)`.
 */
export class AMQPSession<C extends CodecMode = "plain"> {
  /** Fires after a successful (re)connection and consumer recovery */
  onconnect?: () => void
  /** Fires when max retries are exhausted */
  onfailed?: (error?: Error) => void

  private readonly client: AMQPBaseClient

  /** `true` when the underlying connection is closed. */
  get closed(): boolean {
    return this.client.closed
  }

  /** @internal */
  get logger(): Logger | null | undefined {
    return this.client.logger
  }

  /** @internal Codec registry for publish encoding and consume decoding. */
  readonly codecs?: AMQPCodecRegistry
  /** @internal Default content-type for published messages. */
  readonly defaultContentType?: string
  /** @internal Default content-encoding for published messages. */
  readonly defaultContentEncoding?: string

  private readonly options: {
    reconnectInterval: number
    maxReconnectInterval: number
    backoffMultiplier: number
    maxRetries: number
  }
  private readonly queues = new Map<string, AMQPQueue<C>>()
  private readonly rpcClients = new Set<AMQPRPCClient<C>>()
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

  private constructor(client: AMQPBaseClient, options?: AMQPSessionOptions) {
    this.client = client
    if (options?.codecs) this.codecs = options.codecs
    if (options?.defaultContentType) this.defaultContentType = options.defaultContentType
    if (options?.defaultContentEncoding) this.defaultContentEncoding = options.defaultContentEncoding
    this.options = {
      reconnectInterval: options?.reconnectInterval ?? 1000,
      maxReconnectInterval: options?.maxReconnectInterval ?? 30000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxRetries: options?.maxRetries ?? 0,
    }
    this.client.ondisconnect = () => {
      this.opsChannel = null
      this.confirmChannel = null
      this.opsChannelPromise = null
      this.confirmChannelPromise = null
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
  static async connect(
    url: string,
    options: AMQPSessionOptions & { codecs: AMQPCodecRegistry },
  ): Promise<AMQPSession<"codec">>
  static async connect(url: string, options?: AMQPSessionOptions): Promise<AMQPSession<"plain">>
  static async connect(url: string, options?: AMQPSessionOptions): Promise<AMQPSession<CodecMode>> {
    const u = new URL(url)
    let client: AMQPBaseClient
    if (u.protocol === "ws:" || u.protocol === "wss:") {
      const { AMQPWebSocketClient } = await import("./amqp-websocket-client.js")
      const vhost = options?.vhost ?? "/"
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
   * Encode a body for publishing using the configured codec registry.
   * Applies `defaultContentType` / `defaultContentEncoding` as fallbacks.
   * @internal
   */
  async encodeBody(
    body: Body<C>,
    properties: AMQPProperties,
  ): Promise<{ body: PlainBody; properties: AMQPProperties }> {
    if (!this.codecs) {
      return { body: body as PlainBody, properties }
    }
    const defaults: { contentType?: string; contentEncoding?: string } = {}
    if (this.defaultContentType) defaults.contentType = this.defaultContentType
    if (this.defaultContentEncoding) defaults.contentEncoding = this.defaultContentEncoding
    const result = await this.codecs.serializeAndEncode(body, properties, defaults)
    return { body: result.body, properties: result.properties }
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
      this.opsChannel = ch
      this.opsChannelPromise = null
      return ch
    })
    this.opsChannelPromise.catch(() => {
      this.opsChannelPromise = null
    })
    return this.opsChannelPromise
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
   * Declare a queue and return a session-bound {@link AMQPQueue} handle.
   * The returned queue's `subscribe` uses auto-recovery and `publish` waits for
   * a broker confirm.
   * @param name - queue name (use "" to let the broker generate a name)
   * @param [params] - queue declaration parameters
   * @param [args] - optional queue arguments (e.g. `x-message-ttl`)
   */
  async queue(name: string, params?: QueueParams, args?: Record<string, unknown>): Promise<AMQPQueue<C>> {
    const ch = await this.getOpsChannel()
    const res = await ch.queueDeclare(name, params, args)
    const existing = this.queues.get(res.name)
    if (existing) return existing
    const q = new AMQPQueue<C>(this, res.name)
    this.queues.set(res.name, q)
    return q
  }

  /**
   * Declare an exchange and return a session-bound {@link AMQPExchange} handle.
   * @param name - exchange name
   * @param type - exchange type: `"direct"`, `"fanout"`, `"topic"`, `"headers"`, or a custom type
   * @param [params] - exchange declaration parameters
   * @param [args] - optional exchange arguments
   */
  async exchange(
    name: string,
    type: ExchangeType,
    params?: ExchangeParams,
    args?: Record<string, unknown>,
  ): Promise<AMQPExchange<C>> {
    const ch = await this.getOpsChannel()
    await ch.exchangeDeclare(name, type, params, args)
    return new AMQPExchange<C>(this, name)
  }

  /**
   * Declare a direct exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.direct"] - exchange name
   */
  async directExchange(
    name = "amq.direct",
    params?: ExchangeParams,
    args?: Record<string, unknown>,
  ): Promise<AMQPExchange<C>> {
    if (name === "") return new AMQPExchange<C>(this, "") // default exchange — no declare needed
    return this.exchange(name, "direct", params, args)
  }

  /**
   * Declare a fanout exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.fanout"] - exchange name
   */
  fanoutExchange(
    name = "amq.fanout",
    params?: ExchangeParams,
    args?: Record<string, unknown>,
  ): Promise<AMQPExchange<C>> {
    return this.exchange(name, "fanout", params, args)
  }

  /**
   * Declare a topic exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.topic"] - exchange name
   */
  topicExchange(name = "amq.topic", params?: ExchangeParams, args?: Record<string, unknown>): Promise<AMQPExchange<C>> {
    return this.exchange(name, "topic", params, args)
  }

  /**
   * Declare a headers exchange and return a session-bound {@link AMQPExchange} handle.
   * @param [name="amq.headers"] - exchange name
   */
  headersExchange(
    name = "amq.headers",
    params?: ExchangeParams,
    args?: Record<string, unknown>,
  ): Promise<AMQPExchange<C>> {
    return this.exchange(name, "headers", params, args)
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
    body: Body<C>,
    options?: AMQPProperties & { timeout?: number },
  ): Promise<AMQPMessage> {
    const rpc = new AMQPRPCClient<C>(this)
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
  async rpcClient(): Promise<AMQPRPCClient<C>> {
    const rpc = new AMQPRPCClient<C>(this)
    await rpc.start()
    this.rpcClients.add(rpc)
    return rpc
  }

  /** @internal Remove an RPC client from session recovery tracking. */
  untrackRPCClient(rpc: AMQPRPCClient<C>): void {
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
  async rpcServer(queue: string, handler: RPCHandler, prefetch?: number): Promise<AMQPRPCServer<C>> {
    const server = new AMQPRPCServer<C>(this)
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
