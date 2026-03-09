import type { AMQPMessage } from "./amqp-message.js"
import type { ConsumeParams, MessageCount } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { AMQPConsumer, AMQPGeneratorConsumer } from "./amqp-consumer.js"
import { AMQPSubscription, AMQPGeneratorSubscription } from "./amqp-subscription.js"
import type { ConsumerDefinition } from "./amqp-subscription.js"
import type { AMQPSession } from "./amqp-session.js"
import type { ResolveBody } from "./amqp-publisher.js"
import { serializeAndEncode, decodeMessage } from "./amqp-codec-registry.js"
import type { ParserMap, CoderMap } from "./amqp-codec-registry.js"

/**
 * Options for {@link AMQPQueue#subscribe}.
 * Combines consumer parameters with channel-level prefetch.
 */
export type QueueSubscribeParams = ConsumeParams & {
  /** Per-consumer prefetch limit (sets QoS on the channel before consuming). */
  prefetch?: number
  /**
   * Whether to requeue messages that are nacked due to a callback error.
   * Defaults to `true`.
   */
  requeueOnNack?: boolean
}

/** Options for {@link AMQPQueue#publish}. */
export type QueuePublishOptions<T> = Omit<AMQPProperties, "contentType"> & {
  /** Wait for broker confirmation. Defaults to `true`. */
  confirm?: boolean
  contentType?: T
}

/**
 * High-level queue handle returned by {@link AMQPSession#queue}.
 *
 * All operations are reconnect-safe: they acquire a session channel on each
 * call, so they work transparently after a reconnection. `subscribe` provides
 * automatic consumer recovery. `publish` waits for a broker confirm; use
 * Pass `{ confirm: false }` to skip the wait.
 */
export class AMQPQueue<
  P extends ParserMap = {},
  C extends CoderMap = {},
  KP extends keyof P & string = never,
  KC extends keyof C & string = never,
