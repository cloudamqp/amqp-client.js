import type { AMQPMessage } from "./amqp-message.js"
import type { ConsumeParams, MessageCount } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { AMQPConsumer, AMQPGeneratorConsumer } from "./amqp-consumer.js"
import { AMQPSubscription, AMQPGeneratorSubscription } from "./amqp-subscription.js"
import type { ConsumerDefinition } from "./amqp-subscription.js"
import type { AMQPSession } from "./amqp-session.js"
import type { AMQPExchange } from "./amqp-exchange.js"
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
   * Defaults: `confirm: true`, `deliveryMode: 2` (persistent). Pass
   * `deliveryMode: 1` to send a transient message.
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
    if (encoded.properties.deliveryMode === undefined) encoded.properties.deliveryMode = 2
    if (confirm) {
      const ch = await this.session.getConfirmChannel()
      await ch.basicPublish("", this.name, encoded.body, encoded.properties)
    } else {
      await this.session.withOpsChannel(async (ch) => {
        await ch.basicPublish("", this.name, encoded.body, encoded.properties)
      })
    }
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
    // Hold the mutex only for the RPC. Decoding/decompression doesn't touch
    // the channel and can be expensive (gzip etc.), so let other ops-channel
    // work proceed in parallel with it.
    const msg = await this.session.withOpsChannel((ch) => ch.basicGet(this.name, params))
    if (!msg) return null
    if (this.session.parsers || this.session.coders) {
      await decodeMessage(msg, this.session.parsers ?? {}, this.session.coders ?? {})
    }
    return msg as AMQPMessage<P>
  }

  /**
   * Wait for a single message, then cancel the underlying consumer.
   * Pairs with {@link get} (zero-wait poll) and {@link subscribe} (long-lived):
   *   - `get()` — is there a message right now? null otherwise.
   *   - `consumeOne({ timeout })` — wait up to N ms for one message.
   *   - `subscribe(cb)` — keep delivering until cancelled.
   *
   * Throws when `timeout` elapses with no delivery — distinct from `get()`'s
   * `null` return, so callers can't conflate "nothing" with "deadline missed".
   *
   * Always uses wire-level `noAck: false` with `prefetch: 1` so the broker
   * holds the queue at a single in-flight delivery; messages beyond the one
   * returned stay in the queue for the next consumer.
   *
   * @param [options.timeout] - max wait in milliseconds (omit to wait forever)
   * @param [options.noAck=true] - if true (default), the library acks the
   *   message before returning; if false, the caller must call `msg.ack()`.
   */
  async consumeOne(options: { timeout?: number; noAck?: boolean } = {}): Promise<AMQPMessage<P>> {
    const { timeout, noAck = true } = options
    const ch = await this.session.openChannel()
    await ch.basicQos(1)

    return new Promise<AMQPMessage<P>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      let consumer: AMQPConsumer | undefined

      const cleanup = async () => {
        if (timer) clearTimeout(timer)
        try {
          if (consumer && !this.session.closed) await consumer.cancel()
        } catch {
          // Consumer cancel can fail if the channel/connection dropped; the
          // consumer is already effectively dead either way.
        }
        // When the caller is responsible for acking (noAck:false), keep the
        // channel open — `msg.ack()` is bound to this channel and closing it
        // here would force the ack to fail. The channel goes away on
        // session.stop(); the leak is per-call, bounded by caller behavior.
        if (noAck && !ch.closed) await ch.close().catch(() => {})
      }

      // Await cleanup before settling so callers can immediately call get()
      // or subscribe() on the same queue without racing the cancel/requeue
      // of any prefetched-but-undelivered message.
      const finish = async (settle: () => void) => {
        if (settled) return
        settled = true
        await cleanup()
        settle()
      }

      ch.basicConsume(this.name, { noAck: false }, async (msg) => {
        if (settled) {
          // Race: timeout fired between the broker dispatching the message
          // and our callback running. Nack-requeue so the next consumer
          // gets it.
          await msg.nack(true).catch(() => {})
          return
        }
        if (this.session.parsers || this.session.coders) {
          await decodeMessage(msg, this.session.parsers ?? {}, this.session.coders ?? {})
        }
        if (noAck) {
          try {
            await msg.ack()
          } catch (err) {
            await finish(() => reject(err))
            return
          }
        }
        await finish(() => resolve(msg as AMQPMessage<P>))
      })
        .then((c) => {
          consumer = c
          if (settled) void cleanup()
          else if (timeout !== undefined) {
            timer = setTimeout(
              () => void finish(() => reject(new Error(`consumeOne timed out after ${timeout}ms`))),
              timeout,
            )
          }
        })
        .catch((err) => void finish(() => reject(err)))
    })
  }

  /**
   * Bind this queue to an exchange.
   * @returns `this` for chaining
   */
  async bind(
    exchange: string | AMQPExchange<P, C, KP, KC>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPQueue<P, C, KP, KC>> {
    const exchangeName = typeof exchange === "string" ? exchange : exchange.name
    await this.session.withOpsChannel((ch) => ch.queueBind(this.name, exchangeName, routingKey, args))
    return this
  }

  /**
   * Remove a binding between this queue and an exchange.
   * @returns `this` for chaining
   */
  async unbind(
    exchange: string | AMQPExchange<P, C, KP, KC>,
    routingKey = "",
    args: Record<string, unknown> = {},
  ): Promise<AMQPQueue<P, C, KP, KC>> {
    const exchangeName = typeof exchange === "string" ? exchange : exchange.name
    await this.session.withOpsChannel((ch) => ch.queueUnbind(this.name, exchangeName, routingKey, args))
    return this
  }

  /** Purge all messages from this queue. */
  async purge(): Promise<MessageCount> {
    return this.session.withOpsChannel((ch) => ch.queuePurge(this.name))
  }

  /**
   * Delete this queue.
   * @param [params.ifUnused=false] - only delete if the queue has no consumers
   * @param [params.ifEmpty=false] - only delete if the queue is empty
   */
  async delete(params?: { ifUnused?: boolean; ifEmpty?: boolean }): Promise<MessageCount> {
    return this.session.withOpsChannel((ch) => ch.queueDelete(this.name, params))
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
