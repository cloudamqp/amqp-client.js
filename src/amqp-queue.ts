import type { AMQPMessage } from "./amqp-message.js"
import type { ConsumeParams, MessageCount } from "./amqp-channel.js"
import type { AMQPProperties } from "./amqp-properties.js"
import { AMQPConsumer, AMQPGeneratorConsumer } from "./amqp-consumer.js"
import { AMQPSubscription, AMQPGeneratorSubscription } from "./amqp-subscription.js"
import type { ConsumerDefinition } from "./amqp-subscription.js"
import type { AMQPSession } from "./amqp-session.js"
import { publishConfirmed, publishNoConfirm, type Body } from "./amqp-publisher.js"

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
export type QueuePublishOptions = AMQPProperties & {
  /** Wait for broker confirmation. Defaults to `true`. */
  confirm?: boolean
}

/**
 * High-level queue handle returned by {@link AMQPSession#queue}.
 *
 * All operations are reconnect-safe: they acquire a session channel on each
 * call, so they work transparently after a reconnection. `subscribe` provides
 * automatic consumer recovery. `publish` waits for a broker confirm; use
 * Pass `{ confirm: false }` to skip the wait.
 */
export class AMQPQueue {
  readonly name: string
  private readonly session: AMQPSession
  private readonly subscriptions = new Set<AMQPSubscription>()

  /** @internal */
  constructor(session: AMQPSession, name: string) {
    this.session = session
    this.name = name
  }

  /**
   * Publish a message directly to this queue (via the default exchange).
   * @param [options.confirm=true] - wait for broker confirmation
   * @returns `this` for chaining
   */
  async publish(body: Body | unknown, options: QueuePublishOptions = {}): Promise<AMQPQueue> {
    const { confirm = true, ...properties } = options
    if (confirm) {
      await publishConfirmed(this.session, "", this.name, body, properties)
    } else {
      await publishNoConfirm(this.session, "", this.name, body, properties)
    }
    return this
  }

  /** Subscribe with a callback. Messages are acked after the callback returns, nacked on error. */
  subscribe(callback: (msg: AMQPMessage) => void | Promise<void>): Promise<AMQPSubscription>
  /** Subscribe with a callback and custom params. */
  subscribe(
    params: QueueSubscribeParams,
    callback: (msg: AMQPMessage) => void | Promise<void>,
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
  subscribe(params?: QueueSubscribeParams): Promise<AMQPGeneratorSubscription>
  async subscribe(
    params?: QueueSubscribeParams | ((msg: AMQPMessage) => void | Promise<void>),
    callback?: (msg: AMQPMessage) => void | Promise<void>,
  ): Promise<AMQPSubscription | AMQPGeneratorSubscription> {
    if (typeof params === "function") [callback, params] = [params, undefined]
    const { prefetch, requeueOnNack = true, ...consumeParams } = params ?? {}
    // Force noAck: false when auto-acking so the server tracks delivery tags.
    // basicConsume defaults noAck to true, so we must be explicit.
    const autoAck = !consumeParams.noAck
    if (autoAck) consumeParams.noAck = false

    // Attach codec registry to each delivered message
    const codecs = this.session.codecs
    if (callback !== undefined) {
      const innerCallback = callback
      callback = (msg: AMQPMessage) => {
        if (codecs) msg.codecRegistry = codecs
        return innerCallback(msg)
      }
    }

    if (autoAck && callback !== undefined) {
      const userCallback = callback
      callback = async (msg: AMQPMessage) => {
        try {
          await userCallback(msg)
          await msg.ack()
        } catch {
          await msg.nack(requeueOnNack)
        }
      }
    }
    const def: ConsumerDefinition = {
      queueName: this.name,
      consumeParams,
      ...(callback !== undefined && { callback }),
      ...(prefetch !== undefined && { prefetch }),
      ...(this.session.codecs && { codecs: this.session.codecs }),
    }
    const consumer = await this.openConsumer(def)
    const sub = callback ? new AMQPSubscription(consumer, def) : new AMQPGeneratorSubscription(consumer, def)
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
  async get(params?: { noAck?: boolean }): Promise<AMQPMessage | null> {
    const ch = await this.session.getOpsChannel()
    const msg = await ch.basicGet(this.name, params)
    if (msg && this.session.codecs) msg.codecRegistry = this.session.codecs
    return msg
  }

  /**
   * Bind this queue to an exchange.
   * @returns `this` for chaining
   */
  async bind(exchange: string, routingKey = "", args: Record<string, unknown> = {}): Promise<AMQPQueue> {
    const ch = await this.session.getOpsChannel()
    await ch.queueBind(this.name, exchange, routingKey, args)
    return this
  }

  /**
   * Remove a binding between this queue and an exchange.
   * @returns `this` for chaining
   */
  async unbind(exchange: string, routingKey = "", args: Record<string, unknown> = {}): Promise<AMQPQueue> {
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