> {
  /** Queue name. */
  readonly name: string
  private readonly session: AMQPSession<P, C, KP, KC>
  private readonly subscriptions = new Set<AMQPSubscription>()

  /** @internal */
  constructor(session: AMQPSession<P, C, KP, KC>, name: string) {
    this.session = session
    this.name = name
  }

  /**
   * Publish a message directly to this queue (via the default exchange).
   *
   * When the session has parsers configured, `body` can be any value accepted
   * by the matching parser's `serialize` method. Without parsers, `body` must
   * be a string, Buffer, Uint8Array, or null.
   *
   * @param options - publish properties; set `confirm: false` to skip broker confirmation
   * @returns `this` for chaining
   */
  async publish<O extends keyof P & string = KP>(
    body: ResolveBody<P, O>,
    options: QueuePublishOptions<O> = {},
  ): Promise<AMQPQueue<P, C, KP, KC>> {
    const { confirm = true, ...properties } = options
    const defaults: { contentType?: string; contentEncoding?: string } = {}
    if (this.session.defaultContentType) defaults.contentType = this.session.defaultContentType
    if (this.session.defaultContentEncoding) defaults.contentEncoding = this.session.defaultContentEncoding
    const encoded = await serializeAndEncode(
      this.session.parsers ?? {},
      this.session.coders ?? {},
      body,
      properties,
      defaults,
    )
    const ch = confirm ? await this.session.getConfirmChannel() : await this.session.getOpsChannel()
    await ch.basicPublish("", this.name, encoded.body, encoded.properties)
    return this
  }

  /** Subscribe with a callback. Messages are acked after the callback returns, nacked on error. */
  subscribe(callback: (msg: AMQPMessage<P>) => void | Promise<void>): Promise<AMQPSubscription>
  /** Subscribe with a callback and custom params. */
  subscribe(
    params: QueueSubscribeParams,
    callback: (msg: AMQPMessage<P>) => void | Promise<void>,
  ): Promise<AMQPSubscription>
  /**
   * Subscribe via an async iterator. Messages continue yielding across reconnections.
   * @example
   * ```ts
   * for await (const msg of await q.subscribe()) {
   *   console.log(msg.bodyString())
   *   await msg.ack()
   * }
   * ```
   */
  subscribe(params?: QueueSubscribeParams): Promise<AMQPGeneratorSubscription<P>>
  async subscribe(
    params?: QueueSubscribeParams | ((msg: AMQPMessage<P>) => void | Promise<void>),
    callback?: (msg: AMQPMessage<P>) => void | Promise<void>,
  ): Promise<AMQPSubscription | AMQPGeneratorSubscription<P>> {
    if (typeof params === "function") [callback, params] = [params, undefined]
    const { prefetch, requeueOnNack = true, ...consumeParams } = params ?? {}
    // Force noAck: false when auto-acking so the server tracks delivery tags.
    // basicConsume defaults noAck to true, so we must be explicit.
    const autoAck = !consumeParams.noAck
    if (autoAck) consumeParams.noAck = false

    const parsers = this.session.parsers
    const coders = this.session.coders
    const wrappedCallback = wrapCallbackWithAutoDecodeAndAck(callback, { parsers, coders, autoAck, requeueOnNack })
    const def: ConsumerDefinition = {
      queueName: this.name,
      consumeParams,
      requeueOnNack,
      ...(wrappedCallback !== undefined && { callback: wrappedCallback }),
      ...(prefetch !== undefined && { prefetch }),
      ...(parsers && { parsers }),
      ...(coders && { coders }),
    }
    const consumer = await this.openConsumer(def)
    const sub = wrappedCallback ? new AMQPSubscription(consumer, def) : new AMQPGeneratorSubscription<P>(consumer, def)
    this.subscriptions.add(sub)
    sub.onCancel = () => {
      this.subscriptions.delete(sub)
    }
    return sub
  }

  /**
   * Poll the queue for a single message.
   * @param [params.noAck=true] - automatically acknowledge on delivery
   */
  async get(params?: { noAck?: boolean }): Promise<AMQPMessage<P> | null> {
    const ch = await this.session.getOpsChannel()
    const msg = await ch.basicGet(this.name, params)
    if (!msg) return null
    if (this.session.parsers || this.session.coders) {
      await decodeMessage(msg, this.session.parsers ?? {}, this.session.coders ?? {})
    }
    return msg as AMQPMessage<P>
  }

  /**
   * Bind this queue to an exchange.
   * @returns `this` for chaining
   */
  async bind(exchange: string, routingKey = "", args: Record<string, unknown> = {}): Promise<AMQPQueue<P, C, KP, KC>> {
    const ch = await this.session.getOpsChannel()
    await ch.queueBind(this.name, exchange, routingKey, args)
    return this
  }

  /**
   * Remove a binding between this queue and an exchange.
   * @returns `this` for chaining
   */
  async unbind(
    exchange: string,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPQueue<P, C, KP, KC>> {
    const ch = await this.session.getOpsChannel()
    await ch.queueUnbind(this.name, exchange, routingKey, args)
    return this
  }

  /** Purge all messages from this queue. */
  async purge(): Promise<MessageCount> {
    const ch = await this.session.getOpsChannel()
    return ch.queuePurge(this.name)
  }

  /**
   * Delete this queue.
   * @param [params.ifUnused=false] - only delete if the queue has no consumers
   * @param [params.ifEmpty=false] - only delete if the queue is empty
   */
  async delete(params?: { ifUnused?: boolean; ifEmpty?: boolean }): Promise<MessageCount> {
    const ch = await this.session.getOpsChannel()
    return ch.queueDelete(this.name, params)
  }

  /**
   * Re-establish all subscriptions after a reconnection.
   * @internal Called by the session's reconnect loop.
   */
  async recover(): Promise<void> {
    for (const sub of this.subscriptions) {
      try {
        const consumer = await this.openConsumer(sub.def)
        sub.setConsumer(consumer)
        this.session.logger?.debug(`Recovered consumer for queue: ${this.name}`)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.session.logger?.warn(`Failed to recover consumer for queue ${this.name}:`, error.message)
      }
    }
  }

  /**
   * Cancel all subscriptions without closing the connection.
   * @internal Called by the session on stop().
   */
  cancelAll(): void {
    for (const sub of this.subscriptions) {
      sub.cancel().catch(() => {})
    }
    this.subscriptions.clear()
  }

  private async openConsumer(def: ConsumerDefinition): Promise<AMQPConsumer | AMQPGeneratorConsumer> {
    const ch = await this.session.openChannel()
    if (def.prefetch !== undefined) {
      await ch.basicQos(def.prefetch)
    }
    return def.callback
      ? ch.basicConsume(def.queueName, def.consumeParams, def.callback)
      : ch.basicConsume(def.queueName, def.consumeParams)
  }
}

type InternalCallback = (msg: AMQPMessage) => void | Promise<void>

function wrapCallbackWithAutoDecodeAndAck<P extends ParserMap>(
  callback: ((msg: AMQPMessage<P>) => void | Promise<void>) | undefined,
  opts: {
    parsers: ParserMap | undefined
    coders: CoderMap | undefined
    autoAck: boolean
    requeueOnNack: boolean
  },
): InternalCallback | undefined {
  if (!callback) return undefined
  if (!opts.autoAck) {
    return async (msg: AMQPMessage) => {
      if (opts.parsers || opts.coders) await decodeMessage(msg, opts.parsers ?? {}, opts.coders ?? {})
      await callback(msg as AMQPMessage<P>)
    }
  }
  return async (msg: AMQPMessage) => {
    try {
      if (opts.parsers || opts.coders) await decodeMessage(msg, opts.parsers ?? {}, opts.coders ?? {})
      await callback(msg as AMQPMessage<P>)
      await msg.ack()
    } catch {
      await msg.nack(opts.requeueOnNack)
    }
  }
}
